"""命令行运行 Agent Eval（不依赖服务是否已启动）。

用法：
    python tests/run_eval.py
    python tests/run_eval.py --json        # 输出原始 JSON
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.services.eval_service import run_eval  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description="Run lightweight Agent eval")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()

    summary = await run_eval()

    if args.json:
        print(json.dumps(summary.model_dump(), ensure_ascii=False, indent=2))
        return 0

    print("\n================ Agent Eval ================")
    print(f"模式: {summary.mode} / {summary.model}")
    print(f"用例数: {summary.total_cases}")
    print(f"任务成功率 (Task Success): {summary.task_success_rate:.1%}")
    print(f"必选 Tool 召回 (Required Recall): {summary.required_recall:.1%}")
    print(f"工具精确度 (Tool Precision):      {summary.tool_precision:.1%}")
    print(f"工具 F1:                         {summary.tool_f1:.1%}")
    print(f"非预期工具调用 (Unexpected):     {summary.unexpected_calls}")
    print(f"违规工具调用 (Forbidden):        {summary.forbidden_hits}")
    print(f"平均步数:                        {summary.avg_steps}")
    print(f"平均延迟:                        {summary.avg_latency_ms:.0f} ms")
    print("--------------------------------------------")
    for case in summary.cases:
        flag = "PASS" if case.success else "FAIL"
        print(f"[{flag}] {case.id} {case.query}")
        print(
            f"      期望必选: {case.required_tools}"
            f"  允许: {case.allowed_tools or '—'}"
            f"  禁止: {case.forbidden_tools or '—'}"
        )
        print(f"      实际:     {case.actual_tools}")
        if case.unexpected_tools:
            print(f"      ⚠ 非预期: {case.unexpected_tools}")
        if case.forbidden_hits:
            print(f"      ✗ 禁止命中: {case.forbidden_hits}")
        print(
            f"      Recall {case.required_recall:.0%} | Precision {case.tool_precision:.0%}"
            f" | F1 {case.tool_f1:.0%} | 步数 {case.steps} | 延迟 {case.latency_ms:.0f} ms"
        )
        if case.error:
            print(f"      错误: {case.error}")
    print("============================================\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
