"""Agent Orchestrator：Plan → Action → Observation → 再判断 → Final Answer。

异步生成器实现：普通调用与 SSE 流式调用共用同一套逻辑。

事件统一信封：
    event = { "type": ..., "data": { request_id, timestamp, t_ms, ...payload } }

主要事件：
    start / planning_start / plan / tool_start / tool_result /
    calculation / rag_result / guardrail / final_start /
    token (聚合) / report / summary / done / error
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List, Optional

from ..config import get_settings
from ..llm.client import BaseLLMClient, get_llm_client
from ..rag.retriever import get_retriever
from ..models.schemas import (
    ChatResponse,
    RiskReport,
    StepStatus,
    TrajectoryStep,
)
from ..prompts.loader import (
    build_agent_prompt,
    build_report_prompt,
    build_system_prompt,
)
from ..tools.base import BaseTool, ToolRegistry
from ..tools.registry import get_registry
from ..utils.logger import Timer, get_logger, log_event, safe_trunc

logger = get_logger("agent")

# 工具 -> 默认面向用户的行动说明（不暴露模型内部推理）
TOOL_THOUGHT: Dict[str, str] = {
    "company_info_tool": "正在查询企业工商基本信息",
    "risk_search_tool": "正在检索企业风险事件",
    "financial_analysis_tool": "正在计算企业财务指标",
    "knowledge_search_tool": "正在从知识库检索判断依据",
    "report_generator_tool": "正在汇总生成结构化风险报告",
}


class AgentOrchestrator:
    """多步骤 Agent 编排器。"""

    def __init__(
        self,
        registry: Optional[ToolRegistry] = None,
        llm: Optional[BaseLLMClient] = None,
        max_steps: Optional[int] = None,
        tool_timeout: Optional[float] = None,
    ) -> None:
        s = get_settings()
        self.registry = registry or get_registry()
        self.llm = llm or get_llm_client()
        self.max_steps = max_steps or s.MAX_STEPS
        self.tool_timeout = tool_timeout or s.TOOL_TIMEOUT
        self.max_repeat = s.MAX_TOOL_REPEAT

    # ============================================================
    # 事件辅助（Demo Studio 用的可观测事件；均为真实运行时数据）
    # ============================================================

    @staticmethod
    def _envelope(t0: float, request_id: str, **fields: Any) -> Dict[str, Any]:
        """统一事件信封：request_id + timestamp + 相对耗时 t_ms。"""
        return {
            "request_id": request_id,
            "timestamp": datetime.now().isoformat(timespec="milliseconds"),
            "t_ms": int((time.perf_counter() - t0) * 1000),
            **fields,
        }

    @staticmethod
    def _guardrail(kind: str, status: str, message: str, **extra: Any) -> Dict[str, Any]:
        return {"guardrail": {"kind": kind, "status": status, "message": message, **extra}}

    # ============================================================
    # 非流式入口
    # ============================================================

    async def run(self, question: str, session_id: str = "", request_id: str = "") -> ChatResponse:
        """执行 Agent 并一次性返回完整结果。"""
        final_data: Optional[Dict[str, Any]] = None
        async for event in self.arun(question, session_id=session_id, request_id=request_id):
            if event["type"] == "done":
                final_data = event["data"]
        assert final_data is not None, "Agent 主循环未产出 done 事件"
        return ChatResponse(**final_data)

    # ============================================================
    # 流式主循环
    # ============================================================

    async def arun(
        self,
        question: str,
        session_id: str = "",
        request_id: str = "",
    ) -> AsyncIterator[Dict[str, Any]]:
        request_id = request_id or uuid.uuid4().hex[:12]
        session_id = session_id or f"sess_{uuid.uuid4().hex[:8]}"
        settings = get_settings()
        timer = Timer()
        t0 = time.perf_counter()

        trajectory: List[TrajectoryStep] = []
        tool_calls_log: List[Dict[str, Any]] = []
        memory: Dict[str, Any] = {}          # tool_name -> 最近一次结果
        call_fingerprints: Dict[str, int] = {}  # 重复调用检测
        usage_total: Dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        error: Optional[str] = None
        executed_tools: List[str] = []         # 真实执行过的工具（顺序）
        # Guardrail 统计的源头：以下计数器由运行时事件直接产出，
        # 最终由 summary 事件一次性下发，UI 不在事件维度重复累加。
        g_schema_pass = 0
        g_schema_fail = 0
        g_tool_errors = 0
        g_duplicates_blocked = 0
        g_timeouts = 0
        g_unknown_tools = 0
        g_max_steps_hit = False
        g_aborted = False

        yield {
            "type": "start",
            "data": self._envelope(
                t0,
                request_id,
                session_id=session_id,
                mode="mock" if settings.is_mock else "real",
                model=settings.LLM_MODEL if not settings.is_mock else "mock-planner",
                max_steps=self.max_steps,
                available_tools=[t.name for t in self.registry.list()],
                rag_stats=get_retriever().stats(),
                guardrails={
                    "max_steps": self.max_steps,
                    "tool_timeout_s": self.tool_timeout,
                    "max_tool_repeat": self.max_repeat,
                    "cot_protection": True,  # thought_summary 超 60 字即被替换为固定短句
                },
            ),
        }

        # 系统提示 + 工具声明（按 OpenAI-compatible 协议，每次都重新打包发给模型）
        system_prompt = build_system_prompt(self.max_steps)
        base_messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ]
        tools = self.registry.specs()
        final_answer = ""
        aborted = False

        for step_idx in range(1, self.max_steps + 1):
            # ---- 让 LLM 决定下一步：先派发 planning_start，再调用模型 ----
            yield {
                "type": "planning_start",
                "data": self._envelope(
                    t0,
                    request_id,
                    step=step_idx,
                    loop_phase="plan",
                    message=(
                        "正在基于已收集的 observation 决定下一步动作"
                        if executed_tools
                        else "正在理解用户任务并制定执行计划"
                    ),
                    executed_tools=executed_tools,
                ),
            }

            # ---- 构造本轮的决策 messages：历史 + 临时 planning system message（不入永久历史）----
            tools_desc = self._tools_desc(tools)
            observations_text = self._summarize_observations(memory)
            planning_msg = {
                "role": "system",
                "content": build_agent_prompt(
                    question=question,
                    tools_desc=tools_desc,
                    observations=observations_text,
                    step=step_idx,
                    max_steps=self.max_steps,
                ),
            }
            decision_messages = base_messages + [planning_msg]

            try:
                response = await asyncio.to_thread(
                    self._llm_decide, decision_messages, tools, step_idx
                )
            except Exception as exc:
                error = f"LLM 调用失败: {exc}"
                logger.error("llm_error", extra={"extra_fields": {"request_id": request_id, "error": str(exc)}})
                trajectory.append(
                    TrajectoryStep(
                        step=step_idx,
                        thought_summary="模型调用异常，正在降级处理",
                        action="error",
                        status=StepStatus.ERROR,
                        error=str(exc),
                    )
                )
                yield {"type": "step", "data": trajectory[-1].model_dump(mode="json")}
                break

            for key in usage_total:
                usage_total[key] += int(response.usage.get(key, 0) or 0)

            # ---- 终止条件：模型不再调用工具 ----
            if not response.tool_calls:
                final_answer = response.content or "（模型未返回内容）"
                break

            call = response.tool_calls[0]
            thought = (response.content or "").strip()
            if len(thought) > 60:  # 只保留简短说明，避免长推理链外泄
                thought = TOOL_THOUGHT.get(call.name, "正在执行下一步分析")
            thought = thought or TOOL_THOUGHT.get(call.name, f"正在调用 {call.name}")

            # ---- PLAN：模型输出下一步动作（只暴露简短行动说明，不含隐藏推理）----
            yield {
                "type": "plan",
                "data": self._envelope(
                    t0,
                    request_id,
                    step=step_idx,
                    thought_summary=thought,
                    next_action=call.name,
                    arguments=call.arguments,
                    loop_phase="action",
                ),
            }

            tool = self.registry.get(call.name)
            if tool is None:
                observation = f"工具 {call.name} 不存在，可选工具：{', '.join(t.name for t in self.registry.list())}"
                g_unknown_tools += 1
                yield {
                    "type": "guardrail",
                    "data": self._envelope(
                        t0,
                        request_id,
                        step=step_idx,
                        **self._guardrail("unknown_tool", "blocked", f"模型调用了未注册工具 {call.name}", step=step_idx),
                    ),
                }
                trajectory.append(
                    TrajectoryStep(
                        step=step_idx,
                        thought_summary=thought,
                        action=call.name,
                        input=call.arguments,
                        status=StepStatus.ERROR,
                        error=observation,
                    )
                )
                yield {"type": "step", "data": trajectory[-1].model_dump(mode="json")}
                base_messages.append({"role": "system", "content": observation})
                continue

            # ---- 重复调用检测（熔断）----
            fingerprint = f"{call.name}:{json.dumps(call.arguments, sort_keys=True, ensure_ascii=False)}"
            call_fingerprints[fingerprint] = call_fingerprints.get(fingerprint, 0) + 1
            if call_fingerprints[fingerprint] > self.max_repeat:
                notice = f"检测到重复调用 {call.name}（相同参数已执行 {call_fingerprints[fingerprint]} 次），请停止重复并直接给出结论。"
                logger.warning("repeat_tool_call", extra={"extra_fields": {"request_id": request_id, "tool": call.name}})
                g_duplicates_blocked += 1
                yield {
                    "type": "guardrail",
                    "data": self._envelope(
                        t0,
                        request_id,
                        step=step_idx,
                        **self._guardrail(
                            "duplicate_call",
                            "blocked",
                            f"Duplicate tool call detected: {call.name}（相同参数第 {call_fingerprints[fingerprint]} 次），执行已阻断并强制收尾",
                            step=step_idx,
                            tool=call.name,
                        ),
                    ),
                }
                trajectory.append(
                    TrajectoryStep(
                        step=step_idx,
                        thought_summary="检测到重复工具调用，触发熔断",
                        action=call.name,
                        input=call.arguments,
                        status=StepStatus.ERROR,
                        error=notice,
                    )
                )
                yield {"type": "step", "data": trajectory[-1].model_dump(mode="json")}
                base_messages.append(
                    {"role": "system", "content": notice + " 现在请直接输出最终答复。"}
                )
                final_answer = await self._finalize(base_messages, trajectory, step_idx, usage_total)
                break

            # ---- 参数校验（真实校验结果）----
            try:
                tool.validate(call.arguments)
                schema_validated, schema_error = True, None
                g_schema_pass += 1
            except Exception as exc:  # noqa: BLE001
                schema_validated, schema_error = False, str(exc)[:200]
                g_schema_fail += 1
                yield {
                    "type": "guardrail",
                    "data": self._envelope(
                        t0,
                        request_id,
                        step=step_idx,
                        **self._guardrail(
                            "schema_validation", "failed", f"参数校验失败：{schema_error}", step=step_idx, tool=call.name
                        ),
                    ),
                }

            # ---- TOOL START（带 computed_by；只有 financial 才是 Python 计算）----
            yield {
                "type": "tool_start",
                "data": self._envelope(
                    t0,
                    request_id,
                    step=step_idx,
                    tool=call.name,
                    input=call.arguments,
                    schema_validated=schema_validated,
                    schema_error=schema_error,
                    timeout_s=self.tool_timeout,
                    computed_by="python_runtime",
                    executed_by="Python Tool Runtime",
                    status="running",
                ),
            }

            # ---- 计算 trusted context（对声明 inject_context 的工具才注入）----
            trust_keys = (
                ("company_info", "company_info_tool"),
                ("risk_events", "risk_search_tool"),
                ("financial", "financial_analysis_tool"),
                ("knowledge", "knowledge_search_tool"),
            )
            if getattr(tool, "inject_context", False):
                injected_specs = [
                    {"field": k, "source_tool": src}
                    for k, src in trust_keys
                    if memory.get(src) is not None
                ]
                model_supplied = {
                    k: True for k, _ in trust_keys if k in (call.arguments or {})
                }
                if injected_specs or model_supplied:
                    yield {
                        "type": "context_injection",
                        "data": self._envelope(
                            t0,
                            request_id,
                            step=step_idx,
                            tool=call.name,
                            injected=injected_specs,
                            model_supplied=model_supplied,
                            note="Trusted runtime context: Runtime 注入覆盖模型传入，LLM 不能伪造前序 observation",
                        ),
                    }

            # ---- 执行工具（带 timeout）；Runtime trusted context 覆盖 LLM 同名字段 ----
            run_args = dict(call.arguments)
            if getattr(tool, "inject_context", False):
                for k, src in trust_keys:
                    if memory.get(src) is not None:
                        run_args[k] = memory[src]

            started = time.perf_counter()
            result = await self._execute_tool(tool, run_args)
            duration = result.duration_ms or int((time.perf_counter() - started) * 1000)

            # ---- TOOL RESULT ----
            yield {
                "type": "tool_result",
                "data": self._envelope(
                    t0,
                    request_id,
                    step=step_idx,
                    tool=call.name,
                    status="success" if result.success else "error",
                    duration_ms=duration,
                    input=call.arguments,
                    output=result.data if result.success else None,
                    error=result.error,
                    computed_by="python_runtime",
                    executed_by="Python Tool Runtime",
                ),
            }

            if not result.success:
                err_text = result.error or "未知错误"
                kind = "tool_timeout" if "超时" in err_text else "tool_error"
                if kind == "tool_timeout":
                    g_timeouts += 1
                else:
                    g_tool_errors += 1
                yield {
                    "type": "guardrail",
                    "data": self._envelope(
                        t0,
                        request_id,
                        step=step_idx,
                        **self._guardrail(kind, "failed", err_text, step=step_idx, tool=call.name),
                    ),
                }

            # ---- 财务指标：明确标注由 Python 计算 ----
            if result.success and call.name == "financial_analysis_tool":
                data = result.data or {}
                yield {
                    "type": "calculation",
                    "data": self._envelope(
                        t0,
                        request_id,
                        step=step_idx,
                        tool=call.name,
                        computed_by="Python",
                        period=data.get("period"),
                        risk_level=data.get("financial_risk_level"),
                        risk_score=data.get("risk_score"),
                        metrics=data.get("metrics", []),
                        analysis=data.get("analysis", ""),
                    ),
                }

            # ---- RAG：真实检索结果 + 真实相似度 score ----
            if result.success and call.name == "knowledge_search_tool":
                data = result.data or {}
                chunks = data.get("chunks", []) or []
                yield {
                    "type": "rag_result",
                    "data": self._envelope(
                        t0,
                        request_id,
                        step=step_idx,
                        tool=call.name,
                        query=data.get("query"),
                        top_k=len(chunks),
                        stats=get_retriever().stats(),
                        documents=[
                            {
                                "source": c.get("source"),
                                "heading": c.get("heading"),
                                "score": c.get("score"),
                                "content_preview": (c.get("text") or "")[:180],
                            }
                            for c in chunks
                        ],
                    ),
                }

            step_record = TrajectoryStep(
                step=step_idx,
                thought_summary=thought,
                action=call.name,
                input=call.arguments,
                status=StepStatus.SUCCESS if result.success else StepStatus.ERROR,
                duration_ms=duration,
                observation=result.data if result.success else None,
                error=result.error,
            )
            trajectory.append(step_record)
            yield {"type": "step", "data": step_record.model_dump(mode="json")}

            tool_calls_log.append(
                {
                    "tool": call.name,
                    "arguments": safe_trunc(call.arguments),
                    "status": "success" if result.success else "error",
                    "duration_ms": duration,
                }
            )

            payload = result.data if result.success else {"error": result.error}
            if result.success:
                memory[call.name] = result.data

            # ---- 写入符合 OpenAI-compatible 的多轮 tool calling 历史 ----
            # 1) assistant 消息：携带 tool_calls 数组（带 id）
            assistant_tool_call = {
                "id": call.id or f"call_{step_idx}_{uuid.uuid4().hex[:6]}",
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                },
            }
            base_messages.append(
                {
                    "role": "assistant",
                    "content": thought or "",  # 简短用户面说明，绝无隐藏 CoT
                    "tool_calls": [assistant_tool_call],
                }
            )
            # 2) tool 消息：使用 tool_call_id 与上面对齐
            base_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": assistant_tool_call["id"],
                    "name": call.name,
                    "content": json.dumps(payload, ensure_ascii=False, default=str),
                }
            )
            executed_tools.append(call.name)
        else:
            # 达到 max_steps：强制收尾
            g_max_steps_hit = True
            logger.warning(
                "max_steps_reached",
                extra={"extra_fields": {"request_id": request_id, "max_steps": self.max_steps}},
            )
            yield {
                "type": "guardrail",
                "data": self._envelope(
                    t0,
                    request_id,
                    step=self.max_steps,
                    **self._guardrail(
                        "max_steps",
                        "warn",
                        f"已达最大步数 {self.max_steps}，强制进入收尾并输出结论",
                        step=self.max_steps,
                    ),
                ),
            }
            final_answer = await self._finalize(base_messages, trajectory, self.max_steps, usage_total)

        if not final_answer:
            final_answer = await self._finalize(base_messages, trajectory, len(trajectory), usage_total)

        # ---- 收尾：通知前端开始流式输出最终答案 ----
        yield {
            "type": "final_start",
            "data": self._envelope(
                t0,
                request_id,
                steps=len(trajectory),
                loop_phase="final",
            ),
        }

        # ---- 流式输出最终答案 ----
        async for chunk in self._stream_answer(final_answer):
            yield {"type": "token", "data": self._envelope(t0, request_id, text=chunk)}

        # ---- 结构化报告 ----
        report: Optional[RiskReport] = None
        if memory.get("report_generator_tool"):
            try:
                report = RiskReport(**memory["report_generator_tool"])
                report_payload = report.model_dump(mode="json")
                report_payload.update(
                    {
                        "request_id": request_id,
                        "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                        "t_ms": int((time.perf_counter() - t0) * 1000),
                    }
                )
                yield {"type": "report", "data": report_payload}
            except Exception as exc:
                logger.warning("report_parse_error: %s", exc)

        latency = timer.elapsed_ms()
        response_obj = ChatResponse(
            request_id=request_id,
            session_id=session_id,
            answer=final_answer,
            trajectory=trajectory,
            report=report,
            model=get_settings().LLM_MODEL if not get_settings().is_mock else "mock-planner",
            mode="mock" if get_settings().is_mock else "real",
            steps=len(trajectory),
            latency_ms=latency,
            usage=usage_total,
            error=error,
        )

        log_event(
            logger,
            "agent_run_finished",
            request_id=request_id,
            session_id=session_id,
            model=response_obj.model,
            mode=response_obj.mode,
            steps=response_obj.steps,
            latency_ms=latency,
            tool_calls=[t["tool"] for t in tool_calls_log],
            usage=usage_total,
            error=error,
            question=safe_trunc(question, 120),
        )

        # ---- summary：唯一上报 Guardrail / Runtime 真实统计的 source of truth ----
        yield {
            "type": "summary",
            "data": self._envelope(
                t0,
                request_id,
                session_id=session_id,
                status="error" if error else ("completed" if not aborted else "aborted"),
                steps=len(trajectory),
                tool_calls=len(tool_calls_log),
                executed_tools=executed_tools,
                errors=g_tool_errors,
                timeouts=g_timeouts,
                schema_pass=g_schema_pass,
                schema_fail=g_schema_fail,
                duplicates_blocked=g_duplicates_blocked,
                unknown_tools=g_unknown_tools,
                max_steps_hit=g_max_steps_hit,
                total_latency_ms=latency,
                usage=usage_total,
            ),
        }

        done_payload = response_obj.model_dump(mode="json")
        done_payload.update(
            {
                "request_id": request_id,
                "timestamp": datetime.now().isoformat(timespec="milliseconds"),
                "t_ms": int((time.perf_counter() - t0) * 1000),
            }
        )
        yield {"type": "done", "data": done_payload}

    # ============================================================
    # 内部方法
    # ============================================================

    def _llm_decide(self, messages: List[Dict[str, Any]], tools: Any, step_idx: int) -> Any:
        """调用 LLM 决定下一步（同步执行，放到线程里避免阻塞事件循环）。"""
        return self.llm.chat(messages, tools=tools)

    async def _execute_tool(self, tool: BaseTool, arguments: Dict[str, Any]) -> Any:
        """执行工具：超时控制（其它上下文注入已在主循环完成）。"""
        from ..models.schemas import ToolResult

        try:
            return await asyncio.wait_for(
                asyncio.to_thread(tool.run, arguments),
                timeout=self.tool_timeout,
            )
        except asyncio.TimeoutError:
            logger.error(
                "tool_timeout",
                extra={"extra_fields": {"tool": tool.name, "timeout": self.tool_timeout}},
            )
            return ToolResult.fail(f"工具执行超时（>{self.tool_timeout}s）")

    @staticmethod
    def _tools_desc(tools: List[Any]) -> str:
        """给临时 planning prompt 看的工具描述（不暴露 context injection 类字段）。"""
        lines: List[str] = []
        for t in tools:
            params = []
            try:
                properties = t.parameters.properties or {}
                for name, schema in properties.items():
                    # 跳过明显由 Runtime 注入的内部字段
                    if name in {"company_info", "risk_events", "financial", "knowledge"}:
                        continue
                    params.append(name)
            except Exception:  # noqa: BLE001
                pass
            lines.append(f"- {t.name}({', '.join(params) or '—'}): {t.description}")
        return "\n".join(lines)

    @staticmethod
    def _summarize_observations(memory: Dict[str, Any]) -> str:
        """把已收集的 observation 压缩成短摘要，用于临时 planning system message。"""
        if not memory:
            return "（暂无）"
        rows: List[str] = []
        for tool, data in memory.items():
            try:
                snippet = json.dumps(data, ensure_ascii=False, default=str)[:200]
            except Exception:  # noqa: BLE001
                snippet = str(data)[:200]
            rows.append(f"- {tool}: {snippet}")
        return "\n".join(rows)

    async def _finalize(
        self,
        messages: List[Dict[str, Any]],
        trajectory: List[TrajectoryStep],
        step_idx: int,
        usage_total: Dict[str, int],
    ) -> str:
        """收尾：让 LLM（或 Mock 规划器）基于已有 observation 产出最终答复。"""
        trajectory.append(
            TrajectoryStep(
                step=step_idx + 1,
                thought_summary="正在汇总结论并生成最终答复",
                action="finalize",
                status=StepStatus.SUCCESS,
                duration_ms=0,
            )
        )
        prompt = list(messages) + [
            {
                "role": "system",
                "content": "请基于以上工具结果输出最终答复（中文 Markdown），不要再次调用工具。\n" + build_report_prompt(),
            }
        ]
        try:
            resp = await asyncio.to_thread(self.llm.chat, prompt, None)
            for key in usage_total:
                usage_total[key] += int(resp.usage.get(key, 0) or 0)
            return resp.content or "已收集到相关信息，但未能生成结论文本。"
        except Exception as exc:
            logger.error("finalize_error: %s", exc)
            return f"分析已完成，但最终答复生成失败：{exc}"

    async def _finalize(
        self,
        messages: List[Dict[str, Any]],
        trajectory: List[TrajectoryStep],
        step_idx: int,
        usage_total: Dict[str, int],
    ) -> str:
        """收尾：让 LLM（或 Mock 规划器）基于已有 observation 产出最终答复。

        注意：trajectory 中追加的是「收尾阶段」的 thought_summary，绝无隐藏推理。
        """
        trajectory.append(
            TrajectoryStep(
                step=step_idx + 1,
                thought_summary="正在汇总结论并生成最终答复",
                action="finalize",
                status=StepStatus.SUCCESS,
                duration_ms=0,
            )
        )
        prompt = list(messages) + [
            {
                "role": "system",
                "content": (
                    "请基于以上工具结果输出最终答复（中文 Markdown），不要再次调用工具。\n"
                    + build_report_prompt()
                ),
            }
        ]
        try:
            resp = await asyncio.to_thread(self.llm.chat, prompt, None)
            for key in usage_total:
                usage_total[key] += int(resp.usage.get(key, 0) or 0)
            return resp.content or "已收集到相关信息，但未能生成结论文本。"
        except Exception as exc:
            logger.error("finalize_error: %s", exc)
            return f"分析已完成，但最终答复生成失败：{exc}"

    async def _stream_answer(self, answer: str) -> AsyncIterator[str]:
        """把最终答案切成小块输出（SSE chunk streaming，模拟流式体感）。"""
        size = 12
        for i in range(0, len(answer), size):
            yield answer[i : i + size]
            await asyncio.sleep(0.012)
