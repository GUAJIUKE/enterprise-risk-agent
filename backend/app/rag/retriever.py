"""轻量 RAG：Markdown 加载 → 切分 chunk → 向量化 → Top-K 检索（内存向量库）。"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from ..config import DATA_DIR
from ..utils.logger import get_logger
from .embeddings import cosine, get_embedding

logger = get_logger("rag")

KNOWLEDGE_DIR = DATA_DIR / "knowledge"
CHUNK_SIZE = 320
CHUNK_OVERLAP = 60


@dataclass
class Chunk:
    id: str
    text: str
    source: str
    heading: str = ""
    score: float = 0.0
    meta: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "text": self.text,
            "source": self.source,
            "heading": self.heading,
            "score": round(self.score, 4),
        }


def load_documents(directory: Path = KNOWLEDGE_DIR) -> List[tuple[str, str]]:
    """读取目录下所有 Markdown，返回 [(文件名, 正文)]。"""
    if not directory.exists():
        logger.warning("知识库目录不存在: %s", directory)
        return []
    docs: List[tuple[str, str]] = []
    for path in sorted(directory.glob("*.md")):
        docs.append((path.name, path.read_text(encoding="utf-8")))
    logger.info("知识库加载 %d 篇文档", len(docs))
    return docs


def split_markdown(text: str, source: str) -> List[Chunk]:
    """按 Markdown 标题切块，并在标题下按长度二次切分。"""
    chunks: List[Chunk] = []
    current_heading = "概述"
    buffer: List[str] = []

    def flush() -> None:
        if not buffer:
            return
        body = "\n".join(buffer).strip()
        if not body:
            return
        # 长段落按字符窗口滑动切分
        start = 0
        while start < len(body):
            piece = body[start : start + CHUNK_SIZE]
            if piece.strip():
                chunks.append(
                    Chunk(
                        id=f"{source}#{len(chunks)}",
                        text=piece.strip(),
                        source=source,
                        heading=current_heading,
                    )
                )
            start += max(CHUNK_SIZE - CHUNK_OVERLAP, 1)
        buffer.clear()

    for line in text.splitlines():
        if re.match(r"^#{1,4}\s+", line):
            flush()
            current_heading = line.lstrip("#").strip()
            continue
        buffer.append(line)
    flush()
    return chunks


class KnowledgeRetriever:
    """内存向量检索器（单例，懒加载建索引）。"""

    def __init__(self) -> None:
        self.chunks: List[Chunk] = []
        self._vectors: List[List[float]] = []
        self._indexed = False

    def build(self) -> None:
        if self._indexed:
            return
        embedder = get_embedding()
        for source, content in load_documents():
            self.chunks.extend(split_markdown(content, source))
        self._vectors = [embedder.embed(f"{c.heading}\n{c.text}") for c in self.chunks]
        self._indexed = True
        logger.info("RAG 索引构建完成：%d 个 chunk", len(self.chunks))

    def search(self, query: str, top_k: int = 3) -> List[Chunk]:
        self.build()
        if not self.chunks or not query.strip():
            return []
        embedder = get_embedding()
        q_vec = embedder.embed(query)
        scored = [
            Chunk(
                id=c.id,
                text=c.text,
                source=c.source,
                heading=c.heading,
                score=cosine(q_vec, v),
            )
            for c, v in zip(self.chunks, self._vectors)
        ]
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[: max(1, top_k)]

    def stats(self) -> Dict[str, object]:
        self.build()
        sources = sorted({c.source for c in self.chunks})
        return {"documents": len(sources), "chunks": len(self.chunks), "sources": sources}


_retriever = KnowledgeRetriever()


def get_retriever() -> KnowledgeRetriever:
    return _retriever


def peek_chunks(limit: int = 5) -> List[Dict[str, object]]:
    r = get_retriever()
    r.build()
    return [c.to_dict() for c in r.chunks[:limit]]
