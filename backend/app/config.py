"""全局配置。优先读取环境变量 / backend/.env。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> backend/ -> 项目根
ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
DATA_DIR = ROOT_DIR / "data"
LOG_DIR = BACKEND_DIR / "logs"


class Settings(BaseSettings):
    """应用设置（pydantic-settings 自动从环境变量读取）。"""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- LLM ----
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = "https://api.openai.com/v1"
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_TIMEOUT: float = 60.0
    LLM_TEMPERATURE: float = 0.2

    # ---- 运行模式 ----
    # MOCK_LLM=true 时不需要任何 API Key，Agent 依然完整跑通全流程
    MOCK_LLM: bool = True

    # ---- Embedding（RAG 用）----
    # local: 本地轻量向量（离线可用，零依赖）；openai: 调用 OpenAI-compatible embedding 接口
    EMBEDDING_PROVIDER: str = "local"
    EMBEDDING_MODEL: str = "text-embedding-3-small"

    # ---- Agent ----
    MAX_STEPS: int = 8              # Agent 最大步数，防止死循环
    TOOL_TIMEOUT: float = 15.0      # 单工具超时（秒）
    MAX_TOOL_REPEAT: int = 2        # 同一工具相同参数最多重复次数，超过即告警/熔断

    # ---- 服务 ----
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    RELOAD: bool = True
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"

    # ---- 日志 ----
    LOG_LEVEL: str = "INFO"
    LOG_TO_FILE: bool = True

    @property
    def is_mock(self) -> bool:
        """是否处于 Mock 模式（无 Key 时自动降级为 Mock）。"""
        return self.MOCK_LLM or not self.LLM_API_KEY.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_dirs() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


settings: Optional[Settings] = None  # 占位，实际统一用 get_settings()
