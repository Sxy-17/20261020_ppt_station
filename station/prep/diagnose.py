#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""诊断：聚合每页 meta + 主题 + 实际用色用字采样 → diagnosis.json + 📋 人读报告

这是确认包"📋 诊断区"的数据源；处方（agent 写）在它之上。
机器可测的都在这：画幅/主题色字体/实际用色用字/图形页清单/拥挤空页信号。
风格统一性、图片美感这类"微妙判断"留给 agent 看截图定性（PLAN §2.2 分工）。

用法：
    .venv/Scripts/python station/prep/diagnose.py <task_dir>
前置：extract.py 已跑（每页 meta.json 齐全）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inventory import read_theme  # 同目录复用——第二次用例出现，按规矩开始收敛

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ---------- 启发式常量（人读报告直接引用，改这里别改调用处） ----------
CROWDED_CHARS = 300   # 16:9 页正文超过约300字判拥挤（约满页纯文字的量）
EMPTY_CHARS = 10      # 低于此且无任何视觉元素 → 空页

SLIDE_XML = re.compile(r"ppt/slides/slide(\d+)\.xml")


def sample_actual(pptx_path: Path) -> tuple[dict, dict]:
    """扫全部 slide XML，统计实际用色(srgbClr)与实际用字(typeface)。

    为什么用正则不用 ElementTree：只是计数属性值，ET 的命名空间噪音
    反而碍事；粗扫对计数场景足够稳。
    """
    colors: dict[str, int] = {}
    fonts: dict[str, int] = {}
    with zipfile.ZipFile(pptx_path) as zf:
        for name in sorted((n for n in zf.namelist() if SLIDE_XML.fullmatch(n)),
                           key=lambda n: int(SLIDE_XML.match(n).group(1))):
            xml = zf.read(name).decode("utf-8", "ignore")
            for val in re.findall(r'srgbClr val="([0-9A-Fa-f]{6})"', xml):
                colors["#" + val.upper()] = colors.get("#" + val.upper(), 0) + 1
            for tf in re.findall(r'typeface="([^"]+)"', xml):
                # "+mn-lt" 这类是主题引用不是真字体名，滤掉
                if not tf.startswith("+"):
                    fonts[tf] = fonts.get(tf, 0) + 1
    return colors, fonts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    src = task_dir / "sources" / "source.pptx"
    if not src.exists():
        print(f"找不到 {src}")
        return 2

    metas = sorted(task_dir.glob("pages/*/meta.json"))
    from pptx import Presentation
    prs = Presentation(str(src))
    n = len(prs.slides)
    if len(metas) != n:
        print(f"meta 不齐（{len(metas)}/{n}），先跑 extract.py")
        return 2
    metas = [json.loads(p.read_text(encoding="utf-8")) for p in metas]

    w, h = prs.slide_width, prs.slide_height
    ratio = w / h
    ratio_name = ("16:9" if abs(ratio - 16 / 9) < 0.02 else
                  "4:3" if abs(ratio - 4 / 3) < 0.02 else f"{ratio:.2f}")

    colors, fonts = sample_actual(src)
    total_color_refs = sum(colors.values()) or 1
    top_colors = sorted(colors.items(), key=lambda kv: -kv[1])[:5]
    # 主色口径：实际用色有压倒性多数(>30%)用实际色，否则退回主题 accent1
    # （老课件常见：主题是蓝的，正文全刷成绿的——诊断必须报实况）
    dominant = top_colors[0] if top_colors and top_colors[0][1] / total_color_refs > 0.30 else None
    theme = read_theme(src)
    primary = dominant[0] if dominant else theme.get("accent1", "?")

    diagram_pages = [m["page"] for m in metas if m["diagram_like"]]
    crowded = [{"page": m["page"], "text_chars": m["counts"]["text_chars"]}
               for m in metas if m["counts"]["text_chars"] > CROWDED_CHARS]
    # 空页只盯 content/code/diagram：封面/隔页/致谢字少是天性，不是病
    empty = [m["page"] for m in metas
             if m["role_guess"] in ("content", "code", "diagram")
             and m["counts"]["text_chars"] <= EMPTY_CHARS
             and sum(m["counts"][k] for k in
                     ("autoshapes", "connectors", "pictures", "tables", "charts")) == 0]
    hidden = [m["page"] for m in metas if m["hidden"]]
    by_role: dict[str, int] = {}
    for m in metas:
        by_role[m["role_guess"]] = by_role.get(m["role_guess"], 0) + 1

    diag = {
        "task": task_dir.name,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "deck": {"ratio": ratio_name, "pages": n,
                 "slide_w_emu": w, "slide_h_emu": h},
        "theme": theme,
        "primary_color": primary,
        "primary_color_source": "actual" if dominant else "theme",
        "actual_colors": [{"hex": k, "count": v,
                           "pct": round(v / total_color_refs, 2)} for k, v in top_colors],
        "actual_fonts": [{"name": k, "count": v}
                         for k, v in sorted(fonts.items(), key=lambda kv: -kv[1])[:5]],
        "diagram_pages": diagram_pages,
        "crowded_pages": crowded,
        "empty_pages": empty,
        "hidden_pages": hidden,
        "role_counts": by_role,
    }
    (task_dir / "diagnosis.json").write_text(
        json.dumps(diag, ensure_ascii=False, indent=2), encoding="utf-8")

    # 状态推进：M1 准备链至此完整（盘点→收编→转换→截图→抽取→诊断）
    pj = task_dir / "project.json"
    data = json.loads(pj.read_text(encoding="utf-8")) if pj.exists() else {}
    data["status"] = "diagnosed"
    data["diagnosed_at"] = diag["generated_at"]
    pj.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # 📋 人读报告（确认包诊断区直接用；agent 看完截图再补定性结论）
    fonts_str = "、".join(f"{f['name']}×{f['count']}" for f in diag["actual_fonts"][:3])
    mixed = "（混排）" if len(diag["actual_fonts"]) > 1 else ""
    role_str = " · ".join(f"{k}页×{v}" for k, v in sorted(by_role.items()))
    print(f"📋 诊断 · {task_dir.name} · {n} 页")
    print(f"   画幅 {ratio_name} · 主色 {primary}"
          f"（来源{diag['primary_color_source']}）")
    print(f"   实际用色 Top: " + " ".join(f"{c['hex']}×{int(c['pct']*100)}%" for c in diag["actual_colors"][:3]))
    print(f"   字体实际: {fonts_str}{mixed}")
    print(f"   图形页 {len(diagram_pages)}（{diagram_pages[:8]}）· 拥挤页 {len(crowded)}（> {CROWDED_CHARS}字）· "
          f"空页 {len(empty)} · 隐藏 {len(hidden)}")
    print(f"   角色分布: {role_str}")
    print(f"→ 机读结果 projects/{task_dir.name}/diagnosis.json（处方在此基础上写）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
