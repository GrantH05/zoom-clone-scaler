from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, Integer, String, Text, ForeignKey, create_engine, event, func, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ZOOM_DB_PATH", str(BASE_DIR / "data" / "zoom_clone.db"))).expanduser().resolve()
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
CORS_ORIGINS = [origin.strip().rstrip("/") for origin in os.environ.get("CORS_ORIGINS", f"{FRONTEND_URL},http://127.0.0.1:3000").split(",") if origin.strip()]
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
@event.listens_for(engine, "connect")
def enable_foreign_keys(connection, _):
    connection.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(80), default="User")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(120), default="Instant Meeting")
    description: Mapped[str] = mapped_column(Text, default="")
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=40)
    host_name: Mapped[str] = mapped_column(String(80), default="Demo User")
    owner_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    host_video: Mapped[bool] = mapped_column(Boolean, default=True)
    participant_video: Mapped[bool] = mapped_column(Boolean, default=True)
    is_scheduled: Mapped[bool] = mapped_column(Boolean, default=False)

Base.metadata.create_all(engine)

def ensure_column(table: str, column: str, definition: str) -> None:
    with engine.begin() as conn:
        cols = [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))]
        if column not in cols:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))

ensure_column("meetings", "owner_user_id", "INTEGER")
ensure_column("meetings", "host_video", "BOOLEAN DEFAULT 1")
ensure_column("meetings", "participant_video", "BOOLEAN DEFAULT 1")

app = FastAPI(title="Zoom Clone API", version="1.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"pbkdf2$120000${salt.hex()}${digest.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$", 3)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False

def normalize_meeting_id(value: str) -> str:
    return value.replace(" ", "").replace("-", "").strip()

def new_meeting_id() -> str:
    while True:
        raw = secrets.randbelow(900_000_000) + 100_000_000
        value = f"{raw:,}".replace(",", " ")
        with SessionLocal() as db:
            if not db.scalar(select(Meeting).where(Meeting.meeting_id == value)):
                return value

def utc_iso(value: datetime) -> str:
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return aware.isoformat()

def meeting_dict(m: Meeting) -> dict[str, Any]:
    return {
        "id": m.id, "meeting_id": m.meeting_id, "title": m.title,
        "description": m.description,
        "scheduled_at": utc_iso(m.scheduled_at) if m.scheduled_at else None,
        "duration_minutes": m.duration_minutes, "host_name": m.host_name,
        "owner_user_id": m.owner_user_id, "created_at": utc_iso(m.created_at),
        "is_scheduled": m.is_scheduled, "host_video": m.host_video, "participant_video": m.participant_video,
        "invite_link": f"{FRONTEND_URL}/join/{normalize_meeting_id(m.meeting_id)}",
    }

def user_dict(u: User) -> dict[str, Any]:
    return {"id": u.id, "email": u.email, "name": u.name}

# Built-in assignment account. Created once without adding meetings.
with SessionLocal() as db:
    default_user = db.scalar(select(User).where(User.email == "default@user.com"))
    if not default_user:
        default_user = User(email="default@user.com", name="Default", password_hash=hash_password("default123"))
        db.add(default_user)
    else:
        default_user.name = "Default"
        if not verify_password("default123", default_user.password_hash):
            default_user.password_hash = hash_password("default123")
    db.commit()

@app.get("/api/auth/default")
def default_account():
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "default@user.com"))
        return {"user": user_dict(user)}

class AuthPayload(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(default="", max_length=80)

class MeetingCreate(BaseModel):
    title: str = Field(default="Instant Meeting", max_length=120)
    description: str = Field(default="", max_length=1000)
    scheduled_at: datetime | None = None
    duration_minutes: int = Field(default=40, ge=1, le=1440)
    host_name: str = Field(default="Demo User", max_length=80)
    host_video: bool = True
    participant_video: bool = True
    is_scheduled: bool = False
    owner_user_id: int

class JoinCheck(BaseModel):
    meeting_id: str

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/auth/register")
def register(payload: AuthPayload):
    email = payload.email.strip().lower()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        u = User(email=email, password_hash=hash_password(payload.password), name=payload.name.strip() or email.split("@")[0])
        db.add(u); db.commit(); db.refresh(u)
        return {"user": user_dict(u)}

@app.post("/api/auth/login")
def login(payload: AuthPayload):
    email = payload.email.strip().lower()
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.email == email))
        if not u or not verify_password(payload.password, u.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        return {"user": user_dict(u)}

@app.get("/api/meetings")
def list_meetings(user_id: int):
    with SessionLocal() as db:
        rows = db.scalars(select(Meeting).where(Meeting.owner_user_id == user_id).order_by(Meeting.created_at.desc())).all()
        return [meeting_dict(m) for m in rows]

@app.post("/api/meetings")
def create_meeting(payload: MeetingCreate):
    with SessionLocal() as db:
        owner = db.get(User, payload.owner_user_id)
        if not owner:
            raise HTTPException(status_code=401, detail="User account not found")
        if payload.is_scheduled and payload.scheduled_at is None:
            raise HTTPException(status_code=400, detail="Scheduled meetings require a date and time")
        m = Meeting(
            meeting_id=new_meeting_id(),
            title=payload.title or ("Scheduled Meeting" if payload.is_scheduled else "Instant Meeting"),
            description=payload.description,
            scheduled_at=((payload.scheduled_at.replace(tzinfo=timezone.utc) if payload.scheduled_at.tzinfo is None else payload.scheduled_at.astimezone(timezone.utc)).replace(tzinfo=None) if payload.is_scheduled and payload.scheduled_at else None),
            duration_minutes=payload.duration_minutes,
            host_name=payload.host_name or owner.name,
            owner_user_id=payload.owner_user_id,
            is_scheduled=payload.is_scheduled, host_video=payload.host_video, participant_video=payload.participant_video,
        )
        db.add(m); db.commit(); db.refresh(m)
        return meeting_dict(m)

@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str):
    normalized = normalize_meeting_id(meeting_id)
    with SessionLocal() as db:
        m = db.scalar(select(Meeting).where(func.replace(Meeting.meeting_id, " ", "") == normalized))
        if not m: raise HTTPException(status_code=404, detail="Meeting not found")
        return meeting_dict(m)

@app.post("/api/meetings/check")
def check_meeting(payload: JoinCheck):
    normalized = normalize_meeting_id(payload.meeting_id)
    with SessionLocal() as db:
        m = db.scalar(select(Meeting).where(func.replace(Meeting.meeting_id, " ", "") == normalized))
        return {"exists": bool(m), "meeting": meeting_dict(m) if m else None}

@app.delete("/api/meetings/{meeting_id}")
def delete_meeting(meeting_id: str, user_id: int):
    normalized = normalize_meeting_id(meeting_id)
    with SessionLocal() as db:
        m = db.scalar(select(Meeting).where(func.replace(Meeting.meeting_id, " ", "") == normalized))
        if not m: raise HTTPException(status_code=404, detail="Meeting not found")
        if m.owner_user_id != user_id: raise HTTPException(status_code=403, detail="You can only delete your own meetings")
        db.delete(m); db.commit()
    return {"deleted": True}

# Live room state. SQLite stores durable meeting metadata; WebSockets store transient participants.
rooms: dict[str, dict[str, WebSocket]] = {}
room_users: dict[str, dict[str, dict[str, Any]]] = {}
active_sessions: dict[int, tuple[str, str]] = {}  # user_id -> (meeting_id, peer_id)
room_lock = asyncio.Lock()

@app.get("/api/active-meeting")
async def active_meeting(user_id: int):
    async with room_lock:
        session = active_sessions.get(user_id)
        if not session or session[1] not in rooms.get(session[0], {}):
            return {"active": False, "meeting_id": None}
        return {"active": True, "meeting_id": session[0]}


def participants_for(room: str, exclude: str | None = None) -> list[dict[str, Any]]:
    return [dict(v) for pid, v in room_users.get(room, {}).items() if pid != exclude]

async def broadcast(room: str, message: dict[str, Any], exclude: str | None = None):
    sockets = list(rooms.get(room, {}).items())
    dead: list[str] = []
    payload = json.dumps(message)
    for peer_id, ws in sockets:
        if peer_id == exclude: continue
        try: await ws.send_text(payload)
        except Exception: dead.append(peer_id)
    for peer_id in dead:
        await remove_peer(room, peer_id, notify=False)

async def remove_peer(room: str, peer_id: str, notify: bool = True):
    async with room_lock:
        rooms.get(room, {}).pop(peer_id, None)
        user = room_users.get(room, {}).pop(peer_id, None)
        if user and active_sessions.get(user["userId"]) == (room, peer_id):
            active_sessions.pop(user["userId"], None)
        empty = not rooms.get(room)
        if empty:
            rooms.pop(room, None); room_users.pop(room, None)
    if notify and user:
        await broadcast(room, {"type": "peer-left", "peerId": peer_id})

async def activate_socket(room: str, peer_id: str, user_id: int, name: str, host: bool, websocket: WebSocket):
    async with room_lock:
        rooms.setdefault(room, {})[peer_id] = websocket
        room_users.setdefault(room, {})[peer_id] = {
            "peerId": peer_id, "name": name, "muted": False, "cameraOff": False,
            "host": host, "userId": user_id, "screenOn": False, "status": "", "joinedAt": datetime.utcnow().isoformat()
        }
        if user_id > 0: active_sessions[user_id] = (room, peer_id)
        peers = participants_for(room, exclude=peer_id)
        self_user = dict(room_users[room][peer_id])
    await websocket.send_json({"type": "room-state", "self": self_user, "peers": peers})
    await broadcast(room, {"type": "peer-joined", "peer": self_user}, exclude=peer_id)

@app.websocket("/ws/meeting/{meeting_id}/{peer_id}")
async def meeting_socket(websocket: WebSocket, meeting_id: str, peer_id: str):
    normalized = normalize_meeting_id(meeting_id)
    with SessionLocal() as db:
        meeting = db.scalar(select(Meeting).where(func.replace(Meeting.meeting_id, " ", "") == normalized))
    if not meeting:
        await websocket.close(code=1008, reason="Meeting not found")
        return

    try: user_id = int(websocket.query_params.get("userId", "0"))
    except ValueError: user_id = 0
    user = None
    if user_id > 0:
        with SessionLocal() as db:
            user = db.get(User, user_id)
        if not user:
            await websocket.close(code=1008, reason="User not found")
            return
    name = (websocket.query_params.get("name") or (user.name if user else "Guest")).strip()[:80] or "Guest"
    host = user_id > 0 and meeting.owner_user_id == user_id
    await websocket.accept()

    async with room_lock:
        existing = active_sessions.get(user_id) if user_id > 0 else None
    if existing and existing[1] != peer_id:
        await websocket.send_json({"type": "session-conflict", "meetingId": existing[0]})
    else:
        await activate_socket(normalized, peer_id, user_id, name, host, websocket)

    try:
        while True:
            data = await websocket.receive_json()
            kind = data.get("type")

            if kind == "switch-session" and user_id > 0:
                async with room_lock:
                    existing = active_sessions.get(user_id) if user_id > 0 else None
                    old_room, old_peer = existing if existing else (None, None)
                    old_ws = rooms.get(old_room, {}).get(old_peer) if old_room and old_peer else None
                    if old_ws and old_peer != peer_id:
                        try: await old_ws.send_json({"type": "session-switched", "meetingId": normalized})
                        except Exception: pass
                        try: await old_ws.close(code=4008, reason="Meeting switched to another window")
                        except Exception: pass
                        rooms.get(old_room, {}).pop(old_peer, None)
                        old_user = room_users.get(old_room, {}).pop(old_peer, None)
                        if not rooms.get(old_room):
                            rooms.pop(old_room, None); room_users.pop(old_room, None)
                    active_sessions.pop(user_id, None)
                if old_room and old_peer and old_peer != peer_id:
                    await broadcast(old_room, {"type": "peer-left", "peerId": old_peer})
                await activate_socket(normalized, peer_id, user_id, name, host, websocket)
                continue

            # Before switch, a conflict socket can only request switch.
            if peer_id not in room_users.get(normalized, {}):
                continue

            if kind in {"offer", "answer", "ice-candidate"}:
                target = data.get("target")
                target_ws = rooms.get(normalized, {}).get(target)
                if target_ws:
                    await target_ws.send_json({**data, "from": peer_id})
            elif kind == "media-state":
                user_state = room_users.get(normalized, {}).get(peer_id)
                if user_state:
                    if "muted" in data: user_state["muted"] = bool(data["muted"])
                    if "cameraOff" in data: user_state["cameraOff"] = bool(data["cameraOff"])
                    if "screenOn" in data: user_state["screenOn"] = bool(data["screenOn"])
                    await broadcast(normalized, {"type": "participant-updated", "peerId": peer_id,
                        "changes": {"muted": user_state["muted"], "cameraOff": user_state["cameraOff"], "screenOn": user_state["screenOn"]}})
            elif kind == "chat":
                await broadcast(normalized, {"type": "chat", "message": {
                    "id": secrets.token_hex(8), "peerId": peer_id, "name": name,
                    "text": str(data.get("text", ""))[:1000], "sentAt": datetime.utcnow().isoformat()}})
            elif kind == "mute-all":
                sender = room_users.get(normalized, {}).get(peer_id, {})
                if sender.get("host"):
                    for pid, state in room_users.get(normalized, {}).items():
                        if pid != peer_id: state["muted"] = True
                    await broadcast(normalized, {"type": "mute-all", "by": peer_id})
                    await broadcast(normalized, {"type": "participants-snapshot", "participants": list(room_users.get(normalized, {}).values())})
            elif kind == "remove-participant":
                sender = room_users.get(normalized, {}).get(peer_id, {})
                target = data.get("target")
                target_ws = rooms.get(normalized, {}).get(target)
                if sender.get("host") and target_ws:
                    await target_ws.send_json({"type": "removed", "reason": "The host removed you from the meeting."})
                    await target_ws.close(code=4003, reason="Removed by host")
                    await remove_peer(normalized, target)
            elif kind == "participant-status":
                state = room_users.get(normalized, {}).get(peer_id)
                if state:
                    state["status"] = data.get("status") if data.get("status") in {"✋", "⌛", "✅", "❌", "⏪", "⏩", "☕"} else ""
                    await broadcast(normalized, {"type": "participant-updated", "peerId": peer_id, "changes": {"status": state["status"]}})
            elif kind == "reaction":
                sender = room_users.get(normalized, {}).get(peer_id, {})
                await broadcast(normalized, {"type": "reaction", "peerId": peer_id,
                    "name": sender.get("name", name), "emoji": data.get("emoji", "👍")})
            elif kind == "end-meeting":
                sender = room_users.get(normalized, {}).get(peer_id, {})
                if sender.get("host"):
                    await broadcast(normalized, {"type": "meeting-ended", "by": peer_id}, exclude=peer_id)
                    for pid, ws in list(rooms.get(normalized, {}).items()):
                        if pid != peer_id:
                            try: await ws.close(code=4001, reason="Meeting ended by host")
                            except Exception: pass
                    await remove_peer(normalized, peer_id, notify=False)
                    try: await websocket.close(code=4001, reason="Meeting ended")
                    except Exception: pass
                    return
            elif kind == "host-leave":
                sender = room_users.get(normalized, {}).get(peer_id, {})
                if sender.get("host"):
                    await broadcast(normalized, {"type": "host-left", "message": "The host left. The meeting remains open."}, exclude=peer_id)
                    await remove_peer(normalized, peer_id)
                    return
    except WebSocketDisconnect:
        await remove_peer(normalized, peer_id)
    except Exception:
        await remove_peer(normalized, peer_id)
