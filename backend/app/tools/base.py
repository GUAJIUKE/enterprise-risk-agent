"""Tool 抽象基类与注册表。

统一 Tool interface：name / description / input schema / execute() / 错误处理。
"""

from __future__ import annotations

import inspect
import time
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional, get_type_hints

from pydantic import BaseModel, ValidationError, create_model

from ..models.schemas import ToolResult, ToolSpec
from ..utils.logger import get_logger

logger = get_logger("tools")


class BaseTool(ABC):
    """所有工具的基类。

    子类只需实现 name / description / execute()，
    输入 schema 由 execute 的类型注解自动生成（JSON Schema）。
    """

    name: str = ""
    description: str = ""

    # 可选：子类声明参数模型（pydantic），优先级高于类型注解推断
    args_model: Optional[type[BaseModel]] = None

    # 是否由 Agent 自动注入先前工具的结果（避免 LLM 在对话里搬运大段 JSON）
    inject_context: bool = False

    def __init__(self) -> None:
        if not self.name:
            raise ValueError("Tool 必须声明 name")

    # ---------- 需要子类实现 ----------

    @abstractmethod
    def execute(self, **kwargs: Any) -> Any:
        """执行工具逻辑，返回可 JSON 序列化的结果。异常会被 run() 捕获。"""

    # ---------- 通用能力 ----------

    def spec(self) -> ToolSpec:
        """生成给 LLM 的 function calling schema。"""
        return ToolSpec(
            name=self.name,
            description=self.description,
            parameters=self._build_parameters(),
        )

    def _build_parameters(self) -> Any:
        from ..models.schemas import ToolParameter

        model = self.args_model or self._infer_args_model()
        schema = model.model_json_schema()
        return ToolParameter(
            type="object",
            properties=schema.get("properties", {}),
            required=schema.get("required", []),
        )

    def _infer_args_model(self) -> type[BaseModel]:
        """从 execute() 的签名推断参数模型（简单的 type hint -> pydantic）。"""
        sig = inspect.signature(self.execute)
        hints = get_type_hints(self.execute)
        fields: Dict[str, Any] = {}
        for param_name, param in sig.parameters.items():
            if param_name in ("self", "kwargs"):
                continue
            annotation = hints.get(param_name, str)
            default = ... if param.default is inspect._empty else param.default
            fields[param_name] = (annotation, default)
        return create_model(f"{self.name}_args", **fields)

    def validate(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """参数校验：过滤未知参数、补全默认值，非法参数抛 ValidationError。"""
        model = self.args_model or self._infer_args_model()
        validated = model(**arguments)
        return validated.model_dump()

    def run(self, arguments: Dict[str, Any]) -> ToolResult:
        """带校验 + 计时 + 异常捕获的执行入口。"""
        started = time.perf_counter()
        try:
            clean_args = self.validate(arguments)
        except ValidationError as exc:
            duration = max(1, int((time.perf_counter() - started) * 1000))
            error_msg = f"参数校验失败: {exc.errors()[0].get('msg', 'invalid arguments')}"
            logger.warning("tool_validate_error", extra={"extra_fields": {"tool": self.name, "error": error_msg}})
            return ToolResult.fail(error_msg, duration)

        try:
            data = self.execute(**clean_args)
            duration = max(1, int((time.perf_counter() - started) * 1000))
            return ToolResult.ok(data, duration)
        except Exception as exc:  # 异常不吞掉：记录 + 返回结构化错误给 Agent
            duration = max(1, int((time.perf_counter() - started) * 1000))
            logger.error(
                "tool_execute_error",
                extra={"extra_fields": {"tool": self.name, "error": str(exc), "args": clean_args}},
                exc_info=True,
            )
            return ToolResult.fail(f"{type(exc).__name__}: {exc}", duration)


class ToolRegistry:
    """工具注册表：注册 / 查询 / 提供 LLM schema。"""

    def __init__(self) -> None:
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def list(self) -> List[BaseTool]:
        return list(self._tools.values())

    def specs(self) -> List[ToolSpec]:
        return [t.spec() for t in self._tools.values()]

    def describe(self) -> List[Dict[str, Any]]:
        return [{"name": t.name, "description": t.description} for t in self._tools.values()]
