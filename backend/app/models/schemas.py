"""统一的请求 / 响应数据模型（Pydantic v2）。"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ============ Tool ============

class ToolParameter(BaseModel):
    """工具参数的 JSON Schema 描述（用于 LLM function calling）。"""

    type: str = "object"
    properties: Dict[str, Any] = Field(default_factory=dict)
    required: List[str] = Field(default_factory=list)


class ToolSpec(BaseModel):
    """暴露给 LLM 的工具定义。"""

    name: str
    description: str
    parameters: ToolParameter


class ToolResult(BaseModel):
    """工具执行的统一返回结构。"""

    success: bool
    data: Any = None
    error: Optional[str] = None
    duration_ms: int = 0

    @classmethod
    def ok(cls, data: Any, duration_ms: int = 0) -> "ToolResult":
        return cls(success=True, data=data, duration_ms=duration_ms)

    @classmethod
    def fail(cls, error: str, duration_ms: int = 0) -> "ToolResult":
        return cls(success=False, error=error, duration_ms=duration_ms)


class ToolCall(BaseModel):
    """LLM 产出的一次工具调用请求。"""

    id: str = ""
    name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)


# ============ Agent trajectory ============

class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"


class TrajectoryStep(BaseModel):
    """Agent 单步执行记录。

    注意：thought_summary 只保存面向用户的简短行动说明，
    不保存模型内部 Chain-of-Thought。
    """

    step: int
    thought_summary: str = ""
    action: str = ""                       # 工具名，或 finish / error
    input: Dict[str, Any] = Field(default_factory=dict)
    status: StepStatus = StepStatus.SUCCESS
    duration_ms: int = 0
    observation: Any = None
    error: Optional[str] = None


# ============ Risk report ============

RiskLevel = Literal["LOW", "MEDIUM", "HIGH"]


class Metric(BaseModel):
    name: str
    value: Any
    unit: str = ""
    comment: str = ""


class RiskEvidence(BaseModel):
    text: str
    source: str = ""
    severity: RiskLevel = "MEDIUM"


class RiskReport(BaseModel):
    """结构化风险报告。"""

    company_name: str
    overall_risk: RiskLevel = "MEDIUM"
    overall_score: float = 0.0             # 0-100，越高风险越大
    financial_risk: RiskLevel = "MEDIUM"
    legal_risk: RiskLevel = "LOW"
    operation_risk: RiskLevel = "MEDIUM"
    summary: str = ""
    business_risk: str = ""
    financial_analysis: str = ""
    legal_analysis: str = ""
    metrics: List[Metric] = Field(default_factory=list)
    evidence: List[RiskEvidence] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    sources: List[str] = Field(default_factory=list)


# ============ Chat API ============

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    request_id: str
    session_id: str
    answer: str
    trajectory: List[TrajectoryStep] = Field(default_factory=list)
    report: Optional[RiskReport] = None
    model: str = ""
    mode: str = "mock"                     # mock | real
    steps: int = 0
    latency_ms: int = 0
    usage: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


# ============ Eval ============

class EvalCaseResult(BaseModel):
    """单条 Eval 结果：支持 required/allowed/forbidden + Recall/Precision/F1 多指标。

    P1-6 重要：单一 recall-only 指标会虚高。现改为四个独立维度：
        - required_recall: 必选 Tool 是否被调全
        - tool_precision:  实际调用是否落在 allowed 范围内
        - tool_f1:         precision 与 recall 调和均值
        - forbidden_hits:  是否调用了 forbidden 工具（必须为 0）
    """

    id: str
    query: str
    required_tools: List[str] = Field(default_factory=list)
    allowed_tools: List[str] = Field(default_factory=list)
    forbidden_tools: List[str] = Field(default_factory=list)
    actual_tools: List[str] = Field(default_factory=list)
    unexpected_tools: List[str] = Field(default_factory=list)
    forbidden_hits: List[str] = Field(default_factory=list)
    required_recall: float = 0.0
    tool_precision: float = 0.0
    tool_f1: float = 0.0
    success: bool = False
    steps: int = 0
    latency_ms: float = 0.0
    error: Optional[str] = None


class EvalSummary(BaseModel):
    total_cases: int = 0
    mode: str = "mock"
    model: str = ""
    task_success_rate: float = 0.0
    required_recall: float = 0.0
    tool_precision: float = 0.0
    tool_f1: float = 0.0
    unexpected_calls: int = 0
    forbidden_hits: int = 0
    avg_steps: float = 0.0
    avg_latency_ms: float = 0.0
    cases: List[EvalCaseResult] = Field(default_factory=list)
