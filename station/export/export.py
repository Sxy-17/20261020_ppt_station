#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""导出薄封装：pages/*/draft.svg → ppt-master 质检+编译 → exports/*.pptx

为什么不直接调 svg_to_pptx：它吃自己的项目形态（svg_output/ 目录），
我们的页面在 pages/NNN/draft.svg——本脚本做"staging 搬运 + 调引擎 + 收货"，
引擎一字不改（薄封装原则，见 PLAN 决策 A/E）。

流程：draft.svg → .export/svg_output/NNN_角色.svg
      → svg_quality_checker（锁less final，必须过）
      → svg_to_pptx --quick-generate --no-notes
      → exports/<任务>_draft_<时间戳>.pptx

用法：
    .venv/Scripts/python station/export/export.py <task_dir> [--pages 1,2,40] [--keep-stage]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PM = ROOT / "ppt-master" / "skills" / "ppt-master"  # 引擎只读，绝对路径调用
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def run_engine(script: str, args: list[str]) -> subprocess.CompletedProcess:
    """调引擎脚本：统一 .venv python + 绝对路径；失败时把尾部输出给用户看"""
    cmd = [str(sys.executable), str(PM / "scripts" / script)] + [str(a) for a in args]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", cwd=str(ROOT))
    if proc.returncode != 0:
        tail = (proc.stdout + proc.stderr).strip().splitlines()[-15:]
        print(f"引擎 {script} 失败（exit {proc.returncode}）：")
        print("\n".join(tail))
    return proc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--pages", help="只导出指定页，如 1,2,40（默认全部有 draft.svg 的页）")
    ap.add_argument("--keep-stage", action="store_true", help="保留 .export 供调试（默认成功后清掉）")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    pages_dir = task_dir / "pages"
    drafts = sorted(p for p in pages_dir.glob("*/draft.svg"))
    if args.pages:
        want = {int(x) for x in args.pages.split(",") if x.strip()}
        drafts = [p for p in drafts if int(p.parent.name) in want]
    if not drafts:
        print(f"没有可导出的 draft.svg（{task_dir}）")
        return 2

    # staging：引擎期望的项目形态。重建前先点名确认是自己的工作区（R2）
    stage = task_dir / ".export"
    if stage.exists():
        shutil.rmtree(stage)  # .export 是导出器私有暂存，整目录重建安全
    (stage / "svg_output").mkdir(parents=True)

    for d in drafts:
        n = int(d.parent.name)
        role = ""
        meta_file = d.parent / "meta.json"
        if meta_file.exists():
            role = json.loads(meta_file.read_text(encoding="utf-8")).get("role_guess", "")
        # 引擎要求零填充一致命名；角色后缀只是可读性
        dst = stage / "svg_output" / f"{n:03d}_{role or 'page'}.svg"
        shutil.copyfile(d, dst)
        print(f"  staged {dst.name}")

    print("▶ 质检 svg_quality_checker …")
    chk = run_engine("svg_quality_checker.py",
                     [stage, "--quick-generate", "--canonical-authoring",
                      "--stage", "final", "--json"])
    if chk.returncode != 0:
        return 3  # 质检不过就停——绝不带病导出（先修 SVG）

    print("▶ 编译 svg_to_pptx …")
    exp = run_engine("svg_to_pptx.py", [stage, "--quick-generate", "--no-notes"])
    if exp.returncode != 0:
        return 4

    produced = sorted((stage / "exports").glob("*.pptx")) if (stage / "exports").exists() else []
    if not produced:
        print("引擎报告成功但没有产物，检查 .export/exports/")
        return 5

    out_dir = task_dir / "exports"
    out_dir.mkdir(exist_ok=True)
    final = out_dir / f"{task_dir.name}_draft_{datetime.now().strftime('%H%M%S')}.pptx"
    shutil.move(str(produced[-1]), final)
    if not args.keep_stage:
        shutil.rmtree(stage)

    print(f"✓ 导出完成：{final}（{len(drafts)} 页）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
