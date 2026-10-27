#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""收件箱盘点（A 路线第一步）：扫描 → 类型路由 → 轻体检 → 同系分组

为什么单独存在：用户会往 inbox/ 乱丢一堆东西，盘点必须毫秒级、可反复跑；
重活（截图/抽文字/逐页诊断）等用户勾选后由准备链（M1.2+）承担，这里只读元数据。

用法：
    .venv/Scripts/python station/prep/inventory.py          # 盘点 inbox/
    .venv/Scripts/python station/prep/inventory.py <目录>   # 盘点任意目录（测试用）

输出：
    projects/inventory.json   机读全量结果（每次重跑覆盖——它是视图不是存档）
    stdout 摘要               人读清单（agent 可直接贴给用户当盘点报告）
"""
from __future__ import annotations

import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# 工作区根 = 本文件上两级；不依赖 CWD（为什么：agent 可能在任意目录调用本脚本）
ROOT = Path(__file__).resolve().parents[2]

# Windows 控制台中文输出保险（git-bash/PowerPoint COM 环境编码不稳定）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# ---------- 类型路由表：扩展名 → 去向 ----------
# 未列出的扩展名走 unknown（登记但不处理）；路由语义与 inbox/README.md 一致
ROUTE_BY_EXT = {
    ".pptx": "renovate", ".ppt": "renovate",            # A 路线翻新候选
    # B 路线素材（M6 起消费；现在只登记）
    ".pdf": "b-source", ".md": "b-source", ".txt": "b-source",
    ".doc": "b-source", ".docx": "b-source",
    ".xls": "b-source", ".xlsx": "b-source",
    ".py": "b-source", ".js": "b-source", ".ts": "b-source", ".ipynb": "b-source",
    # 图片素材
    ".png": "asset", ".jpg": "asset", ".jpeg": "asset", ".gif": "asset",
    ".webp": "asset", ".svg": "asset", ".bmp": "asset",
}

ROUTE_LABEL = {
    "renovate": "翻新候选", "b-source": "B路线素材", "asset": "图片素材",
    "unknown": "未识别",
}


def is_garbage(name: str) -> str | None:
    """返回跳过原因；干净文件返回 None。

    为什么连 README.md 也跳：inbox 的 README 是我们自己写的目录说明，
    不是用户投料——盘点混进它只会制造噪音。
    """
    if name.startswith("~$"):
        return "Office锁文件"
    if name.endswith(".tmp") or name.startswith("."):
        return "临时/隐藏文件"
    if name.lower() == "readme.md":
        return "目录说明文件"
    return None


def strip_ns(tag: str) -> str:
    """去掉 XML 命名空间，取裸标签名（标准库解析 pptx 主题 XML 的常规手法）"""
    return tag.rsplit("}", 1)[-1]


def read_theme(path: Path) -> dict:
    """从 .pptx 包里读主题：主色 accent1 + 标题/正文字体（拉丁 + 中文）。

    为什么直接解 zip 而不用 python-pptx：它不暴露主题色/字体 API，
    而 theme XML 就躺在包里，标准库即可——不为这点信息引第三方依赖。
    主色取 accent1 而非 dk1/lt1：后者几乎总是黑/白，无模板辨识度。
    """
    out: dict = {}
    with zipfile.ZipFile(path) as zf:
        themes = sorted(n for n in zf.namelist() if n.startswith("ppt/theme/theme"))
        if not themes:
            return out
        root = ET.fromstring(zf.read(themes[0]))
    for el in root.iter():
        if strip_ns(el.tag) == "accent1":
            for c in el.iter():
                t = strip_ns(c.tag)
                if t == "srgbClr" and c.get("val"):
                    out["accent1"] = "#" + c.get("val").upper()
                    break
                if t == "sysClr" and c.get("lastClr"):
                    out["accent1"] = "#" + c.get("lastClr").upper()
                    break
            break
    fonts: dict = {}
    for kind in ("major", "minor"):
        for el in root.iter():
            if strip_ns(el.tag) == kind + "Font":
                for c in el:
                    t = strip_ns(c.tag)
                    if t == "latin" and c.get("typeface"):
                        fonts[kind + "_latin"] = c.get("typeface")
                    elif t == "ea" and c.get("typeface"):
                        # 中文字体在 ea 节点——中文课件的关键身份信息
                        fonts[kind + "_ea"] = c.get("typeface")
                break
    if fonts:
        out["fonts"] = fonts
    return out


def light_check_pptx(path: Path) -> dict:
    """轻体检一个 .pptx：页数 + 画幅 + 主题。损坏文件不炸，标记 unreadable。

    .ppt 老格式 python-pptx 读不了 → needs_convert=True，等 M1.2 的
    COM 转换后再复检（诚实：能测多少测多少，测不了的明说）。
    """
    info: dict = {"needs_convert": False}
    try:
        from pptx import Presentation  # 局部导入：盘点纯文本/图片时不白载

        prs = Presentation(str(path))
        ratio = prs.slide_width / prs.slide_height
        # 归一成人类叫法当分组键（存原始 EMU 没人读得懂）
        if abs(ratio - 16 / 9) < 0.02:
            info["ratio"] = "16:9"
        elif abs(ratio - 4 / 3) < 0.02:
            info["ratio"] = "4:3"
        else:
            info["ratio"] = f"{ratio:.2f}"
        info["pages"] = len(prs.slides)
        info.update(read_theme(path))
    except Exception as exc:  # noqa: BLE001 —— 盘点不允许被一个坏文件打断
        info["unreadable"] = str(exc)[:120]
    return info


def scan(root_dir: Path) -> dict:
    """递归扫描目录，产出全量盘点结果（含跳过项与同名冲突）"""
    files, skipped = [], []
    for p in sorted(root_dir.rglob("*")):
        if p.is_dir():
            continue
        rel = p.relative_to(root_dir).as_posix()
        reason = is_garbage(p.name)
        if reason:
            skipped.append({"path": rel, "reason": reason})
            continue
        entry = {
            "path": rel,
            "route": ROUTE_BY_EXT.get(p.suffix.lower(), "unknown"),
            "size": p.stat().st_size,
            "mtime": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="minutes"),
        }
        if p.suffix.lower() == ".pptx":
            entry.update(light_check_pptx(p))
        elif p.suffix.lower() == ".ppt":
            entry["needs_convert"] = True  # 老格式：COM 转换后才能体检
        files.append(entry)

    # 同名冲突检测（不同子目录里同名文件，盘点时提请用户确认，避免拿错）
    seen: dict[str, list[str]] = {}
    for f in files:
        seen.setdefault(Path(f["path"]).name, []).append(f["path"])
    conflicts = [v for v in seen.values() if len(v) > 1]

    # 同系分组：画幅 + 主题主色 都相同 → 大概率同一套模板批量做的（PLAN §2.1）
    groups: dict[str, list[str]] = {}
    for f in files:
        if f["route"] == "renovate" and "ratio" in f and "accent1" in f and not f.get("unreadable"):
            key = f"{f['ratio']}|{f['accent1']}"
            groups.setdefault(key, []).append(f["path"])

    return {
        "scanned_at": datetime.now().isoformat(timespec="seconds"),
        "root": str(root_dir),
        "files": files,
        "series_groups": [{"key": k, "count": len(v), "files": v}
                          for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1]))
                          if len(v) > 1],  # 单成员不成"系"，落回独立件展示（语义修正）
        "skipped": skipped,
        "name_conflicts": conflicts,
    }


def fmt_size(n: int) -> str:
    return f"{n/1048576:.1f}MB" if n >= 1048576 else f"{n/1024:.0f}KB"


def print_summary(inv: dict) -> None:
    """人读摘要：agent 可整段复制给用户当"📦 收件箱盘点"报告"""
    files = inv["files"]
    print(f"📦 收件箱盘点 · {inv['root']} · {len(files)} 项（跳过 {len(inv['skipped'])} 个垃圾/说明文件）")

    renovate = [f for f in files if f["route"] == "renovate"]
    if renovate:
        print(f"[翻新候选] {len(renovate)} 项")
        grouped_paths = {p for g in inv["series_groups"] for p in g["files"]}
        for g in inv["series_groups"]:
            names = "、".join(Path(p).name for p in g["files"][:5])
            more = f" 等{g['count']}个" if g["count"] > 5 else ""
            print(f"  ● 同系组 {g['key']} ×{g['count']}：{names}{more}   ← 同模板系，可一次确认批量进")
        for f in renovate:
            if f["path"] in grouped_paths:
                continue
            if f.get("needs_convert"):
                print(f"  ○ 待转换：{f['path']}（老格式，COM 转换后复检）")
            elif f.get("unreadable"):
                print(f"  ○ 损坏：{f['path']}（{f['unreadable']}）")
            else:
                print(f"  ○ 独立件：{f['path']}（{f.get('ratio')} · {f.get('accent1','?')} · {f.get('pages','?')}页）")

    for route in ("b-source", "asset", "unknown"):
        items = [f for f in files if f["route"] == route]
        if items:
            names = "、".join(f["path"] for f in items[:8])
            more = f" …共{len(items)}个" if len(items) > 8 else ""
            print(f"[{ROUTE_LABEL[route]}] {names}{more}")

    if inv["name_conflicts"]:
        print("⚠ 同名冲突：" + "；".join(" vs ".join(c) for c in inv["name_conflicts"]))
    print(f"→ 机读结果：projects/inventory.json")


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "inbox"
    if not target.is_dir():
        print(f"目录不存在：{target}")
        return 2
    inv = scan(target)
    out = ROOT / "projects" / "inventory.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(inv, ensure_ascii=False, indent=2), encoding="utf-8")
    print_summary(inv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
