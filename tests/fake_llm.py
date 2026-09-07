"""FakeLLM 测试：验证 OpenAI-compatible 多轮 Tool Calling 协议被 Agent 正确执行。

FakeLLM 按预定剧本：
    第一轮：返回 company_info_tool
    第二轮：返回 financial_analysis_tool（不是 finish）
    第三轮：返回 report_generator_tool
    第四轮：不再调用工具 → 触发 Finalize

如果 Agent 实现正确，会看到 3 个工具都执行，trajectory 里有 3 个 step。
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.llm.client import BaseLLMClient  # noqa: E402
from app.models.schemas import ToolCall  # noqa: E402


SCRIPT = [
    {"tool": "company_info_tool", "arguments": {"company_name": "星海科技有限公司"}},
    {"tool": "financial_analysis_tool", "arguments": {"company_name": "星海科技有限公司"}},
    {"tool": "report_generator_tool", "arguments": {"company_name": "星海科技有限公司"}},
]


class FakeLLM(BaseLLMClient):
    name = "fake-script"

    def __init__(self) -> None:
        self.calls: List[List[Dict[str, Any]]] = []

    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Any]] = None,
    ) -> Any:
        # 复制消息（避免 orchestrator 复用导致不可重复观察）
        self.calls.append([{k: v for k, v in m.items() if k != "tools"} for m in messages])

        # 第 N 轮（按 assistant.tool_calls 累计次数推断）
        executed_n = sum(1 for m in messages if m.get("role") == "assistant" and m.get("tool_calls"))
        from app.llm.client import LLMResponse

        if executed_n >= len(SCRIPT):
            return LLMResponse(content="剧本已演完 → Final.")

        step = SCRIPT[executed_n]
        return LLMResponse(
            content="下一步动作见 tool_call",
            tool_calls=[
                ToolCall(
                    id=f"call_{executed_n}_fake",
                    name=step["tool"],
                    arguments=step["arguments"],
                )
            ],
        )


async def run() -> None:
    from app.agents.orchestrator import AgentOrchestrator
    from app.tools.registry import get_registry

    llm = FakeLLM()
    orchestrator = AgentOrchestrator(registry=get_registry(), llm=llm)
    final = await orchestrator.run("帮我看下星海科技有限公司综合风险")

    print("=" * 60)
    print(f"status: {final.mode} | steps: {final.steps} | latency: {final.latency_ms}ms")
    print(f"trajectory actions: {[s.action for s in final.trajectory]}")
    print(f"answer head: {final.answer[:120]}")

    # 断言多轮 tool calling 协议正确性
    assert len(llm.calls) >= 4, f"应至少调用 4 次 LLM，实际 {len(llm.calls)}"

    last_call = llm.calls[-1]
    # 验证最后一轮包含合法的 OpenAI 多轮 tool calling 历史
    seen_calls: List[str] = []
    for m in last_call:
        if m.get("role") == "assistant":
            for tc in m.get("tool_calls", []) or []:
                fn = tc.get("function", {})
                seen_calls.append(fn.get("name", ""))
        # tool 消息必须有 tool_call_id
    last_tool_msgs = [m for m in last_call if m.get("role") == "tool"]
    assert last_tool_msgs, "最后一轮 messages 应有 tool 消息"
    for tm in last_tool_msgs:
        assert tm.get("tool_call_id"), f"tool 消息缺少 tool_call_id: {tm}"

    print(f"seen tool calls in last call: {seen_calls}")
    assert seen_calls == [
        "company_info_tool",
        "financial_analysis_tool",
        "report_generator_tool",
    ], f"协议错误：{seen_calls}"
    print("✅ FakeLLM multi-turn Tool Calling protocol: PASS")


if __name__ == "__main__":
    asyncio.run(run())
