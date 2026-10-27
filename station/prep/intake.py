#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""收编：把 inbox 里的翻新候选搬进任务工作区（inbox 生命周期的心脏）

为什么搬运而非拷贝：inbox=当前工作集；拷贝会让 inbox 残留与任务源分叉，
新任务会把旧素材语义带进去（语义污染），物理搬走才根绝。
登记簿 intake_ledger.json 记来龙去脉：审计 + 未来"取消任务搬回"的依据。
收编后统一改名 source.ppt/.pptx——后续 COM 全走 ASCII 路径，
绕开引擎对中文路径不稳的已知坑（ref/ppt-toolchain.md 的教训）。

用法（一次一个文件；同系批量由 agent 循环调用）：
    .venv/Scripts/python station/prep/intake.py <路径> [--task 自定义任务名]
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def slugify(name: str) -> str:
    """文件名 → ASCII 任务名段；非 ASCII（中文等）整体弃用换时间戳。

    为什么不用拼音转写：为一个文件名引 pinyin 依赖不值得，
    时间戳已保证唯一性且按时间可排序。
    """
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return s if s else ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", help="inbox 内相对路径或绝对路径")
    ap.add_argument("--task", help="自定义任务名（默认=文件名slug+时间戳）")
    ap.add_argument("--root", default="projects",
                    help="任务根目录；测试必须指到 tmp/ 下，绝不把测试写进用户区")
    args = ap.parse_args()

    # 任务根：相对路径相对工作区根（agent 可能从任意 CWD 调用）
    root_dir = Path(args.root)
    if not root_dir.is_absolute():
        root_dir = ROOT / root_dir

    src = Path(args.path)
    if not src.is_absolute() and not src.exists():
        # 相对路径先按 CWD，再按 inbox 试——agent 可能从任意目录调用
        src = ROOT / "inbox" / args.path
    if not src.exists():
        print(f"找不到文件：{args.path}（也试过 inbox/{args.path}）")
        return 2
    if src.suffix.lower() not in (".ppt", ".pptx"):
        print(f"只收编翻新候选（.ppt/.pptx），收到的是：{src.suffix}")
        return 2

    task = args.task or (slugify(src.stem) or "task") + datetime.now().strftime("_%Y%m%d_%H%M")
    task_dir = root_dir / task
    if task_dir.exists():
        print(f"任务目录已存在：{task_dir}（换个 --task 名）")
        return 2
    dst_dir = task_dir / "sources"
    dst_dir.mkdir(parents=True)
    dst = dst_dir / ("source" + src.suffix.lower())

    try:
        shutil.move(str(src), str(dst))
    except (PermissionError, shutil.Error) as exc:
        # 文件被 PowerPoint 占用时 Windows 拒绝移动——显式失败好过静默半成品
        try:
            dst_dir.rmdir()
            task_dir.rmdir()
        except OSError:
            pass
        print(f"搬运失败（文件可能正被 PowerPoint 打开）：{exc}")
        return 3

    # 登记簿跟着任务根走：测试任务的登记不进真实台账（区域分离）
    ledger = root_dir / "intake_ledger.json"
    data = {"entries": []}
    if ledger.exists():
        data = json.loads(ledger.read_text(encoding="utf-8"))
    data["entries"].append({
        "ts": datetime.now().isoformat(timespec="seconds"),
        "original_path": str(src),
        "original_name": src.name,
        "task": task,
        "file": dst.name,
        "size": dst.stat().st_size,
    })
    ledger.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # project.json 最小骨架：状态字段让"继续 projects/<名>"有据可依
    (task_dir / "project.json").write_text(json.dumps({
        "task": task,
        "created": datetime.now().isoformat(timespec="seconds"),
        "source_original_name": src.name,
        "status": "intake",
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ 已收编 {src.name} → {dst}")
    # 显示相对工作区的真实路径（测试任务在 tmp/ 下，不能谎报 projects/）
    rel = task_dir.relative_to(ROOT) if task_dir.is_relative_to(ROOT) else task_dir
    print(f"  任务：{rel}（status=intake）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
