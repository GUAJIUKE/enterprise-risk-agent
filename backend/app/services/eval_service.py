"""轻量 Agent Eval：同时报告 Required Recall / Tool Precision / F1 / Unexpected / Forbidden。

P1-6 设计要点：
- 单条用例支持 required_tools / allowed_tools / forbidden_tools
- 不再用单一 Accuracy 指标（容许多调导致虚高）
- 真正区分"必须调用"、"可选调用"、"禁止调用"

完整评测任务会逐条用例顺序执行（不并行，避免 RAG 索引竞争）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..agents.orchestrator import AgentOrchestrator
from ..config import ROOT_DIR, get_settings
from ..models.schemas import EvalCaseResult, EvalSummary
from ..utils.logger import get_logger

logger = get_logger("eval")

CASES_PATH = ROOT_DIR / "tests" / "eval_cases.json"


def load_cases(path: Path = CASES_PATH) -> List[Dict[str, Any]]:
    """加载评测用例。找不到文件时返回内置兜底用例。"""
    if not path.exists():
        logger.warning("评测用例文件不存在，使用内置用例: %s", path)
        return _default_cases()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        return payload.get("cases", [])
    return payload


def _default_cases() -> List[Dict[str, Any]]:
    return [
        {"id": "c1", "query": "查询星海科技基本信息",
         "required_tools": ["company_info_tool"], "forbidden_tools": ["report_generator_tool"]},
        {"id": "c2", "query": "分析星海科技财务风险",
         "required_tools": ["financial_analysis_tool"], "forbidden_tools": ["report_generator_tool"]},
        {"id": "c3", "query": "查询星海科技法律风险",
         "required_tools": ["risk_search_tool"], "forbidden_tools": ["report_generator_tool"]},
        {"id": "c4", "query": "企业资产负债率过高意味着什么",
         "required_tools": ["knowledge_search_tool"],
         "forbidden_tools": ["company_info_tool", "risk_search_tool", "financial_analysis_tool", "report_generator_tool"]},
        {"id": "c5", "query": "生成星海科技完整风险报告",
         "required_tools": ["company_info_tool", "risk_search_tool", "financial_analysis_tool",
                            "knowledge_search_tool", "report_generator_tool"]},
    ]


def _required_recall(required: List[str], actual: List[str]) -> float:
    if not required:
        return 1.0
    hit = sum(1 for t in required if t in actual)
    return round(hit / len(required), 3)


def _tool_precision(allowed: List[str], actual: List[str]) -> float:
    """实际调用的工具中，落在 allowed 范围内的比例。

    如果 allowed 为空（未声明），则 precision 视为 1.0，避免把"诚实重复声明"也算违规。
    """
    if not actual:
        return 1.0
    if not allowed:
        return 1.0
    good = sum(1 for t in actual if t in allowed)
    return round(good / len(actual), 3)


def _f1(recall: float, precision: float) -> float:
    if recall + precision == 0:
        return 0.0
    return round(2 * recall * precision / (recall + precision), 3)


async def _run_one(orchestrator: AgentOrchestrator, case: Dict[str, Any]) -> EvalCaseResult:
    required: List[str] = case.get("required_tools", []) or []
    allowed: List[str] = case.get("allowed_tools", []) or []
    forbidden: List[str] = case.get("forbidden_tools", []) or []
    # 兼容老的 expected_tools 写法（自动升级为 required_tools）
    if not required and case.get("expected_tools"):
        required = list(case["expected_tools"])

    try:
        resp = await orchestrator.run(case.get("query", ""))
        actual = [s.action for s in resp.trajectory if s.action and s.action not in ("finalize", "error")]
        forbidden_hits = [t for t in actual if t in forbidden]
        unexpected = [t for t in actual if allowed and t not in allowed]

        recall = _required_recall(required, actual)
        precision = _tool_precision(allowed, actual)
        f1 = _f1(recall, precision)

        success = (
            resp.error is None
            and recall >= 0.99
            and not forbidden_hits
            and bool(resp.answer)
        )
        return EvalCaseResult(
            id=str(case.get("id", "")),
            query=case.get("query", ""),
            required_tools=required,
            allowed_tools=allowed,
            forbidden_tools=forbidden,
            actual_tools=actual,
            unexpected_tools=unexpected,
            forbidden_hits=forbidden_hits,
            required_recall=recall,
            tool_precision=precision,
            tool_f1=f1,
            success=success,
            steps=resp.steps,
            latency_ms=float(resp.latency_ms or 0),
        )
    except Exception as exc:  # 单用例失败不影响整体
        logger.error("eval_case_error: %s", exc, exc_info=True)
        return EvalCaseResult(
            id=str(case.get("id", "")),
            query=case.get("query", ""),
            required_tools=required,
            allowed_tools=allowed,
            forbidden_tools=forbidden,
            actual_tools=[],
            unexpected_tools=[],
            forbidden_hits=[],
            error=str(exc),
            success=False,
        )


async def run_eval(path: Optional[Path] = None) -> EvalSummary:
    """顺序执行所有评测用例（不并行；直接调用 Agent，不走 HTTP）。"""
    cases = load_cases(path or CASES_PATH)
    orchestrator = AgentOrchestrator()
    results: List[EvalCaseResult] = []
    for case in cases:
        results.append(await _run_one(orchestrator, case))

    total = len(results) or 1
    s = get_settings()
    summary = EvalSummary(
        total_cases=len(results),
        task_success_rate=round(sum(1 for r in results if r.success) / total, 3),
        required_recall=round(sum(r.required_recall for r in results) / total, 3),
        tool_precision=round(sum(r.tool_precision for r in results) / total, 3),
        tool_f1=round(sum(r.tool_f1 for r in results) / total, 3),
        unexpected_calls=sum(len(r.unexpected_tools) for r in results),
        forbidden_hits=sum(len(r.forbidden_hits) for r in results),
        avg_steps=round(sum(r.steps for r in results) / total, 2),
        avg_latency_ms=round(sum(r.latency_ms for r in results) / total, 1),
        cases=results,
        mode="mock" if s.is_mock else "real",
        model=s.LLM_MODEL if not s.is_mock else "mock-planner",
    )
    logger.info(
        "eval_finished",
        extra={
            "extra_fields": {
                "success_rate": summary.task_success_rate,
                "required_recall": summary.required_recall,
                "tool_precision": summary.tool_precision,
                "tool_f1": summary.tool_f1,
                "unexpected_calls": summary.unexpected_calls,
                "forbidden_hits": summary.forbidden_hits,
            }
        },
    )
    return summary
