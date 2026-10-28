#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""模板资产化 v1（M7，风格层）：从用户模板 .pptx 提取主题 → 审美库 template 篇

为什么先做风格层：完整结构层（母版/版式/占位符→structured SVG）依赖引擎
create-template 交互路线，工程量大；风格层（色板/字体/画幅/版式清单）今天
就能让"选择页出现我的模板卡片、新稿用我的配色"——80 分先行。

用法：
    .venv/Scripts/python station/prep/import_template.py <模板.pptx> [--name 中文名] [--out 目录]
默认 --out library/aesthetics（真入库）；测试用 --out tmp/。
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "prep"))
from inventory import read_theme  # 复用主题读取（第三次用例，仍是同一函数最划算）

ROOT = Path(__file__).resolve().parents[2]
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def full_scheme(path: Path) -> dict:
    """读全 clrScheme（不止 accent1）——read_theme 只回 accent1，这里补齐六色映射"""
    out = {}
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(path) as zf:
        themes = sorted(n for n in zf.namelist() if n.startswith("ppt/theme/theme"))
        if not themes:
            return out
        root = ET.fromstring(zf.read(themes[0]))
    strip = lambda t: t.rsplit("}", 1)[-1]
    cur = None
    for el in root.iter():
        t = strip(el.tag)
        if t in ("dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
                 "accent4", "accent5", "accent6"):
            cur = t
            for c in el.iter():
                ct = strip(c.tag)
                if ct == "srgbClr" and c.get("val"):
                    out[cur] = "#" + c.get("val").upper()
                elif ct == "sysClr" and c.get("lastClr"):
                    out[cur] = "#" + c.get("lastClr").upper()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pptx")
    ap.add_argument("--name", help="模板中文名（选择页卡片显示）")
    ap.add_argument("--out", default=str(ROOT / "library" / "aesthetics"))
    args = ap.parse_args()

    src = Path(args.pptx)
    if not src.exists():
        print(f"找不到 {src}")
        return 2

    from pptx import Presentation
    prs = Presentation(str(src))
    ratio = prs.slide_width / prs.slide_height
    ratio_name = ("16:9" if abs(ratio - 16 / 9) < 0.02 else
                  "4:3" if abs(ratio - 4 / 3) < 0.02 else f"{ratio:.2f}")
    scheme = full_scheme(src)
    theme = read_theme(src)
    fonts = theme.get("fonts", {})
    layouts = [l.name for l in prs.slide_layouts][:12]

    # 六角色映射（启发式 v1：accent1=primary, accent2=强调，dk/lt 承担底与字）
    palette = {
        "background": scheme.get("lt1", "#FFFFFF"),
        "secondary_bg": scheme.get("lt2", "#F5F5F5"),
        "primary": scheme.get("accent1", "#1F4E79"),
        "accent": scheme.get("accent2", scheme.get("accent1", "#C25E00")),
        "secondary_accent": scheme.get("accent3", scheme.get("accent2", "#5B7DA3")),
        "body_text": scheme.get("dk1", "#1D2430"),
    }
    zh_name = args.name or src.stem
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", zh_name).strip("_") or f"tpl_{date.today():%y%m%d}"
    fid = f"template-{slug}"

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    fm_lines = [f"id: {fid}", "type: template", f"name: {zh_name}",
                "category: 我的模板"]
    fm_lines += [f"palette.{k}: {v}" for k, v in palette.items()]
    if fonts:
        fm_lines.append(f"fonts.heading: {fonts.get('major_ea') or fonts.get('major_latin', '')}")
        fm_lines.append(f"fonts.body: {fonts.get('minor_ea') or fonts.get('minor_latin', '')}")
    fm_lines += ["applies: 由用户模板导入（风格层）；结构层复用见正文",
                 f"source: 模板导入 v1（{src.name}）",
                 f"created: {date.today().isoformat()}",
                 "tags: [导入模板]", "supersedes: \"\""]

    body = f"""# {zh_name}（模板导入 v1）

> 自动提取自 `{src.name}`——**色板/字体已可用**（选择页卡片、新稿生成即生效）；
> 纪律正文待人工补写（下方清单），补完才算完整审美篇。

## 提取信息

- 画幅：{ratio_name}，页数 {len(prs.slides)}
- 版式（{len(layouts)} 个）：{"、".join(layouts)}
- 主题全色：{scheme}

## 待人工补写（补完删除本节）

- [ ] 版式纪律（哪些版式对应我们哪些页面角色）
- [ ] 强调色使用边界（accent 每页几处）
- [ ] 图形配方倾向（框线图按哪篇 diagram-recipe 走）
"""
    (out / f"{fid}.md").write_text(
        "---\n" + "\n".join(fm_lines) + "\n---\n" + body, encoding="utf-8")
    print(f"✓ 已生成 {out / (fid + '.md')}（选择页自动出现）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
