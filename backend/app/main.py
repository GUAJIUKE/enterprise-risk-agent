"""FastAPI 应用入口。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import ensure_dirs, get_settings
from .utils.logger import get_logger, log_event

ensure_dirs()
settings = get_settings()
logger = get_logger("main")

app = FastAPI(
    title="Enterprise Risk Analyst Agent",
    description="企业风险分析智能体 · LLM Agent + Tool Calling + RAG Demo",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def on_startup() -> None:
    # 预热：加载企业数据 + 构建 RAG 索引，避免首请求抖动
    from .rag.retriever import get_retriever
    from .tools.data_source import get_store

    get_store().load()
    stats = get_retriever().stats()
    log_event(
        logger,
        "service_started",
        mode="mock" if settings.is_mock else "real",
        model=settings.LLM_MODEL if not settings.is_mock else "mock-planner",
        rag_chunks=stats.get("chunks"),
        rag_documents=stats.get("documents"),
    )
    print(
        f"\n  Enterprise Risk Analyst Agent 已启动\n"
        f"  模式: {'MOCK（无需 API Key）' if settings.is_mock else 'REAL @ ' + settings.LLM_MODEL}\n"
        f"  RAG: {stats.get('chunks')} chunks / {stats.get('documents')} docs\n"
        f"  Docs: http://127.0.0.1:{settings.PORT}/docs\n"
    )


@app.get("/")
async def root() -> dict:
    return {
        "name": "Enterprise Risk Analyst Agent",
        "version": "1.0.0",
        "mode": "mock" if settings.is_mock else "real",
        "docs": "/docs",
    }
