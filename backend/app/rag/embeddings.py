"""Embedding 抽象：默认本地轻量向量（离线可用），可选 OpenAI-compatible。"""

from __future__ import annotations

import hashlib
import math
import re
from abc import ABC, abstractmethod
from typing import Dict, List

from ..config import get_settings
from ..utils.logger import get_logger

logger = get_logger("rag.embedding")

WORD_RE = re.compile(r"[\u4e00-\u9fa5]|[A-Za-z]+|\d+")


class BaseEmbedding(ABC):
    dim: int = 256

    @abstractmethod
    def embed(self, text: str) -> List[float]:
        ...


class LocalHashingEmbedding(BaseEmbedding):
    """零依赖本地向量：中文单字 + 英文单词 + 数字 的 hashing trick + L2 归一化。

    面试话术：生产环境可替换为 bge / text-embedding-3，接口一致。
    """

    dim = 256

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    def embed(self, text: str) -> List[float]:
        vec = [0.0] * self.dim
        tokens = WORD_RE.findall(text.lower())
        # 中文补充 bigram，保留一点词序信息
        chinese = "".join(t for t in tokens if "\u4e00" <= t <= "\u9fa5")
        tokens = tokens + [chinese[i : i + 2] for i in range(len(chinese) - 1)]

        for token in tokens:
            digest = hashlib.md5(token.encode("utf-8")).hexdigest()
            idx = int(digest[:8], 16) % self.dim
            sign = 1.0 if int(digest[8:10], 16) % 2 == 0 else -1.0
            vec[idx] += sign

        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class OpenAIEmbedding(BaseEmbedding):
    """OpenAI-compatible embedding 接口（需要 EMBEDDING_PROVIDER=openai + API Key）。"""

    def __init__(self) -> None:
        from openai import OpenAI  # 延迟导入

        s = get_settings()
        self.model = s.EMBEDDING_MODEL
        self.client = OpenAI(api_key=s.LLM_API_KEY, base_url=s.LLM_BASE_URL, timeout=s.LLM_TIMEOUT)
        self.dim = 1536

    def embed(self, text: str) -> List[float]:
        resp = self.client.embeddings.create(model=self.model, input=text)
        return list(resp.data[0].embedding)


def cosine(a: List[float], b: List[float]) -> float:
    """真实 cosine 相似度：dot(a,b) / (norm(a) * norm(b))。

    注意：不要假定 embedding 向量已 L2 归一化。
    OpenAI 兼容 embedding 通常未归一化，本地 LocalHashing 默认归一化。
    为保证数学严谨性，这里总是重新计算 norm。
    """
    if len(a) != len(b):
        # 维度不同时按较短长度截断（仅本地向量会用到）
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    denom = norm_a * norm_b
    if denom == 0:
        return 0.0
    return dot / denom


_cache: Dict[str, BaseEmbedding] = {}


def get_embedding() -> BaseEmbedding:
    s = get_settings()
    key = s.EMBEDDING_PROVIDER
    if key in _cache:
        return _cache[key]
    if key == "openai" and s.LLM_API_KEY:
        emb: BaseEmbedding = OpenAIEmbedding()
    else:
        emb = LocalHashingEmbedding()
    _cache[key] = emb
    return emb
