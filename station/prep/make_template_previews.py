#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""模板样张生成器：为每篇 template-*.md 生成标准样张页（选模板零等待的关键）

为什么样张住库里（library/aesthetics/previews/）：库是可迁移资产包，
样张随篇走——拷走库即自带预览；"可再生"不违背（生成器在本脚本，
随时可重跑），但资产完整性优先于 gitignore 维度的"可再生不入库"。

样张内容固定（标题/三要点/小流程/大数字锚点）——选模板=选语言，
与用户内容无关；确认后再全量生成。
用法：
    .venv/Scripts/python station/prep/make_template_previews.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "library" / "aesthetics"
OUT = LIB / "previews"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def lum(hexc: str) -> float:
    h = hexc.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def parse_frontmatter(text: str) -> dict:
    m = re.search(r"^---\n(.*?)\n---", text, re.S)
    out = {}
    if not m:
        return out
    cur_key = None
    for ln in m.group(1).splitlines():
        kv = re.match(r"^([\w-]+):\s*(.*)$", ln)
        if kv:
            cur_key, val = kv.group(1), kv.group(2).strip().strip('"')
            out[cur_key] = val
        elif re.match(r"^\s", ln) and cur_key:
            sub = re.match(r"^\s+([\w-]+):\s*(.+)$", ln)
            if sub:
                out[f"{cur_key}.{sub.group(1)}"] = sub.group(2).strip().strip('"')
    return out


def specimen_svg(fm: dict) -> str:
    bg = fm.get("palette.background", "#FFFFFF")
    card = fm.get("palette.secondary_bg", "#F5F7FA")
    prim = fm.get("palette.primary", "#1F4E79")
    acc = fm.get("palette.accent", "#C25E00")
    text = fm.get("palette.body_text", "#1D2430")
    dark = lum(bg) < 0.5
    title_font = fm.get("fonts.heading", "Microsoft YaHei")
    body_font = fm.get("fonts.body", "Microsoft YaHei")
    tid = fm.get("id", "?")

    # 模板气质微调（关键词启发，够用不过度）
    name = fm.get("name", "")
    radius = 18 if "柔和" in name else (0 if "瑞士" in name else 10)
    stroke_card = "none" if "柔和" not in name else "#00000018"
    serif = any(k in title_font for k in ("楷", "宋", "楷体"))
    tf = f'{title_font}, serif' if serif else f'{title_font}, sans-serif'

    line = prim if not dark else prim
    sub = "#8A94A0" if not dark else "#9FB0AC"

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" font-family="{body_font}, sans-serif">
  <rect width="640" height="360" fill="{bg}"/>
  <rect x="28" y="34" width="6" height="64" fill="{prim}"/>
  <text x="48" y="66" font-family="{tf}" font-size="30" font-weight="bold" fill="{text}">数据流分析</text>
  <text x="48" y="94" font-size="13" fill="{sub}">模板样张 · {name}</text>

  <g font-size="14" fill="{text}">
    <text x="48" y="140">· 到达定值：沿路径传播的赋值信息</text>
    <text x="48" y="166">· 活跃变量：未来还会被读的变量</text>
    <text x="48" y="192">· 迭代求解：in/out 交替至不动点</text>
  </g>

  <g>
    <rect x="48" y="216" width="120" height="44" rx="{radius}" fill="{card}" stroke="{stroke_card}"/>
    <text x="108" y="243" font-size="14" fill="{text}" text-anchor="middle">建立方程</text>
    <line x1="172" y1="238" x2="206" y2="238" stroke="{line}" stroke-width="2"/>
    <path d="M200 233 L208 238 L200 243 Z" fill="{line}"/>
    <rect x="212" y="216" width="120" height="44" rx="{radius}" fill="{card}" stroke="{stroke_card}"/>
    <text x="272" y="243" font-size="14" fill="{text}" text-anchor="middle">迭代</text>
    <line x1="336" y1="238" x2="370" y2="238" stroke="{line}" stroke-width="2"/>
    <path d="M364 233 L372 238 L364 243 Z" fill="{line}"/>
    <rect x="376" y="216" width="120" height="44" rx="{radius}" fill="{card}" stroke="{stroke_card}"/>
    <text x="436" y="243" font-size="14" fill="{text}" text-anchor="middle">不动点</text>
  </g>

  <text x="48" y="330" font-size="44" font-weight="bold" fill="{acc}">3.2×</text>
  <text x="128" y="330" font-size="14" fill="{sub}">典型收敛加速比（示例数字）</text>
  <text x="600" y="344" font-size="11" fill="{sub}" text-anchor="end">specimen · {tid}</text>
</svg>
'''


def main() -> int:
    OUT.mkdir(exist_ok=True)
    n = 0
    for f in sorted(LIB.glob("template-*.md")):
        fm = parse_frontmatter(f.read_text(encoding="utf-8"))
        if not fm.get("palette.background"):
            print(f"跳过 {f.name}（无色板）")
            continue
        (OUT / f"{f.stem}.svg").write_text(specimen_svg(fm), encoding="utf-8")
        print(f"✓ {f.stem}.svg")
        n += 1
    print(f"共生成 {n} 张样张 → library/aesthetics/previews/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
