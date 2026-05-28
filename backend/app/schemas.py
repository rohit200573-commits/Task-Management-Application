from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import datetime

# --- User Schemas ---
class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4)

class UserResponse(BaseModel):
    id: int
    username: str

    class Config:
        from_attributes = True

# --- Token Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None

# --- Task Schemas ---
class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    status: str = Field("todo", pattern="^(todo|in_progress|done)$")
    priority: str = Field("medium", pattern="^(low|medium|high)$")
    due_date: Optional[str] = None   # YYYY-MM-DD format
    tags: Optional[str] = None       # comma-separated e.g. "work,urgent"

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v is None:
            return v
        parts = [t.strip() for t in v.split(",") if t.strip()]
        if len(parts) > 8:
            raise ValueError("Maximum 8 tags allowed")
        return ",".join(parts)

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    status: Optional[str] = Field(None, pattern="^(todo|in_progress|done)$")
    priority: Optional[str] = Field(None, pattern="^(low|medium|high)$")
    due_date: Optional[str] = None
    tags: Optional[str] = None

class TaskResponse(TaskBase):
    id: int
    created_at: datetime
    owner_id: int

    class Config:
        from_attributes = True
