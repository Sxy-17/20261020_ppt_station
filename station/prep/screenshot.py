#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""逐页截图：sources/source.pptx → pages/NNN/original.png

这批 PNG 是双份用途（需求书界面2）：①审核工作台左栏对照图
②"保留原样"裁决的保底贴图原料。分辨率默认 1920 宽：兼顾清晰与体积
（101 页 × 数百 KB，完全可控）。

用法：
    .venv/Scripts/python station/prep/screenshot.py <task_dir> [--width 1920] [--force]
幂等：页数与已有 PNG 数一致则跳过（--force 全部重截）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir", help="任务目录，如 projects/xxx")
    ap.add_argument("--width", type=int, default=1920, help="截图宽（像素），高按画幅自动")
    ap.add_argument("--force", action="store_true", help="已截图也全部重截")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    src = task_dir / "sources" / "source.pptx"
    if not src.exists():
        print(f"找不到 {src}")
        return 2

    # 幂等检查用 python-pptx 数页数（毫秒级），没必要为此启动 COM
    from pptx import Presentation
    n_pages = len(Presentation(str(src)).slides)

    pages_dir = task_dir / "pages"
    existing = list(pages_dir.glob("*/original.png")) if pages_dir.exists() else []
    if len(existing) == n_pages and not args.force:
        print(f"已有 {n_pages} 张截图，跳过（--force 重截）")
        return 0

    try:
        import win32com.client
    except ImportError:
        print("缺 pywin32：.venv/Scripts/pip install pywin32")
        return 3
    try:
        app = win32com.client.DispatchEx("PowerPoint.Application")
    except Exception as exc:  # noqa: BLE001
        print(f"无法启动 PowerPoint（本机未装 Office？）：{exc}")
        return 3

    try:
        pres = app.Presentations.Open(str(src.resolve()), True, False, False)
        try:
            # 点数比=像素比：SlideWidth/SlideHeight 是 PowerPoint 内部单位（点）
            ratio = pres.PageSetup.SlideHeight / pres.PageSetup.SlideWidth
            w, h = args.width, round(args.width * ratio)
            pages_dir.mkdir(exist_ok=True)
            for i in range(1, n_pages + 1):
                d = pages_dir / f"{i:03d}"
                d.mkdir(exist_ok=True)
                png = d / "original.png"
                pres.Slides(i).Export(str(png.resolve()), "PNG", w, h)
                print(f"  {i:03d}/{n_pages} ✓")
        finally:
            pres.Close()
    finally:
        app.Quit()

    print(f"✓ {n_pages} 页截图完成 → pages/NNN/original.png（{w}×{h}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
