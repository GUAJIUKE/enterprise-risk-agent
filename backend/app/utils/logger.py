"""结构化 JSON 日志：request_id / session_id / model / tokens / tool calls / latency / errors。"""

from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

from ..config import LOG_DIR, get_settings


class JsonFormatter(logging.Formatter):
    """把日志行输出为单行 JSON，方便采集到 ES / Loki 等。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def get_logger(name: str) -> logging.Logger:
    """获取带 JSON 格式化的 logger（stdout + 可选文件）。"""
    logger = logging.getLogger(f"era.{name}")
    if logger.handlers:
        return logger

    settings = get_settings()
    logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))
    logger.propagate = False

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(JsonFormatter())
    logger.addHandler(stream)

    if settings.LOG_TO_FILE:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8")
        file_handler.setFormatter(JsonFormatter())
        logger.addHandler(file_handler)

    return logger


def log_event(logger: logging.Logger, message: str, **fields: Any) -> None:
    """输出带业务字段的结构化日志。"""
    logger.info(message, extra={"extra_fields": fields})


class Timer:
    """轻量计时器，用于统计 latency。"""

    def __init__(self) -> None:
        self._start: Optional[float] = time.perf_counter()

    def elapsed_ms(self) -> int:
        if self._start is None:
            return 0
        return int((time.perf_counter() - self._start) * 1000)


def safe_trunc(value: Any, limit: int = 400) -> Any:
    """日志里截断超长字段，避免刷屏。"""
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + f"…(+{len(value) - limit})"
    return value


__all__ = ["get_logger", "log_event", "Timer", "safe_trunc", "Path"]
