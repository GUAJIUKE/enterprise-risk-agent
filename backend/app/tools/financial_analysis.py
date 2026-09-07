"""financial_analysis_tool：财务指标计算（全部由 Python 完成，不让 LLM 心算）。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..models.schemas import Metric, RiskLevel
from .base import BaseTool
from .data_source import get_store


class FinancialArgs(BaseModel):
    company_name: str = Field(..., description="企业全称")


def _pct(new: float, old: float) -> Optional[float]:
    """增长率（百分比），分母为 0 时返回 None。"""
    if old == 0:
        return None
    return round((new - old) / abs(old) * 100, 2)


def _score_to_level(score: int) -> RiskLevel:
    if score >= 60:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"


class FinancialAnalysisTool(BaseTool):
    """基于 Mock 财务数据计算增长率、资产负债率、现金流变化并给出财务风险等级。"""

    name = "financial_analysis_tool"
    description = (
        "分析企业财务指标：营业收入增长率、净利润增长率、资产负债率、经营性现金流变化，"
        "并输出财务风险等级（LOW/MEDIUM/HIGH）。所有数值由 Python 精确计算。"
        "当需要评估企业偿债能力、盈利趋势或资金链状况时使用。"
    )
    args_model = FinancialArgs

    # 阈值（与 data/knowledge/财务风险判断规则.md 保持一致）
    DEBT_HIGH = 70.0
    DEBT_MEDIUM = 50.0

    def execute(self, company_name: str) -> Dict[str, Any]:
        store = get_store()
        company = store.get_company(company_name)
        if not company:
            raise ValueError(f"未找到企业「{company_name}」的财务数据")

        financials: List[Dict[str, Any]] = company.get("financials") or []
        if len(financials) < 2:
            raise ValueError(f"企业「{company_name}」财务数据不足（至少需要两期）")

        financials = sorted(financials, key=lambda f: f.get("year", 0))
        curr, prev = financials[-1], financials[-2]

        revenue_growth = _pct(float(curr["revenue"]), float(prev["revenue"]))
        profit_growth = _pct(float(curr["net_profit"]), float(prev["net_profit"]))
        debt_ratio = round(float(curr["total_liabilities"]) / float(curr["total_assets"]) * 100, 2)
        prev_debt_ratio = round(float(prev["total_liabilities"]) / float(prev["total_assets"]) * 100, 2)
        cashflow_change = _pct(float(curr["operating_cashflow"]), float(prev["operating_cashflow"]))
        cashflow_value = float(curr["operating_cashflow"])

        # ---- 风险打分（0-100，越高越危险）----
        score = 0
        reasons: List[str] = []

        if debt_ratio >= self.DEBT_HIGH:
            score += 40
            reasons.append(f"资产负债率 {debt_ratio}%，高于 {self.DEBT_HIGH}% 的高风险阈值，长期偿债压力较大")
        elif debt_ratio >= self.DEBT_MEDIUM:
            score += 20
            reasons.append(f"资产负债率 {debt_ratio}%，处于 {self.DEBT_MEDIUM}%-{self.DEBT_HIGH}% 的警戒区间")
        else:
            reasons.append(f"资产负债率 {debt_ratio}%，处于合理水平")

        if revenue_growth is not None:
            if revenue_growth <= -15:
                score += 25
                reasons.append(f"营业收入同比下滑 {abs(revenue_growth)}%，超过 15% 的显著萎缩线")
            elif revenue_growth < 0:
                score += 10
                reasons.append(f"营业收入同比下滑 {abs(revenue_growth)}%，需关注趋势")
            else:
                reasons.append(f"营业收入同比增长 {revenue_growth}%")

        if profit_growth is not None:
            if profit_growth <= -30:
                score += 25
                reasons.append(f"净利润同比下滑 {abs(profit_growth)}%，盈利能力明显恶化")
            elif profit_growth < 0:
                score += 10
                reasons.append(f"净利润同比下滑 {abs(profit_growth)}%")
            else:
                reasons.append(f"净利润同比增长 {profit_growth}%")

        if cashflow_value < 0:
            score += 20
            reasons.append("经营性现金流为负，存在资金链紧张风险")
        elif cashflow_change is not None and cashflow_change < 0:
            score += 8
            reasons.append(f"经营性现金流同比下降 {abs(cashflow_change)}%")

        score = min(score, 100)
        level = _score_to_level(score)

        metrics: List[Metric] = [
            Metric(
                name="营业收入增长率",
                value=revenue_growth if revenue_growth is not None else "N/A",
                unit="%",
                comment=f"{prev['year']}→{curr['year']}",
            ),
            Metric(
                name="净利润增长率",
                value=profit_growth if profit_growth is not None else "N/A",
                unit="%",
                comment=f"{prev['year']}→{curr['year']}",
            ),
            Metric(
                name="资产负债率",
                value=debt_ratio,
                unit="%",
                comment=f"上期 {prev_debt_ratio}%，{'上升' if debt_ratio > prev_debt_ratio else '下降'}",
            ),
            Metric(
                name="经营性现金流",
                value=round(cashflow_value / 1e6, 2),
                unit="百万元",
                comment=f"同比 {cashflow_change if cashflow_change is not None else 'N/A'}%",
            ),
        ]

        return {
            "company_name": company.get("company_name"),
            "period": f"{prev['year']} - {curr['year']}",
            "financial_risk_level": level,
            "risk_score": score,
            "analysis": "；".join(reasons) + "。",
            "metrics": [m.model_dump() for m in metrics],
            "raw": financials,
        }
