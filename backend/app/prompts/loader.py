"""Prompt 加载与渲染：所有 Prompt 集中在 prompts/*.md，避免散落到业务代码。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

PROMPT_DIR = Path(__file__).resolve().parent


def load_prompt(name: str) -> str:
    """按文件名读取 Prompt 模板（如 system_prompt.md）。"""
    path = PROMPT_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Prompt 文件不存在: {path}")
    return path.read_text(encoding="utf-8")


def render(template: str, **kwargs: Any) -> str:
    """极简模板渲染：把 {{key}} 替换为传入值。"""
    rendered = template
    for key, value in kwargs.items():
        rendered = rendered.replace("{{" + key + "}}", str(value))
    return rendered


def build_system_prompt(max_steps: int) -> str:
    return render(load_prompt("system_prompt.md"), max_steps=max_steps)


def build_agent_prompt(
    question: str,
    tools_desc: str,
    observations: str,
    step: int,
    max_steps: int,
) -> str:
    return render(
        load_prompt("agent_prompt.md"),
        question=question,
        tools=tools_desc,
        observations=observations or "（暂无）",
        step=step,
        max_steps=max_steps,
    )


def build_report_prompt() -> str:
    return load_prompt("report_prompt.md")


def get_all_prompts() -> Dict[str, str]:
    """供 /api/prompts 展示用。"""
    return {
        "system_prompt": load_prompt("system_prompt.md"),
        "agent_prompt": load_prompt("agent_prompt.md"),
        "report_prompt": load_prompt("report_prompt.md"),
    }
