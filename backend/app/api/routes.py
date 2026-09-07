"""HTTP 路由：统一响应格式 {code, message, data}。"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..agents.orchestrator import AgentOrchestrator
from ..config import get_settings
from ..models.schemas import ChatRequest, ChatResponse
from ..prompts.loader import get_all_prompts
from ..rag.retriever import get_retriever
from ..services.eval_service import run_eval
from ..services.session import get_session_store
from ..tools.registry import get_registry
from ..utils.logger import get_logger

logger = get_logger("api")

router = APIRouter(prefix="/api")


def ok(data: Any = None, message: str = "ok") -> Dict[str, Any]:
    """统一成功响应。"""
    return {"code": 0, "message": message, "data": data}


# ============================================================
# 健康检查 / 元信息
# ============================================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    s = get_settings()
    return ok(
        {
            "status": "healthy",
            "mode": "mock" if s.is_mock else "real",
            "model": s.LLM_MODEL if not s.is_mock else "mock-planner",
            "max_steps": s.MAX_STEPS,
            "tools": [t.name for t in get_registry().list()],
            "rag": get_retriever().stats(),
        }
    )


@router.get("/tools")
async def list_tools() -> Dict[str, Any]:
    return ok(
        {
            "count": len(get_registry().list()),
            "tools": [t.spec().model_dump() for t in get_registry().list()],
        }
    )


@router.get("/prompts")
async def list_prompts() -> Dict[str, Any]:
    return ok(get_all_prompts())


@router.get("/rag/stats")
async def rag_stats() -> Dict[str, Any]:
    return ok(get_retriever().stats())


# ============================================================
# 会话
# ============================================================

@router.get("/sessions")
async def list_sessions() -> Dict[str, Any]:
    return ok(get_session_store().list_sessions())


@router.get("/sessions/{session_id}")
async def get_session(session_id: str) -> Dict[str, Any]:
    session = get_session_store().get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return ok(
        {
            **session.to_dict(),
            "messages": session.messages,
            "trajectory": session.last_trajectory,
            "report": session.last_report,
        }
    )


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> Dict[str, Any]:
    deleted = get_session_store().delete(session_id)
    return ok({"deleted": deleted})


# ============================================================
# Chat（普通）
# ============================================================

@router.post("/chat")
async def chat(req: ChatRequest) -> Dict[str, Any]:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message 不能为空")

    store = get_session_store()
    session = store.get_or_create(req.session_id, title=req.message)
    store.append_message(session.id, "user", req.message)

    agent = AgentOrchestrator()
    try:
        result: ChatResponse = await agent.run(req.message, session_id=session.id)
    except Exception as exc:  # 兜底：不让异常直接把服务打挂
        logger.error("chat_failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Agent 执行失败: {exc}")

    store.save_result(
        session.id,
        result.answer,
        [s.model_dump(mode="json") for s in result.trajectory],
        result.report.model_dump() if result.report else None,
    )
    return ok(result.model_dump(mode="json"))


# ============================================================
# Chat（SSE 流式）
# ============================================================

def _sse(event: str, payload: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    """SSE 流式接口：start / step / token / report / done 事件。"""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message 不能为空")

    store = get_session_store()
    session = store.get_or_create(req.session_id, title=req.message)
    store.append_message(session.id, "user", req.message)

    agent = AgentOrchestrator()
    gen = agent.arun(req.message, session_id=session.id)

    async def event_stream() -> AsyncIterator[str]:
        result: Dict[str, Any] | None = None
        try:
            async for event in gen:
                etype = event["type"]
                if etype == "done":
                    # P0-4: done 事件已经是一个合并了 envelope 字段的 ChatResponse dict
                    result = event["data"]
                yield _sse(etype, event["data"])
            if result:
                store.save_result(session.id, result["answer"], result["trajectory"], result["report"])
        except Exception as exc:
            logger.error("stream_failed: %s", exc, exc_info=True)
            yield _sse("error", {"message": f"Agent 执行失败: {exc}"})
        finally:
            yield _sse("close", {"message": "stream closed"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# Eval
# ============================================================

@router.get("/eval")
async def eval_endpoint() -> Dict[str, Any]:
    summary = await run_eval()
    return ok(summary.model_dump())


# ============================================================
# 企业列表（前端提示用）
# ============================================================

@router.get("/companies")
async def list_companies() -> Dict[str, Any]:
    from ..tools.data_source import get_store

    return ok({"companies": get_store().all_names()})
