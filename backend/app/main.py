import json
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import case

from .database import engine, get_db, Base
from . import models, schemas, auth
from .nlp_model import categorizer

# Initialize Database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Task Management API", version="2.0.0")

# --- Serve Frontend Static Files ---
FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend"

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- WebSocket Broadcast Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# --- Auth Endpoints ---
@app.post("/api/auth/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user_data.username).first()
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    hashed_pwd = auth.get_password_hash(user_data.password)
    new_user = models.User(username=user_data.username, hashed_password=hashed_pwd)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/auth/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(data={"sub": user.username, "id": user.id})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user

# --- Task Endpoints ---
PRIORITY_ORDER = case(
    (models.Task.priority == "high", 1),
    (models.Task.priority == "medium", 2),
    (models.Task.priority == "low", 3),
    else_=4
)

@app.get("/api/tasks")
def get_tasks(
    status_filter: Optional[str] = None,
    priority_filter: Optional[str] = None,
    tag_filter: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = Query("created_at", pattern="^(created_at|due_date|priority|title)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    query = db.query(models.Task).filter(models.Task.owner_id == current_user.id)

    if status_filter:
        query = query.filter(models.Task.status == status_filter)
    if priority_filter:
        query = query.filter(models.Task.priority == priority_filter)
    if tag_filter:
        query = query.filter(models.Task.tags.ilike(f"%{tag_filter}%"))
    if search:
        query = query.filter(
            (models.Task.title.ilike(f"%{search}%")) |
            (models.Task.description.ilike(f"%{search}%")) |
            (models.Task.tags.ilike(f"%{search}%"))
        )

    # Sorting
    if sort_by == "due_date":
        # NULL due_dates go last
        query = query.order_by(
            models.Task.due_date.is_(None),
            models.Task.due_date.asc()
        )
    elif sort_by == "priority":
        query = query.order_by(PRIORITY_ORDER)
    elif sort_by == "title":
        query = query.order_by(models.Task.title.asc())
    else:
        query = query.order_by(models.Task.created_at.desc())

    total = query.count()
    tasks = query.offset((page - 1) * page_size).limit(page_size).all()

    response = JSONResponse(
        content=[schemas.TaskResponse.model_validate(t).model_dump(mode="json") for t in tasks]
    )
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Page"] = str(page)
    response.headers["X-Page-Size"] = str(page_size)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count, X-Page, X-Page-Size"
    return response

@app.post("/api/tasks", response_model=schemas.TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_data: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    new_task = models.Task(
        title=task_data.title,
        description=task_data.description,
        status=task_data.status,
        priority=task_data.priority,
        due_date=task_data.due_date,
        tags=task_data.tags,
        owner_id=current_user.id
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)

    task_json = schemas.TaskResponse.model_validate(new_task).model_dump(mode="json")
    await manager.broadcast({
        "type": "TASK_CREATED",
        "task": task_json,
        "sender": current_user.username
    })
    return new_task

@app.put("/api/tasks/{task_id}", response_model=schemas.TaskResponse)
async def update_task(
    task_id: int,
    task_data: schemas.TaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    task = db.query(models.Task).filter(
        models.Task.id == task_id,
        models.Task.owner_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or unauthorized"
        )

    update_data = task_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)

    db.commit()
    db.refresh(task)

    task_json = schemas.TaskResponse.model_validate(task).model_dump(mode="json")
    await manager.broadcast({
        "type": "TASK_UPDATED",
        "task": task_json,
        "sender": current_user.username
    })
    return task

@app.delete("/api/tasks/{task_id}")
async def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    task = db.query(models.Task).filter(
        models.Task.id == task_id,
        models.Task.owner_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or unauthorized"
        )

    db.delete(task)
    db.commit()

    await manager.broadcast({
        "type": "TASK_DELETED",
        "task_id": task_id,
        "sender": current_user.username
    })
    return {"status": "success", "message": f"Task {task_id} deleted successfully"}

# --- NLP / AI Endpoint ---
class CategorizeRequest(BaseModel):
    text: str

@app.post("/api/ai/categorize")
def ai_categorize(
    payload: CategorizeRequest,
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    NLP task categorizer — scikit-learn TF-IDF + Logistic Regression.
    Returns predicted category, confidence score, suggested priority & tags.
    """
    return categorizer.predict(payload.text)

# --- Stats Endpoint ---
@app.get("/api/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    tasks = db.query(models.Task).filter(models.Task.owner_id == current_user.id).all()
    from datetime import date
    today = date.today().isoformat()
    return {
        "total": len(tasks),
        "todo": sum(1 for t in tasks if t.status == "todo"),
        "in_progress": sum(1 for t in tasks if t.status == "in_progress"),
        "done": sum(1 for t in tasks if t.status == "done"),
        "overdue": sum(1 for t in tasks if t.due_date and t.due_date < today and t.status != "done"),
        "high_priority": sum(1 for t in tasks if t.priority == "high"),
        "medium_priority": sum(1 for t in tasks if t.priority == "medium"),
        "low_priority": sum(1 for t in tasks if t.priority == "low"),
    }

# --- WebSocket Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# Mount static frontend assets — placed LAST so all /api/* and /ws routes take priority
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
