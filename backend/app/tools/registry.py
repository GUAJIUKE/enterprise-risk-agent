"""工具注册入口：集中装配所有 Tool。"""

from __future__ import annotations

from .base import ToolRegistry
from .company_info import CompanyInfoTool
from .financial_analysis import FinancialAnalysisTool
from .knowledge_search import KnowledgeSearchTool
from .report_generator import ReportGeneratorTool
from .risk_search import RiskSearchTool


def build_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(CompanyInfoTool())
    registry.register(RiskSearchTool())
    registry.register(FinancialAnalysisTool())
    registry.register(KnowledgeSearchTool())
    registry.register(ReportGeneratorTool())
    return registry


_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = build_registry()
    return _registry
