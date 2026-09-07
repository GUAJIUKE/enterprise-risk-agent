"""knowledge_search_tool：RAG 检索本地风险分析知识库。"""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field

from ..rag.retriever import get_retriever
from .base import BaseTool


class KnowledgeArgs(BaseModel):
    query: str = Field(..., description="检索问题，例如：资产负债率过高意味着什么")
    top_k: int = Field(3, ge=1, le=10, description="返回最相关的知识片段数量")


class KnowledgeSearchTool(BaseTool):
    """从本地 Markdown 知识库做 Top-K 向量检索，返回带 source 的知识片段。"""

    name = "knowledge_search_tool"
    description = (
        "从本地企业风险分析知识库中检索判断依据、评级阈值与分析方法（RAG）。"
        "当你需要引用风险判断标准、财务/法律风险分析方法论时使用。"
        "返回最相关的知识片段及其来源文档。"
    )
    args_model = KnowledgeArgs

    def execute(self, query: str, top_k: int = 3) -> Dict[str, Any]:
        chunks = get_retriever().search(query, top_k=top_k)
        if not chunks:
            return {
                "query": query,
                "chunks": [],
                "message": "知识库中未检索到相关内容（可能尚未建库或 query 过短）",
            }
        results: List[Dict[str, Any]] = [c.to_dict() for c in chunks]
        return {
            "query": query,
            "total_chunks": len(get_retriever().chunks),
            "chunks": results,
            "data_source": "本地知识库 (data/knowledge/*.md)",
        }
