"""统一 LLM Client：OpenAI-compatible 真实模式 + Mock 模式。

两种模式对外暴露完全一致的接口，Agent 层无需感知差异：
    client.chat(messages, tools) -> LLMResponse
"""

from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from ..config import get_settings
from ..models.schemas import ToolCall, ToolSpec
from ..utils.logger import get_logger

logger = get_logger("llm")


# ============================================================
# 数据结构
# ============================================================

class LLMResponse:
    """统一的 LLM 返回结构。"""

    def __init__(
        self,
        content: str = "",
        tool_calls: Optional[List[ToolCall]] = None,
        usage: Optional[Dict[str, Any]] = None,
        raw: Optional[Dict[str, Any]] = None,
        latency_ms: int = 0,
    ) -> None:
        self.content = content or ""
        self.tool_calls = tool_calls or []
        self.usage = usage or {}
        self.raw = raw or {}
        self.latency_ms = latency_ms

    @property
    def has_tool_call(self) -> bool:
        return bool(self.tool_calls)


def tool_spec_to_openai(spec: ToolSpec) -> Dict[str, Any]:
    """把内部 ToolSpec 转成 OpenAI function calling 的 schema。"""
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.parameters.model_dump(exclude_none=True),
        },
    }


# ============================================================
# 基类
# ============================================================

class BaseLLMClient(ABC):
    name: str = "base"

    @abstractmethod
    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[ToolSpec]] = None,
    ) -> LLMResponse:
        ...


# ============================================================
# 真实模式：OpenAI-compatible
# ============================================================

class OpenAICompatClient(BaseLLMClient):
    """通过 openai SDK 调用任意 OpenAI-compatible 接口（OpenAI / DeepSeek / 通义 / Moonshot / 本地 vLLM…）。"""

    name: str = "openai-compatible"

    def __init__(self) -> None:
        from openai import OpenAI  # 延迟导入：Mock 模式下不必安装 openai

        s = get_settings()
        self.model = s.LLM_MODEL
        self.client = OpenAI(
            api_key=s.LLM_API_KEY,
            base_url=s.LLM_BASE_URL,
            timeout=s.LLM_TIMEOUT,
        )
        self._supports_tools = True

    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[ToolSpec]] = None,
    ) -> LLMResponse:
        s = get_settings()
        started = time.perf_counter()
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": s.LLM_TEMPERATURE,
        }
        if tools and self._supports_tools:
            kwargs["tools"] = [tool_spec_to_openai(t) for t in tools]
            kwargs["tool_choice"] = "auto"

        try:
            resp = self.client.chat.completions.create(**kwargs)
        except Exception as exc:  # 部分兼容接口不支持 tools 参数 -> 降级为 JSON 模式
            if tools and self._supports_tools:
                logger.warning("LLM tool-calling 不可用，降级为 JSON 模式: %s", exc)
                self._supports_tools = False
                kwargs.pop("tools", None)
                kwargs.pop("tool_choice", None)
                kwargs["messages"] = messages + [
                    {
                        "role": "system",
                        "content": (
                            "请以严格 JSON 输出下一步动作，格式："
                            '{"thought_summary":"简短中文说明","tool":"工具名或 finish","arguments":{...}}'
                        ),
                    }
                ]
                resp = self.client.chat.completions.create(**kwargs)
            else:
                raise

        latency = int((time.perf_counter() - started) * 1000)
        message = resp.choices[0].message
        content = message.content or ""

        tool_calls: List[ToolCall] = []
        for call in getattr(message, "tool_calls", None) or []:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(ToolCall(id=call.id, name=call.function.name, arguments=args))

        # JSON 模式降级：从文本里解析出 {tool, arguments}
        if not tool_calls and content:
            parsed = _extract_json(content)
            if isinstance(parsed, dict) and parsed.get("tool"):
                tool_calls.append(
                    ToolCall(
                        name=str(parsed.get("tool")),
                        arguments=parsed.get("arguments") or {},
                    )
                )
                content = ""

        usage: Dict[str, Any] = {}
        if getattr(resp, "usage", None):
            usage = {
                "prompt_tokens": getattr(resp.usage, "prompt_tokens", 0),
                "completion_tokens": getattr(resp.usage, "completion_tokens", 0),
                "total_tokens": getattr(resp.usage, "total_tokens", 0),
            }

        return LLMResponse(content=content, tool_calls=tool_calls, usage=usage, latency_ms=latency)


def _extract_json(text: str) -> Optional[Any]:
    """从 LLM 文本中抠出第一个 JSON 对象（兼容 ```json 代码块）。"""
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


# ============================================================
# Mock 模式：规则驱动的"假 LLM"
# ============================================================

class MockLLMClient(BaseLLMClient):
    """无 API Key 也能完整跑通 Agent 全流程的规则引擎。

    它模拟的是 LLM 的**决策**（下一步调哪个工具 / 是否结束），
    而所有事实数据仍然来自真实工具与 Mock 数据文件。
    """

    name: str = "mock-planner"

    # 意图关键词
    KW_COMPANY = (
        "基本信息", "工商信息", "成立时间", "成立", "注册资本",
        "公司简介", "是谁", "什么时候成立", "成立日期", "注册",
    )
    KW_LEGAL = ("法律", "诉讼", "处罚", "股权冻结", "司法", "纠纷")
    KW_FIN = ("财务", "营收", "利润", "资产负债", "现金流", "经营状况", "偿债")
    # 只有明确要求"综合/全面/报告"时才走完整流水线 + 生成报告
    KW_COMPREHENSIVE = (
        "综合风险", "全面风险", "整体风险", "综合评估", "全面评估",
        "风险报告", "完整报告", "生成报告", "完整风险",
    )
    KW_REPORT = ("报告", "生成一份", "出具", "风险报告")
    KW_KNOWLEDGE = ("意味着", "怎么判断", "如何判断", "标准", "阈值", "方法", "指南", "规则", "什么是", "为什么")

    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[ToolSpec]] = None,
    ) -> LLMResponse:
        question = self._last_user_message(messages)
        executed = self._executed_tools(messages)
        max_steps = get_settings().MAX_STEPS

        if len(executed) >= max_steps:
            return LLMResponse(content=self._final_answer(question, messages))

        # 真实 LLM 注入的 trusted context（不是我们的 Mock；只是 mock 内部健壮性）
        company_error = self._last_tool_failed(messages, "company_info_tool", markers=("未找到", "不存在", "ToolNotFound", "未找到企业"))

        mentioned = self._extract_company(question)   # 问题中是否真的提到了某家企业
        company = mentioned or "星海科技有限公司"
        q = question

        comprehensive = self._match(q, self.KW_COMPREHENSIVE) or self._match(q, self.KW_REPORT)
        legal_only = self._match(q, self.KW_LEGAL)
        fin_only = self._match(q, self.KW_FIN)
        info_only = self._match(q, self.KW_COMPANY)

        # 0) 已查过 company_info 但企业不存在：直接收尾
        if company_error:
            return LLMResponse(content=self._final_answer(question, messages))

        # 1) 纯知识类问题（未点名企业）：只做 RAG 检索
        if not mentioned and (self._match(q, self.KW_KNOWLEDGE) or not (legal_only or fin_only or info_only)):
            if "knowledge_search_tool" not in executed:
                return self._plan(
                    "正在从风险分析知识库检索判断依据",
                    "knowledge_search_tool",
                    {"query": self._knowledge_query(q), "top_k": 3},
                )
            return LLMResponse(content=self._final_answer(question, messages))

        # 2) 点名企业：先确认主体
        if "company_info_tool" not in executed:
            return self._plan("正在查询企业工商基本信息", "company_info_tool", {"company_name": company})

        # 2.1) 只问基本信息的，查完工商即可收尾，不做多余调用
        if info_only and not comprehensive:
            return LLMResponse(content=self._final_answer(question, messages))

        # 3) 风险事件检索（综合评估 / 法律类 / 未指定专项时都查）
        if "risk_search_tool" not in executed and (comprehensive or legal_only or not fin_only):
            risk_type = "legal" if legal_only and not comprehensive else "all"
            return self._plan(
                f"正在检索企业风险事件（类型：{risk_type}）",
                "risk_search_tool",
                {"company_name": company, "risk_type": risk_type},
            )

        # 4) 财务指标计算（综合评估 / 财务类 / 法律类外的问题）
        if "financial_analysis_tool" not in executed and (comprehensive or fin_only or not legal_only):
            return self._plan("正在计算企业财务指标", "financial_analysis_tool", {"company_name": company})

        # 5) 检索知识库依据
        if "knowledge_search_tool" not in executed:
            return self._plan(
                "正在检索风险评级依据",
                "knowledge_search_tool",
                {"query": "企业财务风险与法律风险等级判断标准", "top_k": 3},
            )

        # 6) 仅当明确要求"报告 / 综合评估"时才生成结构化报告
        if comprehensive and "report_generator_tool" not in executed:
            return self._plan("正在汇总生成结构化风险报告", "report_generator_tool", {"company_name": company})

        return LLMResponse(content=self._final_answer(question, messages))

    # ---------- helpers ----------

    def _plan(self, thought: str, tool: str, arguments: Dict[str, Any]) -> LLMResponse:
        time.sleep(0.12)  # 模拟一点模型思考延迟
        return LLMResponse(
            content="",
            tool_calls=[ToolCall(id=f"mock_{tool}", name=tool, arguments=arguments)],
            usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        )

    @staticmethod
    def _match(text: str, keywords: tuple) -> bool:
        return any(k in text for k in keywords)

    @staticmethod
    def _last_user_message(messages: List[Dict[str, Any]]) -> str:
        for m in reversed(messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                # Agent 循环里 user 消息可能带有上下文包装，取第一行原始问题
                return content.split("\n")[0][:500]
        return ""

    @staticmethod
    def _last_tool_failed(messages: List[Dict[str, Any]], name: str, markers: tuple) -> bool:
        """检测某个工具最近一次 Observation content 里是否包含失败标记。"""
        last: Any = None
        for m in messages:
            if m.get("role") == "tool" and m.get("name") == name:
                last = m
        if not last:
            return False
        content = str(last.get("content", ""))
        return any(mk in content for mk in markers)

    @staticmethod
    def _executed_tools(messages: List[Dict[str, Any]]) -> List[str]:
        """从历史消息里还原已执行的工具名。

        支持两种协议：
        1) 标准 OpenAI-compatible multi-turn：role=tool, 携带 name 字段
        2) Mock 兜底：role=tool, content 以 [tool_name] 开头
        """
        executed: List[str] = []
        for m in messages:
            if m.get("role") != "tool":
                continue
            name = m.get("name")
            if name:
                executed.append(name)
                continue
            content = str(m.get("content", ""))
            match = re.match(r"\[([a-zA-Z_]+)\]", content)
            if match:
                executed.append(match.group(1))
        return executed

    # 问题开头的口语化前缀（抽取企业名时先剥掉，避免把"帮我分析一下"算进公司名）
    _PREFIXES = (
        "帮我分析一下", "帮我查询一下", "帮我评估一下", "帮我生成一份", "帮我生成",
        "帮我分析", "帮我查询", "帮我评估", "帮我", "请帮我", "请", "麻烦",
        "我想了解一下", "我想了解", "我想", "我要", "我需要", "需要",
        "分析一下", "查询一下", "查一下", "评估一下", "生成一份", "看一下",
        "分析", "查询", "评估", "生成", "了解", "看看", "一下",
    )

    @classmethod
    def _extract_company(cls, question: str) -> Optional[str]:
        """从问题里抽取企业名；未点名企业时返回 None（用于区分"知识问答"与"企业查询"）。"""
        text = question.strip()
        changed = True
        while changed:  # 循环剥离口语前缀，直到稳定
            changed = False
            for prefix in cls._PREFIXES:
                if text.startswith(prefix):
                    text = text[len(prefix):].lstrip()
                    changed = True

        # 贪婪匹配公司全称，过滤口语前缀（一个/这家/这个/那个 等）
        match = re.search(
            r"([\u4e00-\u9fa5A-Za-z0-9（）()]{2,30}?(?:科技|股份|责任|控股|实业)?.{0,4}?(?:有限责任公司|有限公司|集团))",
            text,
        )
        if match:
            cand = match.group(1)
            cand = re.sub(r"^(一家|这家|这|那个|这一个|一个不存在的企业|一个)", "", cand)
            if cand and len(cand) >= 4:
                return cand
        return None

    @staticmethod
    def _knowledge_query(question: str) -> str:
        if "资产负债率" in question:
            return "资产负债率过高 偿债能力 风险判断"
        if any(k in question for k in ("诉讼", "法律", "处罚")):
            return "企业法律风险分析方法 诉讼 行政处罚"
        if any(k in question for k in ("现金流", "利润", "营收")):
            return "财务风险判断规则 现金流 利润下滑"
        return "企业经营风险识别 评级标准"

    def _final_answer(self, question: str, messages: List[Dict[str, Any]]) -> str:
        """Mock 模式的最终答复：基于工具结果拼装（真实模式下由 LLM 生成）。"""
        observations: Dict[str, Any] = {}
        for m in messages:
            if m.get("role") != "tool":
                continue
            name = m.get("name")
            content = m.get("content", "")
            if not name:
                match = re.match(r"\[([a-zA-Z_]+)\]([\s\S]*)", str(content))
                if not match:
                    continue
                name, payload = match.group(1), match.group(2)
            else:
                payload = content
            try:
                observations[name] = json.loads(payload) if isinstance(payload, str) else payload
            except (json.JSONDecodeError, TypeError):
                observations[name] = payload

        report = observations.get("report_generator_tool") or {}
        if isinstance(report, dict) and report.get("company_name"):
            return _render_markdown_report(report)

        parts: List[str] = []
        company = observations.get("company_info_tool")
        if isinstance(company, dict) and company.get("company_name"):
            parts.append(
                f"### 企业概况\n"
                f"- **企业名称**：{company.get('company_name')}\n"
                f"- **成立时间**：{company.get('established_at')}（注册资本 {company.get('registered_capital')}）\n"
                f"- **所属行业**：{company.get('industry')}\n"
                f"- **经营状态**：{company.get('status')}｜员工规模 {company.get('employees')} 人\n"
            )

        fin = observations.get("financial_analysis_tool")
        if isinstance(fin, dict) and fin.get("metrics"):
            lines = "\n".join(
                f"- **{m.get('name')}**：{m.get('value')}{m.get('unit', '')} — {m.get('comment', '')}"
                for m in fin["metrics"]
            )
            parts.append(
                f"### 财务分析\n{lines}\n\n"
                f"**财务风险等级：{fin.get('financial_risk_level')}**\n\n{fin.get('analysis', '')}"
            )

        risk = observations.get("risk_search_tool")
        if isinstance(risk, dict) and risk.get("events"):
            lines = "\n".join(
                f"- [{e.get('level')}] {e.get('date')} {e.get('type')}：{e.get('title')}（来源：{e.get('source')}）"
                for e in risk["events"][:6]
            )
            parts.append(f"### 风险事件（共 {risk.get('total', len(risk['events']))} 条）\n{lines}")

        kn = observations.get("knowledge_search_tool")
        if isinstance(kn, dict) and kn.get("chunks"):
            lines = "\n".join(
                f"- {c.get('text', '')[:120]} …（来源：{c.get('source')}）" for c in kn["chunks"][:3]
            )
            parts.append(f"### 知识库依据\n{lines}")

        if not parts:
            return "未获取到有效数据，请尝试更换问题描述或检查数据来源。"
        return "\n\n".join(parts)


def _render_markdown_report(report: Dict[str, Any]) -> str:
    """把结构化报告渲染成 Markdown（Mock 模式的最终回复）。"""
    metrics = report.get("metrics") or []
    metric_lines = "\n".join(
        f"| {m.get('name')} | {m.get('value')}{m.get('unit', '')} | {m.get('comment', '')} |"
        for m in metrics
    )
    evidence_lines = "\n".join(f"- {e.get('text')}（来源：{e.get('source', '-')}）" for e in report.get("evidence", []))
    rec_lines = "\n".join(f"{i}. {r}" for i, r in enumerate(report.get("recommendations", []), 1))

    return f"""## 风险分析结论：{report.get('company_name')}

**总体风险等级：{report.get('overall_risk')}（综合评分 {report.get('overall_score')}/100）**
财务 `{report.get('financial_risk')}` ｜ 法律 `{report.get('legal_risk')}` ｜ 经营 `{report.get('operation_risk')}`

### 风险摘要
{report.get('summary')}

### 经营风险
{report.get('business_risk')}

### 财务风险
{report.get('financial_analysis')}

| 指标 | 数值 | 说明 |
| --- | --- | --- |
{metric_lines}

### 法律风险
{report.get('legal_analysis')}

### 关键证据
{evidence_lines}

### 建议措施
{rec_lines}
"""


# ============================================================
# 工厂
# ============================================================

_client: Optional[BaseLLMClient] = None


def get_llm_client() -> BaseLLMClient:
    """按配置返回 LLM Client（单例）。"""
    global _client
    if _client is not None:
        return _client
    s = get_settings()
    if s.is_mock:
        logger.info("LLM 运行模式：MOCK（无需 API Key）")
        _client = MockLLMClient()
    else:
        logger.info("LLM 运行模式：REAL（%s @ %s）", s.LLM_MODEL, s.LLM_BASE_URL)
        _client = OpenAICompatClient()
    return _client


def reset_llm_client() -> None:
    global _client
    _client = None
