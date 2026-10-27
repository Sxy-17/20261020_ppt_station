#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""抽取：每页文字 → pages/NNN/text.md，页面元信息 → pages/NNN/meta.json

meta 的图形元素计数是识别规则的原料（需求书铁律：图绝不能丢）——
框线图/流程图页据此挂"重绘◆推荐"。角色/嫌疑都是**启发式初判**，
agent 看截图后可以覆盖（meta 只是起点，不是判决）。

为什么自写而不用 ppt-master source_to_md：它输出整份 md，我们要
"每页一个文件"的任务目录形态（页面级 meta 供工作台/裁决消费）；
思想参考它（表格保真），粒度按自己需要。

用法：
    .venv/Scripts/python station/prep/extract.py <task_dir> [--force]
幂等：每页 text.md+meta.json 齐且页数一致则跳过。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ---------- 启发式常量（都是初判，agent 看截图后可覆盖 meta） ----------
# 框线图嫌疑：连接线≥2，或自选图形≥5（组合形状已递归展开计数）
DIAGRAM_MIN_CONNECTORS = 2
DIAGRAM_MIN_AUTOSHAPES = 5
# 代码页嫌疑：命中代码特征的文字行数 ≥2
CODE_MIN_LINES = 2
CODE_HINT = re.compile(
    r"(def |class |import |from .* import|function|#include|return |"
    r"=>|; *\{|print\(|for \(|while \(|<\?php|</?[a-z]+>)"
)
ROLE_KEYWORDS = {
    "toc": ("目录", "大纲", "contents", "agenda"),
    "ending": ("谢谢", "感谢", "thank", "q&a", "结语", "结束"),
}


def walk_shapes(shapes):
    """递归展开组合形状（老课件的框线图常被组合成一个 shape——
    不展开就会数成 1 个形状，漏挂重绘推荐，违反'图不能丢'铁律）。"""
    for sh in shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield "group", sh
            yield from walk_shapes(sh.shapes)
        else:
            yield "atom", sh


def classify(sh) -> str:
    """原子形状归类。连接线判断用 XML 标签 cxnSp：python-pptx 的
    shape_type 对部分老课件连接线会误报，元素标签最稳（参考 ppt-master
    source_to_md 对私有访问的同样处理）。"""
    if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
        return "pictures"
    if getattr(sh, "has_table", False):
        return "tables"
    if getattr(sh, "has_chart", False):
        return "charts"
    if sh._element.tag.endswith("}cxnSp") or sh.shape_type == MSO_SHAPE_TYPE.LINE:
        return "connectors"
    # SmartArt：graphicFrame 里的 diagram（python-pptx 无 API，嗅探 uri）
    gd = sh._element.find(".//{http://schemas.openxmlformats.org/drawingml/2006/diagram}*" )
    if gd is not None:
        return "smartart"
    if sh.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
        return "autoshapes"
    if "FREEFORM" in str(sh.shape_type):
        return "freeforms"  # 手画线/波浪线常以 freeform 存在（教训#16）
    if sh.shape_type == MSO_SHAPE_TYPE.TEXT_BOX:
        return "textboxes"
    return "others"


def shape_text(sh) -> tuple[str, list]:
    """取文字+强调信息。颜色/加粗是**语义**（原文红字=重要标记），
    这些 XML 里就有，确定性读取，不依赖视觉（教训#13：s3 丢红字）"""
    if not getattr(sh, "has_text_frame", False):
        return "", []
    lines, emph = [], []
    for p in sh.text_frame.paragraphs:
        if p.text:
            lines.append(p.text)
        for r in p.runs:
            if not r.text.strip():
                continue
            color = None
            try:
                if r.font.color is not None and r.font.color.type is not None:
                    if r.font.color.type == 1:   # MSO_COLOR_TYPE.RGB：显式红字等
                        color = str(r.font.color.rgb)
                    elif r.font.color.type == 2:  # MSO_COLOR_TYPE.SCHEME：主题色引用
                        # schemeClr 也可能是强调（如 hlink 恰映射红，教训#17）
                        color = "scheme:" + str(r.font.color.theme_color)
            except Exception:
                color = None
            bold = r.font.bold is True
            # 文字级下划线（u= 属性，含 sng/wavy/dbl）：老师划重点的两种形态之一（教训#16）
            u_attr = None
            rPr = r._r.find("{http://schemas.openxmlformats.org/drawingml/2006/main}rPr")
            if rPr is not None and rPr.get("u"):
                u_attr = rPr.get("u")
            if color or bold or u_attr:
                emph.append({"text": r.text.strip(),
                             "color": f"#{color}" if color and not color.startswith("scheme:") else color,
                             "bold": bold,
                             "underline": u_attr})
    return "\n".join(lines), emph


def table_md(sh) -> str:
    """表格 → markdown（证据性内容保真，不重排——ref/paper-to-deck 的信念）"""
    rows = []
    for row in sh.table.rows:
        rows.append("| " + " | ".join(c.text.strip() for c in row.cells) + " |")
    return "\n".join(rows)


def guess_role(idx, total, title, texts, code_lines, chars_total) -> str:
    """页面角色初判：cover/toc/section/content/code/ending（图形页在外层覆盖为 diagram）"""
    t = (title or "").lower()
    body = "\n".join(texts).lower()
    if any(k in body or k in t for k in ROLE_KEYWORDS["toc"]):
        return "toc"
    if any(k in body or k in t for k in ROLE_KEYWORDS["ending"]):
        return "ending"
    if idx == 1:
        return "cover"
    if code_lines >= CODE_MIN_LINES:
        return "code"
    if chars_total <= 40:  # 大标题+极少正文 → 章节隔页
        return "section"
    if idx == total and chars_total <= 20:
        return "ending"
    return "content"


def extract_page(slide, idx, total) -> tuple[str, dict]:
    counts = dict(autoshapes=0, connectors=0, pictures=0, charts=0,
                  tables=0, textboxes=0, groups=0, smartart=0, freeforms=0, others=0)
    texts: list[str] = []
    tables_md: list[str] = []
    emphasis: list[dict] = []
    line_marks: list[dict] = []  # 手画线（含细长自动形状）：位置即强调位置（教训#16）
    for kind, sh in walk_shapes(slide.shapes):
        if kind == "group":
            counts["groups"] += 1
            continue
        cls = classify(sh)
        counts[cls] += 1
        # 细长形状 = 手画线标记（下划线/波浪线以独立形状存在）：位置供初稿重现
        try:
            w, h = sh.width or 0, sh.height or 0
            if (h <= 127000 and w >= 762000) or (w <= 127000 and h >= 762000):
                # ≤4px 粗且 ≥30px 长（EMU：12700/px）
                line_marks.append({"x": round(sh.left / 12700), "y": round(sh.top / 12700),
                                   "w": round(w / 12700), "h": round(h / 12700),
                                   "kind": cls})
        except Exception:
            pass
        txt, emph = shape_text(sh)
        if txt:
            texts.append(txt)
        emphasis += emph
        if cls == "tables":
            tables_md.append(table_md(sh))

    title = ""
    if slide.shapes.title is not None:
        title = slide.shapes.title.text.strip()

    all_text = "\n".join(texts)
    code_lines = sum(1 for line in all_text.splitlines() if CODE_HINT.search(line))
    chars = len(all_text)
    # 表格文字计入角色判断：表格页正文都在单元格里，不记就会误判成章节隔页
    chars_total = chars + sum(len(t) for t in tables_md)

    # 框线图嫌疑：连接线够多，或图形够密（短标签贴在形状上的形态）
    diagram_like = (counts["connectors"] >= DIAGRAM_MIN_CONNECTORS or
                    counts["autoshapes"] >= DIAGRAM_MIN_AUTOSHAPES)

    role = guess_role(idx, total, title, texts, code_lines, chars_total)
    # 图形页角色覆盖为 diagram：初稿生成时按图形页版式出稿，
    # 而不是被"字少"启发式错派成章节隔页
    if diagram_like and role in ("section", "content"):
        role = "diagram"

    meta = {
        "page": idx,
        "title": title,
        "role_guess": role,
        "diagram_like": diagram_like,
        # 建议裁决：图形页挂重绘（铁律：图绝不允许丢成纯文字）；其余先通过，
        # 最终裁决永远是用户在工作台点的
        "suggest": "redraw" if diagram_like else "pass",
        "counts": {**counts, "text_chars": chars},
        # 原文强调（颜色/加粗/文字级下划线）：初稿按模板强调语汇重现，语义不许丢
        "emphasis": emphasis[:30],
        # 手画线（下划线/波浪线以独立形状存在）：原页坐标位置，初稿按模板强调语汇重现
        "line_marks": line_marks[:20],
        "hidden": slide._element.get("show") == "0",  # python-pptx 不暴露隐藏位，读 XML 属性
    }

    md = [f"# P{idx} {title or '（无标题）'}", ""]
    if texts:
        md += ["## 文字", *[f"- {t}" for t in texts], ""]
    if tables_md:
        md += ["## 表格", *tables_md, ""]
    if emphasis:
        by_color: dict[str, list[str]] = {}
        for e in emphasis:
            key = (e["color"] or "") + ("粗" if e["bold"] else "")
            by_color.setdefault(key or "粗", []).append(e["text"])
        md += ["## 强调（原文如此）",
               *[f"- {k}：{'、'.join(v[:6])}" for k, v in by_color.items()], ""]
    md.append(f"<!-- role={meta['role_guess']} diagram={diagram_like} "
              f"shapes={counts['autoshapes']+counts['connectors']} -->")
    return "\n".join(md), meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    src = task_dir / "sources" / "source.pptx"
    if not src.exists():
        print(f"找不到 {src}（老格式先跑 convert.py）")
        return 2

    prs = Presentation(str(src))
    n = len(prs.slides)
    pages_dir = task_dir / "pages"
    done = all((pages_dir / f"{i:03d}" / f).exists()
               for i in range(1, n + 1) for f in ("text.md", "meta.json"))
    if done and not args.force:
        print(f"已抽取 {n} 页，跳过（--force 重抽）")
        return 0

    metas = []
    for i, slide in enumerate(prs.slides, 1):
        d = pages_dir / f"{i:03d}"
        d.mkdir(parents=True, exist_ok=True)
        md, meta = extract_page(slide, i, n)
        (d / "text.md").write_text(md, encoding="utf-8")
        (d / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        metas.append(meta)
        flag = " [图形页→重绘推荐]" if meta["diagram_like"] else ""
        print(f"  {i:03d}/{n} ✓ {meta['role_guess']}{flag}")

    # 状态推进：让"继续 projects/<名>"知道走到哪了
    pj = task_dir / "project.json"
    data = json.loads(pj.read_text(encoding="utf-8")) if pj.exists() else {}
    data["status"] = "extracted"
    data["pages"] = n
    data["extracted_at"] = datetime.now().isoformat(timespec="seconds")
    pj.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ {n} 页抽取完成（{sum(m['diagram_like'] for m in metas)} 页图形页已标记重绘推荐）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
