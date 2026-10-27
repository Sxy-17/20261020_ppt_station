#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""图片提取：把页面里的大图（PICTURE）从 pptx 内部挖出成独立文件

为什么存在：图片主导的页面（教训#18）重绘策略是"保留原图贴入"，
而贴图需要干净的图片本体——从 pptx 内部提取比从整页截图裁剪干净得多
（无标题/无装饰，就是作者当年插入的那张图）。

输出：pages/NNN/figure_K.png（K 为页内序号）。
用法：
    .venv/Scripts/python station/prep/extract_pictures.py <task_dir> [--min-area 0.10]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def walk_pictures(shapes, page_area, min_area, out_dir, page_no, counter):
    """深度收集大图；counter 用列表传引用（嵌套计数）"""
    for sh in shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            walk_pictures(sh.shapes, page_area, min_area, out_dir, page_no, counter)
            continue
        if sh.shape_type != MSO_SHAPE_TYPE.PICTURE:
            continue
        try:
            area = abs((sh.width or 0) * (sh.height or 0))
            if area / page_area < min_area:
                continue  # 小图标/装饰图不提
            counter[0] += 1
            blob = sh.image.blob
            out = out_dir / f"figure_{counter[0]}.{sh.image.ext}"
            out.write_bytes(blob)
            print(f"  P{page_no:03d} figure_{counter[0]}.{sh.image.ext}  {len(blob)//1024}KB")
            counter[1] += 1
        except Exception as exc:  # noqa: BLE001 —— 个别怪图不阻断整体
            print(f"  P{page_no:03d} 提取失败：{exc}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--min-area", type=float, default=0.10,
                    help="提取阈值：图片面积占页面比例（默认 0.10）")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    prs = Presentation(str(task_dir / "sources" / "source.pptx"))
    page_area = abs(prs.slide_width * prs.slide_height)
    total = 0

    for i, slide in enumerate(prs.slides, 1):
        out_dir = task_dir / "pages" / f"{i:03d}"
        out_dir.mkdir(parents=True, exist_ok=True)
        counter = [0, 0]  # [页内序号, 本页成功数]
        walk_pictures(slide.shapes, page_area, args.min_area, out_dir, i, counter)
        total += counter[1]

    print(f"✓ 提取 {total} 张大图 → pages/NNN/figure_K.*")
    return 0


if __name__ == "__main__":
    sys.exit(main())
