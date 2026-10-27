#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""老格式转换：sources/source.ppt → sources/source.pptx（Windows Office COM）

为什么用本机 PowerPoint COM 而非第三方转换库：.ppt 是闭源二进制格式，
只有 PowerPoint 本尊转换保真可靠（LibreOffice 等对组合形状/艺术字有损）。
装 Office 是 A 路线环境前提（README 已声明）。

用法：
    .venv/Scripts/python station/prep/convert.py <task_dir> [--force]
幂等：source.pptx 已存在则跳过（--force 强制重转）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PP_SAVE_AS_OPENXML = 24  # ppSaveAsOpenXMLPresentation：.ppt → .pptx


def open_powerpoint():
    try:
        import win32com.client
    except ImportError:
        print("缺 pywin32：.venv/Scripts/pip install pywin32")
        sys.exit(3)
    try:
        # DispatchEx 起独占实例：不动用户可能开着的 PowerPoint，Quit 只关自己的
        return win32com.client.DispatchEx("PowerPoint.Application")
    except Exception as exc:  # noqa: BLE001 —— COM 异常类型不稳定，宽捕获+人话
        print(f"无法启动 PowerPoint（本机未装 Office？）：{exc}")
        sys.exit(3)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir", help="任务目录，如 projects/xxx")
    ap.add_argument("--force", action="store_true", help="已转换过也重转")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    src = task_dir / "sources" / "source.ppt"
    dst = task_dir / "sources" / "source.pptx"

    if not src.exists():
        if dst.exists():
            print("无 .ppt 需转换（source.pptx 已在）")
            return 0
        print(f"找不到 {src}")
        return 2
    if dst.exists() and not args.force:
        print(f"已有 {dst.name}，跳过（--force 重转）")
        return 0

    app = open_powerpoint()
    try:
        # Open(文件, 只读=True, 无标题=False, 不带窗口=False)
        # WithWindow=False 是无界面关键；不碰 app.Visible（部分版本会抛错）
        pres = app.Presentations.Open(str(src.resolve()), True, False, False)
        try:
            pres.SaveAs(str(dst.resolve()), PP_SAVE_AS_OPENXML)
        finally:
            pres.Close()
    finally:
        app.Quit()

    print(f"✓ {src.name} → {dst.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
