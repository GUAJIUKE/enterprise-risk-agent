"""company_info_tool：查询企业工商基本信息。"""

from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, Field

from .base import BaseTool
from .data_source import get_store


class CompanyInfoArgs(BaseModel):
    company_name: str = Field(..., description="企业全称，例如：星海科技有限公司")


class CompanyInfoTool(BaseTool):
    """查询企业名称、成立时间、注册资本、行业、经营状态、员工规模等。"""

    name = "company_info_tool"
    description = (
        "查询企业工商基本信息。返回企业名称、成立时间、注册资本、所属行业、"
        "经营状态、员工数量、注册地址、法定代表人等。当需要确认企业身份或获取背景信息时使用。"
    )
    args_model = CompanyInfoArgs

    def execute(self, company_name: str) -> Dict[str, Any]:
        store = get_store()
        company = store.get_company(company_name)
        if not company:
            # 不编造数据：明确告知无此企业，Agent 可据此调整策略
            raise ValueError(f"未找到企业「{company_name}」的工商数据，可查询的企业：{', '.join(store.all_names())}")

        return {
            "company_name": company.get("company_name"),
            "established_at": company.get("established_at"),
            "registered_capital": company.get("registered_capital"),
            "industry": company.get("industry"),
            "status": company.get("status"),
            "employees": company.get("employees"),
            "legal_person": company.get("legal_person"),
            "address": company.get("address"),
            "business_scope": company.get("business_scope"),
            "credit_code": company.get("credit_code"),
            "data_source": "Mock 工商数据库 (data/companies)",
        }
