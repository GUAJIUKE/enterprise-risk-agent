"""内存会话存储（Demo 规模，重启即清空）。"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional


class Session:
    def __init__(self, session_id: str, title: str = "") -> None:
        self.id = session_id
        self.title = title or "新会话"
        self.created_at = int(time.time() * 1000)
        self.updated_at = self.created_at
        self.messages: List[Dict[str, Any]] = []
        self.last_report: Optional[Dict[str, Any]] = None
        self.last_trajectory: List[Dict[str, Any]] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "message_count": len(self.messages),
        }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, Session] = {}

    def create(self, title: str = "") -> Session:
        sid = f"sess_{uuid.uuid4().hex[:8]}"
        session = Session(sid, title)
        self._sessions[sid] = session
        return session

    def get_or_create(self, session_id: Optional[str], title: str = "") -> Session:
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        if session_id:
            session = Session(session_id, title)
            self._sessions[session_id] = session
            return session
        return self.create(title)

    def get(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[Dict[str, Any]]:
        items = [s.to_dict() for s in self._sessions.values()]
        items.sort(key=lambda x: x["updated_at"], reverse=True)
        return items

    def append_message(self, session_id: str, role: str, content: str) -> None:
        session = self._sessions.get(session_id)
        if not session:
            return
        session.messages.append({"role": role, "content": content, "ts": int(time.time() * 1000)})
        session.updated_at = int(time.time() * 1000)
        if role == "user" and session.title in ("", "新会话"):
            session.title = content[:18]

    def save_result(
        self,
        session_id: str,
        answer: str,
        trajectory: List[Dict[str, Any]],
        report: Optional[Dict[str, Any]],
    ) -> None:
        session = self._sessions.get(session_id)
        if not session:
            return
        self.append_message(session_id, "assistant", answer)
        session.last_trajectory = trajectory
        session.last_report = report

    def delete(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


_store = SessionStore()


def get_session_store() -> SessionStore:
    return _store
