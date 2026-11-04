# -*- coding: utf-8 -*-
"""P7~P16 统一骨架流程图页生成器 v2（chapter1_clean_20261104 专用）

迁入 station/prep/ 原因（R3）：中间产物必须可再生+脚本可追溯，tmp/ 不入库。
重跑：.venv/Scripts/python station/prep/gen_cfg_chapter1.py（幂等，覆盖 P7~16 稿）

v2 修订（用户视觉复核反馈 2026-11-04，R15：亲眼核对后改）：
- 整体上移：B1 y146→118，图区底部留白归还
- 框加高装字：B2/B3 92→100，B5/B6 156→164，块内字号 11.5→12.5（"太小了"）
- 自环改真圆弧：原 v1 是直线+箭头（用户点名"圆形指向自己"），改为从块左侧
  出去、圆弧绕回块左上的 C 形 path——语义=goto 回本块开头
- 回边不再穿框：B5→B2 横线 y324 从 B2 中腰穿过（被框压住）→ 改走 B2 顶部入
- B4 侧入边修直：终点收到 B4 左/右边缘上（原 v1 终点悬在框外空中）
- P7 右侧 C 对照行按块中心对齐（v1 手放错位）；侧卡越界修
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]  # station/prep/ 上两级=工作区根
TASK = ROOT / "projects" / "chapter1_clean_20261104" / "pages"

# ---------- 调色（结构色走模板，强调色走原文） ----------
INK, NAVY, GRAY, SOFT = "#1D2430", "#1F4E79", "#8A94A0", "#5B7DA3"
RED, AMBER, BLUE, GREEN = "#FF0000", "#FFC000", "#00B0F0", "#00AE00"

# ---------- 固定骨架坐标 v2（16:9，十页不变——用户核心要求） ----------
B1 = (520, 118, 250, 112)
B2 = (520, 252, 250, 100)
B3 = (520, 372, 250, 100)
B4 = (500, 492, 290, 42)
B5 = (150, 534, 285, 170)   # 加高 164：九行 12.5px 装得下且贴边
B6 = (845, 534, 290, 170)
CX = 645  # 中轴

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def L(s, c=None):
    return [(s, c)]

def code_line(runs, x, y, size, family="Consolas"):
    parts = []
    for txt, color in runs:
        t = esc(txt)
        parts.append(f'<tspan fill="{color}">{t}</tspan>' if color else t)
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
            f'fill="{INK}">{"".join(parts)}</text>')

def block(gid, box, lines, first, leading, size):
    x, y, w, h = box
    out = [f'  <g id="{gid}">']
    out.append(f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="#FFFFFF" '
               f'stroke="{INK}" stroke-width="1.6"/>')
    out.append(f'    <text x="{x+w-12}" y="{y+22}" font-size="14" font-weight="bold" '
               f'fill="{NAVY}" text-anchor="end">{gid[-2:]}</text>')
    for i, runs in enumerate(lines):
        out.append("    " + code_line(runs, x+16, first+i*leading, size))
    out.append("  </g>")
    return "\n".join(out)

def card(gid, x, y, w, h, lines, first, leading, size=12.5, soft=False):
    stroke = SOFT if soft else INK
    fill = "#F5F7FA" if soft else "#FFFFFF"
    out = [f'  <g id="{gid}">']
    out.append(f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fill}" '
               f'stroke="{stroke}" stroke-width="1.3"/>')
    for i, runs in enumerate(lines):
        out.append("    " + code_line(runs, x+14, first+i*leading, size))
    out.append("  </g>")
    return "\n".join(out)

def note(gid, text, x, y, w, color=RED, size=15):
    return (f'  <g id="{gid}">\n    <text x="{x+w//2}" y="{y}" font-size="{size}" '
            f'fill="{color}" text-anchor="middle">{esc(text)}</text>\n  </g>')

def dots(gid, cx_list, cy):
    circles = "".join(f'<circle cx="{cx}" cy="{cy}" r="4.5" fill="{GRAY}"/>' for cx in cx_list)
    return f'  <g id="{gid}">{circles}</g>'

def ell(gid, cx, cy, rx, ry):
    """黄圈圈（原版椭圆形状坐标确定性提取，R20 第四形态：圈注强调）"""
    return (f'  <g id="{gid}"><ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" '
            f'fill="none" stroke="{AMBER}" stroke-width="2.5"/></g>')

def arrow(gid, x1, y1, x2, y2, width=1.8):
    return (f'  <g id="{gid}">\n    <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{INK}" stroke-width="{width}" marker-end="url(#ah)"/>\n  </g>')

def skeleton(page):
    """十页共用骨架 v2：上移版。边全部重新终算，不再穿框。"""
    s = []
    n1 = len(page["B1"])
    if n1 > 4:
        s.append(block("blk-B1", B1, page["B1"], 146, 16, 13))
    else:
        s.append(block("blk-B1", B1, page["B1"], 148, 21, 14))
    n5 = max(len(page["B5"]), len(page["B6"]))
    if n5 > 6:
        s.append(block("blk-B5", B5, page["B5"], 556, 16, 13))
        s.append(block("blk-B6", B6, page["B6"], 556, 16, 13))
    else:
        s.append(block("blk-B5", B5, page["B5"], 562, 21, 14))
        s.append(block("blk-B6", B6, page["B6"], 562, 21, 14))
    s.append(block("blk-B2", B2, page["B2"], 278, 21, 14))
    s.append(block("blk-B3", B3, page["B3"], 398, 21, 14))
    s.append(block("blk-B4", B4, page["B4"], 518, 20, 15))
    # 主链边（块间距 22/20/20px，箭头干净不压字）
    s.append(arrow("edge-b1b2", CX, 230, CX, 248))
    s.append(arrow("edge-b2b3", CX, 352, CX, 368))
    s.append(arrow("edge-b3b4", CX, 472, CX, 488))
    # B4→B5/B6：从 B4 左/右边缘出发，终点落在 B5/B6 顶边（悬空点已修）
    s.append(arrow("edge-b4b5", 500, 522, 380, 532))
    s.append(arrow("edge-b4b6", 790, 522, 905, 532))
    # 自环：C 形圆弧，从块左侧中部出去、绕回块左上角（"圆形指向自己"）
    s.append(f'  <g id="loop-b2">\n    <path d="M 520 320 C 468 320 468 268 516 262" '
             f'fill="none" stroke="{INK}" stroke-width="1.5" marker-end="url(#ah)"/>\n  </g>')
    s.append(f'  <g id="loop-b3">\n    <path d="M 520 440 C 468 440 468 388 516 382" '
             f'fill="none" stroke="{INK}" stroke-width="1.5" marker-end="url(#ah)"/>\n  </g>')
    # B5→B2 回边：左竖轨 → B1/B2 间隙横走（y241：避开 while 卡底 230 与 B2 顶 252）
    # → 短竖槎下扌入 B2 顶边（x600：在自环弧右侧、主链箭头左侧，不交叉）
    s.append(f'  <g id="rail-b5b2">\n    <path d="M 152 596 L 118 596 L 118 241 L 600 241 L 600 250" '
             f'fill="none" stroke="{INK}" stroke-width="1.7" marker-end="url(#ah)"/>\n  </g>')
    return "\n".join(s)

def page_svg(page):
    s = ['<?xml version="1.0" encoding="UTF-8"?>']
    s.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" lang="zh-CN" '
             'data-pptx-page-role="content" font-family="Microsoft YaHei" font-size="18">')
    s.append('  <defs>\n    <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" '
             'markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">\n'
             f'      <path d="M 0 0 L 10 5 L 0 10 Z" fill="{INK}"/>\n    </marker>\n  </defs>')
    s.append('  <rect id="page-background" x="0" y="0" width="1280" height="720" fill="#FFFFFF" '
             'data-pptx-role="background"/>')
    s.append('  <g id="page-title" data-pptx-bounds="80 40 1120 98">')
    s.append(f'    <text x="80" y="108" font-size="30" font-weight="bold" fill="{INK}">'
             f'{esc(page["title"])}</text>')
    if page.get("sub"):
        s.append(f'    <text x="82" y="133" font-size="13" fill="{GRAY}">{esc(page["sub"])}</text>')
    s.append('  </g>')
    s.append('  <g id="cfg-page" data-pptx-bounds="60 140 1180 570">')
    s.append(page.get("extra", ""))
    s.append(skeleton(page))
    s.append(page.get("overlay", ""))  # 圈注/覆盖元素：必须在块白底之后画，否则被盖
    s.append('  </g>')
    s.append('</svg>')
    return "\n".join(s) + "\n"

# ================= 十页数据（与 v1 相同，逐行颜色 = XML run 级抽取） =================

B1_PLAIN = [L("i = m – 1"), L("j = n"), L("t1 = 4*n"), L("v = a[t1]")]
B2_PLAIN = [L("i = i + 1"), L("t2 = 4*i"), L("t3 = a[t2]"), L("if t3<v goto B2")]
B3_PLAIN = [L("j = j – 1"), L("t4 = 4*j"), L("t5 = a[t4]"), L("if t5>v goto B3")]
B4_ONE = [L("if i >=j goto B6")]

PAGES = {}

PAGES[7] = dict(
    title="常规编译优化：中间代码与基本块",
    B1=[r[:] for r in B1_PLAIN], B2=[r[:] for r in B2_PLAIN],
    B3=[r[:] for r in B3_PLAIN], B4=[r[:] for r in B4_ONE],
    B5=[L("t6 = 4*i"), L("x = a[t6]"), L("t7 = 4*i"), L("t8 = 4*j"), L("t9 = a[t8]"),
        L("a[t7] = t9"), L("t10 = 4*j"), L("a[t10] = x"), L("goto B2")],
    B6=[L("t11 = 4*i"), L("x = a[t11]"), L("t12 = 4*i"), L("t13 = 4*n"), L("t14 = a[t13]"),
        L("a[t12] = t14"), L("t15 = 4*n"), L("a[t15] = x")],
    extra="\n".join([
        card("src-card", 140, 130, 240, 100,
             [L("while (1) {", RED), L("…", RED), L("}", RED)], 162, 28, 15, soft=True),
        '  <g id="c-lines">',
        # 右侧 C 对照行：对齐到各块顶部（v1 手放错位）
        "    " + code_line(L("i = m – 1; j = n; v = a[n];", RED), 830, 148, 14),
        "    " + code_line(L("do i = i + 1; while (a[i] < v);", RED), 830, 282, 14),
        "    " + code_line(L("do j = j – 1; while (a[j] > v);", RED), 830, 402, 14),
        "    " + code_line(L("if (i >= j) break;", RED), 830, 518, 14),
        "  </g>",
        card("c-swap-b5", 460, 590, 180, 84,
             [L("x = a[i];", RED), L("a[i] = a[j];", RED), L("a[j] = x;", RED)], 614, 20, 12, soft=True),
        card("c-swap-b6", 650, 590, 180, 84,
             [L("x = a[i];", RED), L("a[i] = a[n];", RED), L("a[n] = x;", RED)], 614, 20, 12, soft=True),
    ]),
)

PAGES[8] = dict(
    title="局部公共子表达式消除（CSE）", sub="common subexpression elimination",
    B1=[r[:] for r in B1_PLAIN], B2=[r[:] for r in B2_PLAIN],
    B3=[r[:] for r in B3_PLAIN], B4=[r[:] for r in B4_ONE],
    B5=[L("t6 = 4*i", RED), L("x = a[t6]"), L("t7 = 4*i", RED), L("t8 = 4*j", AMBER),
        L("t9 = a[t8]"), L("a[t7] = t9"), L("t10 = 4*j", AMBER), L("a[t10] = x"), L("goto B2")],
    B6=[L("t11 = 4*i", BLUE), L("x = a[t11]"), L("t12 = 4*i", BLUE), L("t13 = 4*n", GREEN),
        L("t14 = a[t13]"), L("a[t12] = t14"), L("t15 = 4*n", GREEN), L("a[t15] = x")],
    extra="\n".join([
        card("after-b5", 470, 590, 350, 116,
             [L("t6 = 4*i", RED), L("x = a[t6]"), L("t8 = 4*j", AMBER), L("t9 = a[t8]"),
              [("a[", None), ("t6", RED), ("] = t9", None)],
              [("a[", None), ("t8", AMBER), ("] = x", None)], L("goto B2")], 610, 15, 12),
        card("after-b6", 950, 270, 300, 120,
             [L("t11 = 4*i", BLUE), L("x = a[t11]"), L("t13 = 4*n", GREEN), L("t14 = a[t13]"),
              [("a[", None), ("t11", BLUE), ("] = t14", None)],
              [("a[", None), ("t13", GREEN), ("] = x", None)]], 294, 15, 12),
        card("c-swap-b5", 140, 420, 270, 84,
             [L("x = a[i];", RED), L("a[i] = a[j];", RED), L("a[j] = x;", RED)], 444, 20, 12, soft=True),
        card("c-swap-b6", 950, 420, 270, 84,
             [L("x = a[i];", RED), L("a[i] = a[n];", RED), L("a[n] = x;", RED)], 444, 20, 12, soft=True),
    ]),
)

PAGES[9] = dict(
    title="全局公共子表达式消除（CSE）", sub="common subexpression elimination",
    B1=[L("i = m – 1"), L("j = n"), L("t1 = 4*n", BLUE), L("v = a[t1]")],
    B2=[L("i = i + 1"), L("t2 = 4*i", GREEN), L("t3 = a[t2]"), L("if t3<v goto B2")],
    B3=[L("j = j – 1"), L("t4 = 4*j", RED), L("t5 = a[t4]"), L("if t5>v goto B3")],
    B4=[r[:] for r in B4_ONE],
    B5=[L("t6 = 4*i", GREEN), L("x = a[t6]", GREEN), L("t8 = 4*j", RED), L("t9 = a[t8]", RED),
        L("a[t6] = t9"), L("a[t8] = x"), L("goto B2")],
    B6=[L("t11 = 4*i", GREEN), L("x = a[t11]", GREEN), L("t13 = 4*n", BLUE),
        L("t14 = a[t13]", BLUE), L("a[t11] = t14"), L("a[t13] = x")],
    extra="\n".join([
        card("subst-b5", 140, 150, 280, 140,
             [[("//t6 -> t2,", GREEN), ("t8 -> t4", RED)], L("x = a[t2]", GREEN),
              L("t9 = a[t4]", RED), L("a[t2] = t9", GREEN), L("a[t4] = x", RED),
              L("goto B2")], 174, 15, 12),
        card("subst-b6", 950, 150, 290, 122,
             [[("//t11 -> t2,", GREEN), ("t13 -> t1", BLUE)], L("x = a[t2]", GREEN),
              L("t14 = a[t1]", BLUE), L("a[t2] = t14", GREEN), L("a[t1] = x", BLUE)],
             174, 15, 12),
    ]),
)

PAGES[10] = dict(
    title="全局公共子表达式消除（CSE）", sub="common subexpression elimination",
    B1=[L("i = m – 1"), L("j = n"), L("t1 = 4*n", BLUE), L("v = a[t1]")],
    B2=[L("i = i + 1"), L("t2 = 4*i", GREEN), L("t3 = a[t2]"), L("if t3<v goto B2")],
    B3=[L("j = j – 1"), L("t4 = 4*j", RED), L("t5 = a[t4]"), L("if t5>v goto B3")],
    B4=[r[:] for r in B4_ONE],
    B5=[L("x = a[t2]", GREEN), L("t9 = a[t4]", RED), L("a[t2] = t9", GREEN),
        L("a[t4] = x", RED), L("goto B2")],
    B6=[L("x = a[t2]", GREEN), L("t14 = a[t1]", BLUE), L("a[t2] = t14", GREEN),
        L("a[t1] = x", BLUE)],
    extra="",
)

PAGES[11] = dict(
    title="复制传播", sub="Copy propagation",
    B1=[L("i = m – 1"), L("j = n"), L("t1 = 4*n"), L("v = a[t1]", BLUE)],
    B2=[L("i = i + 1"), L("t2 = 4*i"), L("t3 = a[t2]", RED), L("if t3<v goto B2")],
    B3=[L("j = j – 1"), L("t4 = 4*j"), L("t5 = a[t4]", GREEN), L("if t5>v goto B3")],
    B4=[r[:] for r in B4_ONE],
    B5=[L("x = a[t2]", RED), L("t9 = a[t4]", GREEN), L("a[t2] = t9"), L("a[t4] = x"),
        L("goto B2")],
    B6=[L("x = a[t2]", RED), L("t14 = a[t1]", BLUE), L("a[t2] = t14"), L("a[t1] = x")],
    extra="",
)

PAGES[12] = dict(
    title="复制传播", sub="Copy propagation",
    B1=[r[:] for r in B1_PLAIN], B2=[r[:] for r in B2_PLAIN],
    B3=[r[:] for r in B3_PLAIN], B4=[r[:] for r in B4_ONE],
    B5=[L("x = t3", RED), L("t9 = t5", GREEN), L("a[t2] = t9"), L("a[t4] = x"), L("goto B2")],
    B6=[L("x = t3", RED), L("t14 = v", BLUE), L("a[t2] = t14"), L("a[t1] = x")],
    extra="\n".join([
        note("note-keep", "Keep on propagating the copies", 470, 660, 340),
        dots("dots-b5", [215, 258], 700),
        dots("dots-b6", [910, 953], 700),
    ]),
    overlay="\n".join([
        ell("hl-b5-x", 173, 557, 12, 12), ell("hl-b5-t9", 177, 578, 15, 12),
        ell("hl-b5-t9v", 241, 599, 13, 12), ell("hl-b5-xv", 241, 620, 13, 12),
        ell("hl-b6-xt14", 871, 567, 16, 27), ell("hl-b6-vx", 936, 610, 14, 27),
    ]),
)

PAGES[13] = dict(
    title="复制传播", sub="Copy propagation",
    B1=[r[:] for r in B1_PLAIN], B2=[r[:] for r in B2_PLAIN],
    B3=[r[:] for r in B3_PLAIN], B4=[r[:] for r in B4_ONE],
    B5=[L("x = t3"), L("t9 = t5"), L("a[t2] = t5"), L("a[t4] = t3"), L("goto  B2")],
    B6=[L("x = t3"), L("t14 = v"), L("a[t2] = v"), L("a[t1] = t3")],
    overlay="\n".join([
        ell("hl-b5-x", 173, 557, 12, 12), ell("hl-b5-t9", 177, 578, 15, 12),
        ell("hl-b5-t5v", 241, 599, 13, 12), ell("hl-b5-t3v", 241, 620, 13, 12),
        ell("hl-b6-xt14", 871, 567, 16, 27), ell("hl-b6-vt3", 936, 610, 14, 27),
    ]),
)

PAGES[14] = dict(
    title="死代码删除", sub="Dead store elimination",
    B1=[r[:] for r in B1_PLAIN], B2=[r[:] for r in B2_PLAIN],
    B3=[r[:] for r in B3_PLAIN], B4=[r[:] for r in B4_ONE],
    B5=[L("x = t3", RED), L("t9 = t5", RED), L("a[t2] = t5"), L("a[t4] = t3"),
        L("goto  B2")],
    B6=[L("x = t3", RED), L("t14 = v", RED), L("a[t2] = v"), L("a[t1] = t3")],
    extra=note("note-dead", "这些数据不再被使用", 470, 660, 340),
    overlay="\n".join([
        ell("hl-b5-x", 173, 557, 12, 12), ell("hl-b5-t9", 177, 578, 15, 12),
        ell("hl-b5-t5v", 241, 599, 13, 12), ell("hl-b5-t3v", 241, 620, 13, 12),
        ell("hl-b6-xt14", 871, 567, 16, 27), ell("hl-b6-vt3", 936, 610, 14, 27),
    ]),
)

PAGES[15] = dict(
    title="归纳变量优化", sub="Induction variable",
    B1=[r[:] for r in B1_PLAIN],
    B2=[L("i = i + 1", RED), L("t2 = 4*i", RED), L("t3 = a[t2]"), L("if t3<v goto B2")],
    B3=[L("j = j – 1", RED), L("t4 = 4*j", RED), L("t5 = a[t4]"), L("if t5>v goto B3")],
    B4=[r[:] for r in B4_ONE],
    B5=[L("a[t2] = t5"), L("a[t4] = t3"), L("goto  B2")],
    B6=[L("a[t2] = v"), L("a[t1] = t3")],
    extra="",
)

PAGES[16] = dict(
    title="归纳变量优化", sub="Induction variable",
    B1=[L("i = m – 1"), L("j = n"), L("t1 = 4*n"), L("v = a[t1]"),
        L("t2 = 4* i", RED), L("t4 = 4 * j", RED)],
    B2=[L("t2 = t2 + 4", RED), L("t3 = a[t2]"), L("if t3<v goto B2")],
    B3=[L("t4 = t4 - 4", RED), L("t5 = a[t4]"), L("if t5>v goto B3")],
    B4=[r[:] for r in B4_ONE],
    B5=[L("a[t2] = t5"), L("a[t4] = t3"), L("goto  B2")],
    B6=[L("a[t2] = v"), L("a[t1] = t3")],
    extra="",
)

if __name__ == "__main__":
    for num, page in PAGES.items():
        out = TASK / f"{num:03d}" / "draft.svg"
        out.write_text(page_svg(page), encoding="utf-8")
        print(f"✓ P{num} → {out.relative_to(ROOT)}")
