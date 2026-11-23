#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""文字列表页原生直出·SVG 预览方言生成器（ch3 式，配套 other-native-pptx-workflow.md）

从 sources/source.pptx 代码层提取段落树，按"PPT 排版参数对齐常量"输出方言 draft.svg
（一个 <text> 多 tspan、行首 x/soft-break/dy、字面 bullet+前导空白缩进、data-pptx-frame）。
产出的 SVG 经 export.py（--reflow-text + postprocess v3.1）导出后 = 原生段落 PPTX。

用法：
    .venv/Scripts/python station/prep/gen_native_list_svg.py <task_dir> \
        [--pages 1,2,4] [--emphasis-file emphasis.json] [--start-y 185]

- 段落树：python-pptx 代码层提取（para.level + runs 文本），空段跳过；
  shape 名带"标题"→标题框，其余（非空）→内容占位符。
- 强调映射（可选）：--emphasis-file JSON：
  {"2": [{"text": "幺模变换", "extra": " font-weight=\"bold\""},
          {"text": "向量化", "extra": " font-weight=\"bold\" fill=\"#FF0000\""}]}
  （key=页号字符串，text 精确匹配段落全文，extra=追加到文字 tspan 的属性串）
- 无正文（章节/封面/全图形页）自动跳过并提示。
- 写入走 write_draft.py 同款 mtime 保护（已有稿自动带 base-mtime；QC 失败不落盘）。

常量组（验收锚点，勿单改单项；调整需两端重验）：
    SZ0=26px(一级) SZ1=22px(二级+) DY=52px(行距) X_TEXT=95
    bullet 前导空白：一级无 / 二级 NBSP×3 / 三级 NBSP×7
    frame 宽 = 最长行估宽 + 60，高 = DY×行数 + 50
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
A = "http://schemas.openxmlformats.org/drawingml/2006/main"

# —— 常量组（验收锚点：chapter3_前10页_初审.pptx P1/P2，用户眼验 2026-11-23）——
SZ0, SZ1, DY, X_TEXT = 26, 22, 52, 95
LEAD = {0: "", 1: "\u00a0" * 3, 2: "\u00a0" * 7}     # bullet 前导空白（层级缩进）
FRAME_W_EXTRA = 60                                    # frame 宽余量


def esc(t: str) -> str:
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def extract_tree(src_pptx: Path, page: int):
    """代码层提取段落树：[(lvl, text), ...]（空段跳过）+ 标题文字。"""
    from pptx import Presentation

    prs = Presentation(str(src_pptx))
    if page > len(prs.slides):
        return None, None
    tree, title = [], None
    for sh in prs.slides[page - 1].shapes:
        if not sh.has_text_frame:
            continue
        is_title = "标题" in sh.name
        for para in sh.text_frame.paragraphs:
            text = "".join(r.text for r in para.runs)
            if not text.strip():
                continue
            if is_title and title is None:
                title = text.strip()
            elif not is_title:
                tree.append((para.level, text))
    return title, tree


def line_tspan(lvl, text, first, extra=""):
    x = "" if first else f' x="{X_TEXT}"'
    soft = "" if first else ' data-paragraph-soft-break="0"'
    dy = "" if first else f' dy="{DY}"'
    lead = LEAD.get(lvl, LEAD[2])
    if lvl == 0:
        bu_sz = f"{SZ0 * 1.25:.0f}"
        return (f'<tspan{x}{soft}{dy} font-size="{bu_sz}" fill="#1F4E79">•\u00a0</tspan>'
                f'<tspan font-size="{SZ0}"{extra}>{esc(text)}</tspan>')
    return (f'<tspan{x}{soft}{dy} font-size="{SZ1}" fill="#1F4E79">'
            f'{lead}–\u3000</tspan><tspan font-size="{SZ1}"{extra}>{esc(text)}</tspan>')


def frame_w(tree, emphasis):
    widest = 0
    for lvl, text in tree:
        ex = emphasis.get(text, "")
        fs = SZ0 if lvl == 0 else SZ1
        w = sum((34 if ord(c) > 0x2E80 else 21) for c in text) * (fs / SZ1) \
            + len(LEAD.get(lvl, "")) * 14.5 + 30
        widest = max(widest, w)
    return int(widest + FRAME_W_EXTRA)


def build_svg(title, tree, emphasis, start_y=185):
    frame_h = DY * len(tree) + 50
    frame = f"90 {start_y - 35} {frame_w(tree, emphasis)} {frame_h}"
    lines = []
    for lvl, text in tree:
        extra = emphasis.get(text, "")
        lines.append(line_tspan(lvl, text, first=(not lines), extra=extra))
    body = "\n      ".join(lines)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" lang="zh-CN"
  data-pptx-page-role="content" font-family="Microsoft YaHei" font-size="18">
  <rect id="page-background" x="0" y="0" width="1280" height="720" fill="#FFFFFF" data-pptx-role="background"/>
  <g id="page-title" data-pptx-bounds="80 40 1120 78">
    <text x="80" y="108" font-size="30" font-weight="bold" fill="#1D2430">{esc(title)}</text>
    <line x1="80" y1="130" x2="240" y2="130" stroke="#1F4E79" stroke-width="2"/>
  </g>
  <g id="content" data-pptx-bounds="60 122 1170 598">
    <text x="95" y="{start_y}" font-size="{SZ0}" data-pptx-frame="{frame}" data-pptx-text-baseline="metrics-v1">
      {body}
    </text>
  </g>
</svg>
'''


def write_via_write_draft(task_dir: Path, page: int, svg_text: str) -> bool:
    """走 write_draft.py 的 mtime 保护链路写入 + QC。返回是否成功落盘。"""
    tmp = task_dir / "tmp_native" / f"{page:03d}.svg"
    tmp.parent.mkdir(exist_ok=True)
    tmp.write_text(svg_text, encoding="utf-8", newline="\n")

    def current_mtime():
        out = subprocess.run(
            [sys.executable, str(ROOT / "station" / "prep" / "write_draft.py"),
             str(task_dir), str(page), "--mtime"],
            capture_output=True, text=True, encoding="utf-8", errors="replace")
        m = re.search(r"\b(\d{13})\b", out.stdout + out.stderr)
        return m.group(1) if m else None

    draft = task_dir / "pages" / f"{page:03d}" / "draft.svg"
    cmd = [sys.executable, str(ROOT / "station" / "prep" / "write_draft.py"),
           str(task_dir), str(page), str(tmp)]
    mt = current_mtime()
    if mt and draft.exists():
        cmd += ["--base-mtime", mt]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    ok = "✓" in (out.stdout + out.stderr)
    print(f"  P{page}: {(out.stdout + out.stderr).strip().splitlines()[-1] if (out.stdout + out.stderr).strip() else out.returncode}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--pages", required=True, help="逗号分隔页号，如 11,12,13")
    ap.add_argument("--emphasis-file", help="强调映射 JSON（可选）")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    src_pptx = task_dir / "sources" / "source.pptx"
    emphasis = {}
    if args.emphasis_file and Path(args.emphasis_file).exists():
        emphasis_all = json.loads(Path(args.emphasis_file).read_text(encoding="utf-8"))
    else:
        emphasis_all = {}

    pages = [int(x) for x in args.pages.split(",") if x.strip()]
    skipped, done = [], []
    for page in pages:
        title, tree = extract_tree(src_pptx, page)
        if tree is None or not tree:
            skipped.append(page)
            print(f"P{page}: 跳过（无正文段落——封面/章节/全图形页请另行处理）")
            continue
        em = {it["text"]: it["extra"] for it in emphasis_all.get(str(page), [])}
        svg = build_svg(title, tree, em)
        if write_via_write_draft(task_dir, page, svg):
            done.append(page)
    print(f"✓ 完成 {len(done)} 页: {done}" + (f"；跳过 {skipped}" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
