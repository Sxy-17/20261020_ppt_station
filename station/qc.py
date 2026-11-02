#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""单页快速质检：生成循环的 fail-fast 步骤

为什么存在：引擎 svg_quality_checker 本来就有全部画图约束（root 组 bounds
重叠 1px 容差、文字溢出 5% 阈值、viewBox 越界、XML 转义、marker 契约）——
但等到导出时才跑，错误积累成批、返工慢。本包装让 agent 在**每写完一页
draft.svg 时立即秒级预检**，过了才写下一页（fail-fast，错误就地修）。

用法：
    .venv/Scripts/python station/qc.py <draft.svg> [更多文件...]
输出：仅 blocking 错误（一行一条）；退出码 0=全过 / 1=有错。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # station/ 的上一级=工作区根（qc.py在station/根, 比prep/浅一级, 失误#23）
CHECKER = ROOT / "ppt-master/skills/ppt-master/scripts/svg_quality_checker.py"
PM = ROOT / "ppt-master"

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


def check_one(svg: Path) -> list[str]:
    """返回该文件的 blocking 错误行（空列表=过）。
    图片引用缺失不报：draft 的 ../images/ 引用在导出 staging 时才拷贝成立
    （export.py 负责），生成循环预检阶段属预期缺失，不属画图错误。"""
    if not CHECKER.exists():
        print("✗ ppt-master 引擎未拉取（submodule 为空）。修复：")
        print("    git submodule update --init --depth 1 ppt-master")
        return ["引擎未安装"]
    proc = subprocess.run(
        [str(sys.executable), str(CHECKER), str(svg), "--stage", "final"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    errors = []
    for ln in (proc.stdout + proc.stderr).splitlines():
        t = ln.strip()
        if not t.startswith("[ERROR]"):
            continue
        if "External image not found" in t:
            continue  # 图片由 export staging 兑现，预检阶段跳过
        if "With errors" in t or t.endswith("(100%)"):
            continue  # 汇总行，非具体错误
        if " - Failed" in t:
            continue  # 文件级标题行（具体错误在后续行）；全滤空时由 returncode 兑底
        errors.append(t)
    if proc.returncode != 0 and not errors:
        # 过滤后无具体错误：剩余失败均为已声明可忽略类（如图片引用待 staging）
        raw = (proc.stdout + proc.stderr)
        if "External image not found" in raw:
            print("  （仅图片引用待 staging，预检视为通过）")
            return 0
        errors.append(f"{svg.name}: 质检失败（exit {proc.returncode}），重跑引擎查看完整输出")
    return errors


def main() -> int:
    files = [Path(a) for a in sys.argv[1:]]
    if not files:
        print("用法：qc.py <draft.svg> [更多...]")
        return 2
    all_errors = []
    for f in files:
        if not f.exists():
            print(f"✗ 文件不存在：{f}")
            all_errors.append(str(f))
            continue
        errs = check_one(f)
        if errs:
            print(f"✗ {f.name}")
            all_errors += errs
        else:
            print(f"✓ {f.name}")
    if all_errors:
        print(f"\n共 {len(all_errors)} 条 blocking——就地修复后再写下一页（fail-fast）")
        for e in all_errors:
            print(" ", e[:150])
        return 1
    print("\n全部通过 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
