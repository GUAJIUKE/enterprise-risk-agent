"""Mock 数据源：从 data/companies/*.json 加载企业数据（内存缓存）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config import DATA_DIR
from ..utils.logger import get_logger

logger = get_logger("data")

COMPANY_DIR = DATA_DIR / "companies"


class DataStore:
    """企业 Mock 数据仓库（工商 / 风险事件 / 财务）。"""

    def __init__(self) -> None:
        self._companies: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    def load(self) -> None:
        if self._loaded:
            return
        if not COMPANY_DIR.exists():
            logger.warning("企业数据目录不存在: %s", COMPANY_DIR)
            self._loaded = True
            return

        for path in sorted(COMPANY_DIR.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                logger.error("企业数据解析失败: %s - %s", path.name, exc)
                continue
            for company in payload if isinstance(payload, list) else [payload]:
                name = company.get("company_name") or company.get("name")
                if name:
                    self._companies[str(name)] = company
                    for alias in company.get("aliases", []) or []:
                        self._companies[str(alias)] = company
        logger.info("已加载 %d 家企业数据", len(self._companies))
        self._loaded = True

    # ---------- 查询 ----------

    def all_names(self) -> List[str]:
        self.load()
        return sorted({c.get("company_name", "") for c in self._companies.values() if c.get("company_name")})

    def get_company(self, company_name: str) -> Optional[Dict[str, Any]]:
        self.load()
        if not company_name:
            return None
        # 精确 -> 包含 -> 模糊（去掉"有限公司"等后缀）
        if company_name in self._companies:
            return self._companies[company_name]
        for name, company in self._companies.items():
            if company_name in name or name in company_name:
                return company
        core = company_name.replace("有限公司", "").replace("股份", "").replace("科技", "")
        for name, company in self._companies.items():
            if core and core in name:
                return company
        return None

    def get_financials(self, company_name: str) -> Optional[List[Dict[str, Any]]]:
        company = self.get_company(company_name)
        return (company or {}).get("financials")

    def get_risks(self, company_name: str) -> List[Dict[str, Any]]:
        company = self.get_company(company_name)
        return (company or {}).get("risk_events", []) or []


_store = DataStore()


def get_store() -> DataStore:
    return _store


def data_dir() -> Path:
    return DATA_DIR
