#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""序列页检测：发现"渐进式讲解"页组（相邻页大部分元素位置不变）

为什么存在：老师常用"同一张图逐页加一点"的讲法（如快排推演 9 页）。
这类页若逐页独立重绘，固定元素位置会漂移，前后页继承的逻辑关系断裂
（用户 1028 指出）。检测结果写入 diagnosis.json 的 sequence_groups，
初稿生成时序列组按"基准页+增量"保位重绘（SKILL §3 Step4）。

判定：相邻页元素签名（类型/位置容差/文字前缀）保持率 ≥ KEEP_MIN 的连续页链。
用法：
    .venv/Scripts/python station/prep/sequence.py <task_dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

KEEP_MIN = 0.5   # 相邻页保持率 ≥50% 视为同序列（实测序列组 70-96%，独立页组 4%）


def sig(slide) -> set:
    out = set()

    def walk(shapes):
        for sh in shapes:
            if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
                walk(sh.shapes)
                continue
            try:
                # 0.5px 量化 + 5px 分桶：容忍微小抖动（教训：无容差会漏判）
                x = round(sh.left / 6350) // 5
                y = round(sh.top / 6350) // 5
            except Exception:
                continue
            t = str(sh.shape_type).split(" ")[0]
            txt = sh.text_frame.text.strip()[:12] if getattr(sh, "has_text_frame", False) else ""
            out.add((t, x, y, txt))
    walk(slide.shapes)
    return out


def keep_rate(a: set, b: set) -> float:
    return len(a & b) / len(a) if a else 0.0


def main() -> int:
    task_dir = Path(sys.argv[1])
    prs = Presentation(str(task_dir / "sources" / "source.pptx"))
    sigs = [sig(s) for s in prs.slides]
    n = len(sigs)

    # 贪心链：keep_rate ≥ KEEP_MIN 的连续页并入同链
    groups = []
    cur = [1]
    for i in range(2, n + 1):
        if keep_rate(sigs[i - 2], sigs[i - 1]) >= KEEP_MIN:
            cur.append(i)
        else:
            if len(cur) >= 3:   # 至少 3 页才算"序列"（2 页是巧合相似）
                groups.append(cur)
            cur = [i]
    if len(cur) >= 3:
        groups.append(cur)

    diag_path = task_dir / "diagnosis.json"
    diag = json.loads(diag_path.read_text(encoding="utf-8")) if diag_path.exists() else {}
    diag["sequence_groups"] = [
        {"pages": g, "length": len(g),
         "note": "渐进讲解序列：重绘时以首页为基准保位，后续页只做增量变更"}
        for g in groups
    ]
    diag_path.write_text(json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")

    if groups:
        for g in groups:
            print(f"● 序列组 P{g[0]}–P{g[-1]}（{len(g)} 页）← 重绘须保位")
    else:
        print("无序列组")
    return 0


if __name__ == "__main__":
    sys.exit(main())
