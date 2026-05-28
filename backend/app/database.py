import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Use DATABASE_URL env var (set by Render PostgreSQL) — falls back to SQLite locally
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tasks.db")

# Render PostgreSQL gives `postgres://` which SQLAlchemy 2.x requires as `postgresql://`
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs check_same_thread=False; PostgreSQL does not
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
