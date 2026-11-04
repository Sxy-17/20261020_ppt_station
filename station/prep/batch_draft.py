#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""批量出稿（产品组件）：为无 draft 的页生成 80 分初稿

策略（SKILL Step4 决策序的自动化执行）：
- dominant_picture / diagram_like → 贴原图（保底铁律；重绘留给用户点名/✦美化）
- content → 标准单栏：标题 + outline 层级 bullets + emphasis 强调重现
- code → 标题 + 等宽面板（NBSP 缩进）
- cover/toc/section/ending → 标准版式

为什么是脚本而不是 agent 手写：简单版式页（content/code/cover 等）结构确定，
数据全在 meta/outline——数据驱动一次成型，agent 只处理点名重绘的复杂页。

用法：
    .venv/Scripts/python station/prep/batch_draft.py <task_dir> [--no-qc]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

INK, PRIM, ACC, DIM, SEC = "#1D2430", "#1F4E79", "#C25E00", "#5B7DA3", "#F5F7FA"


def esc(t: str) -> str:
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def char_w(ch: str, size: int) -> float:
    return size * (0.55 if ord(ch) < 0x2E80 else 1.0)


def wrap_tspans(segs, x, size, max_px):
    """segs=[(text,{color,bold,underline})] → 折行 <text>（保留行内强调，缩进 NBSP）"""
    flat = [(ch, st) for t, st in segs for ch in t]
    lines, cur, w = [], [], 0.0
    for ch, st in flat:
        cw = char_w(ch, size)
        if w + cw > max_px and cur:
            lines.append(cur)
            cur, w = [], 0.0
        cur.append((ch, st))
        w += cw
    if cur:
        lines.append(cur)

    def emit(run):
        out, buf, last_st = "", "", {}
        for ch, st in run:
            if st != last_st and buf:
                out += _styled(buf, last_st)
                buf = ""
            last_st = st
            buf += ch
        out += _styled(buf, last_st)
        return out

    def _styled(txt, st):
        t = esc(txt.replace(" ", "\u00A0"))
        s = ""
        if st.get("color"):
            s += f' fill="{st["color"]}"'
        if st.get("bold"):
            s += ' font-weight="bold"'
        if st.get("underline"):
            s += ' text-decoration="underline"'
        return f'<tspan{s}>{t}</tspan>' if s else t

    if not lines:
        return ""
    body = emit(lines[0])
    for ln in lines[1:]:
        body += f'<tspan x="{x}" dy="{round(size * 1.55)}">{emit(ln)}</tspan>'
    return body


def apply_emphasis(line: str, emphasis: list) -> list:
    """emphasis 命中片段 → 带 style 的 segs（红/scheme→accent，其余→primary）"""
    segs = [(line, {})]
    for e in emphasis[:12]:
        t = (e.get("text") or "").strip()
        if len(t) < 2:
            continue
        st = {}
        # bold 不再应用：老课件 run 级 b=1 是伪粗残留（教训：P5/P17/P20/P21/P25 五页
        # 用户实证无真粗）。颜色/下划线仍保留；真粗页由用户在审核中点名。
        if e.get("color"):
            c = str(e["color"]).upper()
            # 原文强调色 hex 原样保留（与手绘流程图页一致：老师的红就是红，整册统一）；
            # scheme 引用在批量层无法可靠解析成具体色，退到模板藏蓝
            st["color"] = c if c.startswith("#") else PRIM
        if e.get("underline"):
            st["underline"] = True
        if not st:
            continue
        nxt = []
        for seg_text, seg_st in segs:
            i = seg_text.find(t) if not seg_st else -1
            if i >= 0:
                nxt += [(seg_text[:i], seg_st), (t, st), (seg_text[i + len(t):], seg_st)]
            else:
                nxt.append((seg_text, seg_st))
        segs = nxt
    return segs


HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" lang="zh-CN"\n'
        '  data-pptx-page-role="{role}" font-family="Microsoft YaHei" font-size="18">\n'
        '  <rect id="page-background" x="0" y="0" width="1280" height="720" fill="#FFFFFF"'
        ' data-pptx-role="background"/>\n')
TAIL = "</svg>\n"


def title_group(title: str) -> str:
    return (f'  <g id="page-title" data-pptx-bounds="80 40 1120 90">\n'
            f'    <text x="80" y="108" font-size="30" font-weight="bold" fill="{INK}">{esc(title)}</text>\n'
            f'    <line x1="80" y1="130" x2="240" y2="130" stroke="{PRIM}" stroke-width="2"/>\n'
            f'  </g>\n')


def keep_page(n: int) -> str:
    """保底贴原图：4:3 原图等比入 16:9 画幅（白底居中）"""
    return (HEAD.format(role="content") +
            f'  <g id="original-figure" data-pptx-bounds="160 0 960 720">\n'
            f'    <image href="../images/p{n:03d}_original.png" x="160" y="0" width="960"'
            f' height="720" preserveAspectRatio="xMidYMid meet"/>\n'
            f'  </g>\n' + TAIL)


def cover_page(meta) -> str:
    t = meta.get("title") or "（未命名）"
    return (HEAD.format(role="cover") +
            f'  <g id="cover-title" data-pptx-bounds="96 240 1120 200">\n'
            f'    <rect x="96" y="252" width="8" height="140" fill="{PRIM}"/>\n'
            f'    <text x="136" y="330" font-size="50" font-weight="bold" fill="{INK}">{esc(t)}</text>\n'
            f'  </g>\n' + TAIL)


def section_page(meta) -> str:
    t = meta.get("title") or "章节"
    return (HEAD.format(role="section") +
            f'  <g id="section-title" data-pptx-bounds="240 280 800 160">\n'
            f'    <text x="640" y="380" font-size="44" font-weight="bold" fill="{INK}"'
            f' text-anchor="middle">{esc(t)}</text>\n'
            f'    <line x1="480" y1="410" x2="800" y2="410" stroke="{ACC}" stroke-width="3"/>\n'
            f'  </g>\n' + TAIL)


def ending_page(meta) -> str:
    t = meta.get("title") or "谢谢"
    return (HEAD.format(role="ending") +
            f'  <g id="ending-title" data-pptx-bounds="240 280 800 160">\n'
            f'    <text x="640" y="380" font-size="48" font-weight="bold" fill="{PRIM}"'
            f' text-anchor="middle">{esc(t)}</text>\n'
            f'  </g>\n' + TAIL)


def toc_page(meta) -> str:
    items = [o["text"] for o in meta.get("outline", [])][:10] or [meta.get("title", "")]
    rows, y = [], 190
    for i, it in enumerate(items, 1):
        rows.append(f'    <text x="100" y="{y}" font-size="18" fill="{DIM}">{i:02d}</text>')
        rows.append(f'    <text x="160" y="{y}" font-size="20" fill="{INK}">{esc(it[:30])}</text>')
        y += 52
    return (HEAD.format(role="toc") + title_group(meta.get("title") or "目录") +
            f'  <g id="toc-list" data-pptx-bounds="80 160 1120 520">\n' +
            "\n".join(rows) + "\n  </g>\n" + TAIL)


def content_page(meta, text_md: str = "") -> str:
    outline, emphasis = meta.get("outline", []), meta.get("emphasis", [])
    if not outline:
        # 回退：无大纲层级的页（extract 抽不出 lvl，如 P4/P50）用「## 文字」行当 L0 条目；
        # 否则 body-list 全空（用户实测 P4"没字啊"）。首行若与标题重复则跳过。
        grab, in_sec = [], False
        for ln in text_md.splitlines():
            if ln.startswith("## "):
                in_sec = ln.startswith("## 文字")
                continue
            if in_sec and ln.strip() and not ln.startswith("#"):
                grab.append(ln[2:] if ln.startswith("- ") else ln)
        if grab and grab[0].strip() == (meta.get("title") or "").strip():
            grab = grab[1:]
        outline = [{"text": t, "lvl": 0} for t in grab]
        # 回退条目无层级信息，长列表自然落入下面的密集级；紧凑开关由 many 统一接管
    rows, y = [], 196
    # 行距（用户实测校准 2026-11-04：P4/P5"段间距略大"）：舒适档 = 字号×1.9；
    # 长列表或预计溢出时降密集档（19px、×1.35+3），宁可密也不截断内容
    SIZES = {0: 26, 1: 24, 2: 22, 3: 20}
    XS = {0: 80, 1: 124, 2: 168, 3: 212}

    def est_lines(text, sz, x):
        # 粗估折行数（中文≈1×字号、拉丁≈0.55）：够用就好，真折行走 wrap_tspans
        avail = (1200 - x - 24) * 0.93
        return max(1, int(len(text) * sz * 0.88 / avail) + 1)

    def fits(items, stepfn):
        yy = 196
        for o in items[:22]:
            lvl = min(o.get("lvl", 0), 2)
            sz = 20 if many else SIZES[lvl]
            x = 80 + lvl * 44
            yy += stepfn(sz) * est_lines(o.get("text", ""), sz, x)
            if yy > 688:
                return False
        return True

    many = len(outline) > 12
    if not many and not fits(outline, lambda sz: round(sz * 1.9)):
        many = True  # 舒适档装不下 → 密集档，保证内容不丢
    for o in outline[:22]:
        lvl = min(o.get("lvl", 0), 3)
        if many:
            size, x = 20, XS[0] + lvl * 32
        else:
            size, x = SIZES[lvl], XS[lvl]
        tx = x + 24  # 文字右移给层级圆点让位：原文每行都带 Wingdings 圆点（用户点名保留）
        segs = apply_emphasis(o["text"], emphasis)
        wrapped = wrap_tspans(segs, tx, size, int((1200 - tx) * 0.93))
        # 0.93 安全系数：质检器对拉丁/湿排混行的估宽（≈0.96×字号含 headroom）比
        # wrap_tspans 的 0.55×拉丁更保守，不留余量会在质检门反复撞线（P21/70/71/85）
        dot_sz = 8 if many else (12, 10, 8, 8)[lvl]
        rows.append(f'    <text x="{x + 2}" y="{y - 1}" font-size="{dot_sz}" fill="{PRIM}">●</text>')
        rows.append(f'    <text x="{tx}" y="{y}" font-size="{size}">{wrapped}</text>')
        n_lines = wrapped.count('dy=') + 1
        y += (round(20 * 1.35) + 3) * n_lines if many else round(size * 1.9) * n_lines
        if y > 680:
            break
    return (HEAD.format(role="content") + title_group(meta.get("title") or "") +
            f'  <g id="body-list" data-pptx-bounds="80 160 1120 530">\n' +
            "\n".join(rows) + "\n  </g>\n" + TAIL)


def code_page(meta, text_md: str) -> str:
    lines, in_code = [], False
    for ln in text_md.splitlines():
        if ln.startswith("## 文字"):
            in_code = True
            continue
        if in_code and ln.startswith("- "):
            if ln[2:].strip():
                lines.append(ln[2:])
        elif in_code and ln.startswith("##"):
            break
    rows, y = [], 196
    for cl in lines[:22]:
        indent = len(cl) - len(cl.lstrip(" "))
        rows.append(f'    <text x="132" y="{y}" font-family="Consolas" font-size="15"'
                    f' fill="{INK}">{"\u00A0" * indent}{esc(cl.strip())}</text>')
        y += 26
    return (HEAD.format(role="content") + title_group(meta.get("title") or "代码") +
            f'  <g id="code-panel" data-pptx-bounds="100 150 1080 530">\n'
            f'    <rect x="100" y="150" width="1080" height="530" rx="8" fill="{SEC}"/>\n' +
            "\n".join(rows) + "\n  </g>\n" + TAIL)


def gen(meta: dict, text_md: str) -> str:
    role = meta.get("role_guess", "content")
    if meta.get("dominant_picture") or meta.get("diagram_like"):
        return keep_page(meta["page"])
    if role == "code":
        return code_page(meta, text_md)
    if role == "content":
        return content_page(meta, text_md)  # content 需要文字回退（outline 空时用 text.md）
    return {"cover": cover_page, "toc": toc_page, "section": section_page,
            "ending": ending_page}[role](meta)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--no-qc", action="store_true", help="跳过逐页质检（不建议）")
    args = ap.parse_args()

    pages_dir = Path(args.task_dir) / "pages"
    made = []
    for pdir in sorted(pages_dir.glob("[0-9][0-9][0-9]")):
        if (pdir / "draft.svg").exists():
            continue
        meta_f = pdir / "meta.json"
        if not meta_f.exists():
            continue
        meta = json.loads(meta_f.read_text(encoding="utf-8"))
        text_md = (pdir / "text.md").read_text(encoding="utf-8") \
            if (pdir / "text.md").exists() else ""
        (pdir / "draft.svg").write_text(gen(meta, text_md), encoding="utf-8")
        made.append(meta["page"])
    print(f"✓ 生成 {len(made)} 页初稿（已有稿跳过）")

    if not args.no_qc and made:
        fails = []
        for n in made:
            f = pages_dir / f"{n:03d}" / "draft.svg"
            r = subprocess.run([sys.executable, str(ROOT / "station" / "qc.py"), str(f)],
                               capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
            if r.returncode != 0:
                fails.append((n, [l.strip() for l in r.stdout.splitlines()
                                  if "ERROR" in l or "共" in l][:3]))
        if fails:
            print(f"⚠ 质检未过 {len(fails)} 页（点名修复或 --no-qc 先出后修）：")
            for n, errs in fails[:12]:
                print(f"  P{n}: {errs}")
        else:
            print("✓ 全部通过质检门")

    # 状态推进
    pjf = Path(args.task_dir) / "project.json"
    if pjf.exists():
        pj = json.loads(pjf.read_text(encoding="utf-8"))
        pj["status"] = "drafted"
        pj["drafted_pages"] = len(list(pages_dir.glob("*/draft.svg")))
        pjf.write_text(json.dumps(pj, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
