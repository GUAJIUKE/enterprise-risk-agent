"""report_generator_tool：把前面工具的结果汇总成结构化风险报告。

设计要点：该工具声明 inject_context=True，Agent 执行时会自动把已收集的
observation 注入到参数里，避免 LLM 在对话里搬运大段 JSON。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..models.schemas import Metric, RiskEvidence, RiskLevel, RiskReport
from .base import BaseTool
from .data_source import get_store

LEVEL_SCORE: Dict[str, int] = {"LOW": 20, "MEDIUM": 55, "HIGH": 85}


class ReportArgs(BaseModel):
    """Report Generator 工具对外暴露的参数模型。

    P0-10 设计：4 个 trusted context 字段（company_info / risk_events / financial / knowledge）
    由 Agent Runtime 自动注入，不暴露给 LLM 的 function calling schema。
    防止 LLM 自己塞伪造 observation。
    """

    company_name: str = Field(..., description="企业全称")


class ReportGeneratorTool(BaseTool):
    """汇总生成结构化风险报告（企业概况 / 风险摘要 / 经营 / 财务 / 法律 / 等级 / 证据 / 建议）。"""

    name = "report_generator_tool"
    description = (
        "基于 Agent Runtime 已收集的企业信息、风险事件、财务指标与知识库依据，"
        "生成结构化风险报告。仅需传入企业全称（company_name）。"
        "前面的工具结果由 Runtime 自动注入，无需（也不允许）由模型再次传入。"
        "通常在完成信息收集后最后一步调用。"
    )
    args_model = ReportArgs

    # P0-10：声明这个工具的"内部 trusted context"由 Runtime 注入。
    # LLM 不能伪造这些字段。
    inject_context = True

    def execute(
        self,
        company_name: str,
        # trusted context：由 Runtime 注入，LLM 不允许传
        company_info: Optional[Dict[str, Any]] = None,
        risk_events: Optional[Dict[str, Any]] = None,
        financial: Optional[Dict[str, Any]] = None,
        knowledge: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        store = get_store()
        company = store.get_company(company_name)
        if not company:
            raise ValueError(f"未找到企业「{company_name}」，无法生成报告")

        info = company_info or {
            "company_name": company.get("company_name"),
            "established_at": company.get("established_at"),
            "registered_capital": company.get("registered_capital"),
            "industry": company.get("industry"),
            "status": company.get("status"),
            "employees": company.get("employees"),
        }
        events_payload = risk_events or {"events": company.get("risk_events", [])}
        events: List[Dict[str, Any]] = events_payload.get("events", []) or []

        # ---- 法律风险 ----
        legal_events = [e for e in events if e.get("type") in ("诉讼", "行政处罚", "股权冻结", "失信被执行")]
        high_legal = sum(1 for e in legal_events if e.get("level") == "HIGH")
        if high_legal >= 2:
            legal_risk: RiskLevel = "HIGH"
        elif legal_events:
            legal_risk = "MEDIUM"
        else:
            legal_risk = "LOW"

        # ---- 经营风险 ----
        abnormal = [e for e in events if e.get("type") in ("经营异常", "高管变更", "裁员", "停产")]
        if len(abnormal) >= 2 or company.get("status") != "存续":
            operation_risk: RiskLevel = "HIGH"
        elif abnormal:
            operation_risk = "MEDIUM"
        else:
            operation_risk = "LOW"

        # ---- 财务风险 ----
        fin_level: RiskLevel = "MEDIUM"
        metrics: List[Metric] = []
        fin_analysis = "未提供财务分析结果，财务风险暂按 MEDIUM 估计。"
        if financial:
            fin_level = financial.get("financial_risk_level", "MEDIUM")
            fin_analysis = financial.get("analysis", "")
            metrics = [Metric(**m) if isinstance(m, dict) else m for m in financial.get("metrics", [])]

        # ---- 综合评分 ----
        overall_score = round(
            LEVEL_SCORE[fin_level] * 0.45 + LEVEL_SCORE[legal_risk] * 0.33 + LEVEL_SCORE[operation_risk] * 0.22, 1
        )
        if overall_score >= 70:
            overall_risk: RiskLevel = "HIGH"
        elif overall_score >= 40:
            overall_risk = "MEDIUM"
        else:
            overall_risk = "LOW"

        # ---- 证据 ----
        evidence: List[RiskEvidence] = []
        for m in metrics:
            if m.name == "营业收入增长率" and isinstance(m.value, (int, float)) and m.value < 0:
                evidence.append(
                    RiskEvidence(
                        text=f"营业收入同比下降 {abs(m.value)}%（{m.comment}）",
                        source="financial_analysis_tool",
                        severity="HIGH",
                    )
                )
            if m.name == "资产负债率" and isinstance(m.value, (int, float)) and m.value >= 70:
                evidence.append(
                    RiskEvidence(text=f"资产负债率达到 {m.value}%，高于 70% 高风险线", source="financial_analysis_tool", severity="HIGH")
                )
            if m.name == "经营性现金流" and isinstance(m.value, (int, float)) and m.value < 0:
                evidence.append(
                    RiskEvidence(text=f"经营性现金流为 {m.value} 百万元，资金链承压", source="financial_analysis_tool", severity="HIGH")
                )
        for e in sorted(events, key=lambda x: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(x.get("level", "LOW"), 3))[:4]:
            evidence.append(
                RiskEvidence(
                    text=f"{e.get('date')} {e.get('type')}：{e.get('title')}",
                    source=e.get("source", "风险事件库"),
                    severity=e.get("level", "MEDIUM"),  # type: ignore[arg-type]
                )
            )

        # ---- 知识库依据 ----
        sources: List[str] = []
        if knowledge and knowledge.get("chunks"):
            sources = [c.get("source", "") for c in knowledge["chunks"] if c.get("source")]
        if events:
            sources.append("企业风险事件库")
        sources.append("Mock 财务数据")

        # ---- 建议 ----
        recommendations: List[str] = [
            "建议按季度复核财务报表，重点跟踪资产负债率与经营性现金流两项先行指标。",
        ]
        if fin_level == "HIGH":
            recommendations.append("财务风险偏高：建议压缩有息负债规模、延长债务久期，并准备 6 个月现金流压力测试。")
        if legal_risk != "LOW":
            recommendations.append("法律风险需处置：建议法务逐案梳理涉诉与处罚事项，评估预计负债并计提拨备。")
        if operation_risk == "HIGH":
            recommendations.append("经营稳定性偏弱：建议核实经营异常原因、核心人员流失情况与订单可持续性。")
        recommendations.append("合作建议：如确需合作，优先采用预付款 + 担保 + 分批交付的方式控制敞口。")

        business_risk = (
            f"企业当前经营状态为「{company.get('status')}」，"
            f"近一年监测到 {len(abnormal)} 条经营类异常事件（含经营异常、高管变更、裁员等），"
            f"员工规模 {company.get('employees')} 人。"
            if abnormal
            else f"企业当前经营状态为「{company.get('status')}」，未监测到重大经营异常事件，"
            f"员工规模 {company.get('employees')} 人，经营稳定性良好。"
        )

        legal_text = (
            f"共检索到 {len(legal_events)} 条法律相关事件，其中高危 {high_legal} 条。"
            + ("涉及诉讼、行政处罚或股权冻结，需重点关注合规与履约能力。" if legal_events else "暂无重大法律纠纷记录。")
        )

        summary = (
            f"{company_name} 综合风险等级为 **{overall_risk}**（评分 {overall_score}/100）。"
            f"财务风险 {fin_level}、法律风险 {legal_risk}、经营风险 {operation_risk}。"
            + (f"最突出的风险点是{evidence[0].text}。" if evidence else "暂未发现显著高风险信号。")
        )

        report = RiskReport(
            company_name=company.get("company_name", company_name),
            overall_risk=overall_risk,
            overall_score=overall_score,
            financial_risk=fin_level,
            legal_risk=legal_risk,
            operation_risk=operation_risk,
            summary=summary,
            business_risk=business_risk,
            financial_analysis=fin_analysis,
            legal_analysis=legal_text,
            metrics=metrics,
            evidence=evidence,
            recommendations=recommendations,
            sources=sorted(set(sources)),
        )
        return report.model_dump()
