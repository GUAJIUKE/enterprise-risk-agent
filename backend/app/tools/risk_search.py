"""risk_search_tool：查询企业风险事件（诉讼 / 行政处罚 / 经营异常 / 股权冻结 / 高管变更）。"""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field

from .base import BaseTool
from .data_source import get_store

RISK_TYPES = ("legal", "financial", "operation", "all")

# 风险类型 -> 事件类型映射
TYPE_MAP: Dict[str, List[str]] = {
    "legal": ["诉讼", "行政处罚", "股权冻结", "失信被执行"],
    "financial": ["欠税", "债务违约", "资金链紧张", "财务造假"],
    "operation": ["经营异常", "高管变更", "裁员", "停产"],
}


class RiskSearchArgs(BaseModel):
    company_name: str = Field(..., description="企业全称")
    risk_type: str = Field("all", description="风险类型：legal / financial / operation / all")


class RiskSearchTool(BaseTool):
    """检索企业风险事件，按类型过滤。"""

    name = "risk_search_tool"
    description = (
        "检索企业风险事件（诉讼、行政处罚、经营异常、股权冻结、高管变更等）。"
        "risk_type 可选 legal（法律）/ financial（财务）/ operation（经营）/ all（全部）。"
        "当需要了解企业发生过哪些负面事件时使用。"
    )
    args_model = RiskSearchArgs

    def execute(self, company_name: str, risk_type: str = "all") -> Dict[str, Any]:
        risk_type = (risk_type or "all").lower()
        if risk_type not in RISK_TYPES:
            raise ValueError(f"risk_type 必须是 {RISK_TYPES} 之一，收到：{risk_type}")

        store = get_store()
        company = store.get_company(company_name)
        if not company:
            raise ValueError(f"未找到企业「{company_name}」的风险数据")

        events: List[Dict[str, Any]] = company.get("risk_events", []) or []
        if risk_type != "all":
            allow = TYPE_MAP[risk_type]
            events = [e for e in events if e.get("type") in allow]

        # 高危优先、时间倒序
        level_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
        events = sorted(events, key=lambda e: (level_order.get(e.get("level", "LOW"), 3), str(e.get("date", ""))), reverse=False)

        count_by_level = {
            "HIGH": sum(1 for e in events if e.get("level") == "HIGH"),
            "MEDIUM": sum(1 for e in events if e.get("level") == "MEDIUM"),
            "LOW": sum(1 for e in events if e.get("level") == "LOW"),
        }

        return {
            "company_name": company.get("company_name"),
            "risk_type": risk_type,
            "total": len(events),
            "count_by_level": count_by_level,
            "events": events,
            "data_source": "Mock 风险事件库 (data/companies)",
        }
