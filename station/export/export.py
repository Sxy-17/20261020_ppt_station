#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""导出薄封装：pages/*/draft.svg → ppt-master 质检+编译 → exports/*.pptx

为什么不直接调 svg_to_pptx：它吃自己的项目形态（svg_output/ 目录），
我们的页面在 pages/NNN/draft.svg——本脚本做"staging 搬运 + 调引擎 + 收货"，
引擎一字不改（薄封装原则，见 PLAN 决策 A/E）。

流程：draft.svg → .export/svg_output/NNN_角色.svg
      → svg_quality_checker（锁less final，必须过）
      → svg_to_pptx --quick-generate --no-notes
      → exports/<任务>_draft_<时间戳>.pptx

用法：
    .venv/Scripts/python station/export/export.py <task_dir> [--pages 1,2,40] [--keep-stage]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PM = ROOT / "ppt-master" / "skills" / "ppt-master"  # 引擎只读，绝对路径调用
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")



def ensure_engine() -> str:
    """引擎存在性守卫：submodule 未拉取时给修复命令，而不是裸异常（浅克隆场景）"""
    probe = PM / "scripts" / "svg_to_pptx.py"
    if not probe.exists():
        print("✗ ppt-master 引擎未拉取（submodule 为空）。修复：")
        print("    git submodule update --init --depth 1 ppt-master")
        sys.exit(3)
    return str(PM)


def run_engine(script: str, args: list[str]) -> subprocess.CompletedProcess:
    """调引擎脚本：统一 .venv python + 绝对路径；失败时把尾部输出给用户看"""
    cmd = [str(sys.executable), str(PM / "scripts" / script)] + [str(a) for a in args]
    proc = subprocess.run(cmd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", cwd=str(ROOT))
    if proc.returncode != 0:
        tail = (proc.stdout + proc.stderr).strip().splitlines()[-15:]
        print(f"引擎 {script} 失败（exit {proc.returncode}）：")
        print("\n".join(tail))
    return proc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--pages", help="只导出指定页，如 1,2,40（默认全部有 draft.svg 的页）")
    ap.add_argument("--keep-stage", action="store_true", help="保留 .export 供调试（默认成功后清掉）")
    args = ap.parse_args()

    task_dir = Path(args.task_dir)
    pages_dir = task_dir / "pages"
    drafts = sorted(p for p in pages_dir.glob("*/draft.svg"))
    if args.pages:
        want = {int(x) for x in args.pages.split(",") if x.strip()}
        drafts = [p for p in drafts if int(p.parent.name) in want]
    if not drafts:
        print(f"没有可导出的 draft.svg（{task_dir}）")
        return 2

    # staging：引擎期望的项目形态。重建前先点名确认是自己的工作区（R2）
    ensure_engine()
    stage = task_dir / ".export"
    if stage.exists():
        shutil.rmtree(stage)  # .export 是导出器私有暂存，整目录重建安全
    (stage / "svg_output").mkdir(parents=True)

    for d in drafts:
        n = int(d.parent.name)
        role = ""
        meta_file = d.parent / "meta.json"
        if meta_file.exists():
            role = json.loads(meta_file.read_text(encoding="utf-8")).get("role_guess", "")
        # 引擎要求零填充一致命名；角色后缀只是可读性
        dst = stage / "svg_output" / f"{n:03d}_{role or 'page'}.svg"
        shutil.copyfile(d, dst)
        print(f"  staged {dst.name}")

    # 图片资源搬运：draft 里 href="../images/..." 约定：
    #   pNNN_original.png → pages/NNN/original.png（保留原样贴整页）
    #   NNN_figure_K.ext  → pages/NNN/figure_K.ext（提取出的原插图，干净贴图）
    #   其他名字找 task/images/
    import re as _re
    refs = set()
    for svg in (stage / "svg_output").glob("*.svg"):
        refs |= set(_re.findall(r'href="\.\./images/([^"]+)"', svg.read_text(encoding="utf-8")))
    for name in sorted(refs):
        m = _re.fullmatch(r"p(\d+)_original\.(png|jpg)", name)
        src_img = (pages_dir / f"{int(m.group(1)):03d}" / f"original.{m.group(2)}") if m else None
        m2 = _re.fullmatch(r"(\d+)_figure_(\d+)\.(png|jpg|jpeg|gif)", name)
        if m2:
            src_img = pages_dir / f"{int(m2.group(1)):03d}" / f"figure_{m2.group(2)}.{m2.group(3)}"
        if src_img is None or not src_img.exists():
            src_img = task_dir / "images" / name  # 兼容以后任务自带素材图
        if src_img.exists():
            (stage / "images").mkdir(exist_ok=True)
            shutil.copyfile(src_img, stage / "images" / name)
            print(f"  staged 图片 {name}")
        else:
            print(f"⚠ 图片缺引用源：{name}（导出可能失败）")

    # 动效侧车（M5.1）：任务级 animations.json 用页号寻址，引擎要 SVG 文件名词干——
    # 这里做薄转换（引擎零改动，符合薄封装原则）
    anim_src = task_dir / "animations.json"
    if anim_src.exists():
        try:
            src = json.loads(anim_src.read_text(encoding="utf-8"))
            staged_names = {int(p.stem.split("_")[0]): p.stem for p in (stage / "svg_output").glob("*.svg")}
            out = {"version": 1, "slides": {}}
            for page_no, entries in src.get("pages", {}).items():
                stem = staged_names.get(int(page_no))
                if not stem:
                    continue
                groups = {}
                for e in entries:
                    groups.setdefault(e["group"], {"effects": []})["effects"].append(
                        {k: v for k, v in e.items() if k != "group"})
                out["slides"][stem] = {"groups": groups}
            (stage / "animations.json").write_text(
                json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  staged 动效 animations.json（{len(out['slides'])} 页）")
        except Exception as exc:  # noqa: BLE001 —— 坏动效不阻断静态导出
            print(f"⚠ 动效侧车解析失败（忽略，按无动效导出）：{exc}")

    print("▶ 质检 svg_quality_checker …")
    chk = run_engine("svg_quality_checker.py",
                     [stage, "--quick-generate", "--canonical-authoring",
                      "--stage", "final", "--json"])
    if chk.returncode != 0:
        return 3  # 质检不过就停——绝不带病导出（先修 SVG）

    print("▶ 编译 svg_to_pptx …")
    exp = run_engine("svg_to_pptx.py", [stage, "--quick-generate", "--no-notes"])
    if exp.returncode != 0:
        return 4

    produced = sorted((stage / "exports").glob("*.pptx")) if (stage / "exports").exists() else []
    if not produced:
        print("引擎报告成功但没有产物，检查 .export/exports/")
        return 5

    out_dir = task_dir / "exports"
    out_dir.mkdir(exist_ok=True)
    final = out_dir / f"{task_dir.name}_draft_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pptx"
    shutil.move(str(produced[-1]), final)
    if not args.keep_stage:
        shutil.rmtree(stage)

    print(f"✓ 导出完成：{final}（{len(drafts)} 页）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
