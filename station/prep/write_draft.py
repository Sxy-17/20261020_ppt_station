#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""agent 改稿的唯一写入口（PLAN §8.6）：与网页保存走同一套逻辑（station/draft_store.py）

agent 不许直接写 pages/NNN/draft.svg——用户可能正在网页里改同一页，直接写会覆盖用户的修改。

用法（两步，先看再写）：
    # ① 改之前：记下当前稿的版本号
    .venv/Scripts/python station/prep/write_draft.py <task_dir> <页号> --mtime
    # ② 改好后（新稿先写在 tmp/ 下任意位置）：带着版本号提交
    .venv/Scripts/python station/prep/write_draft.py <task_dir> <页号> <新稿.svg> --base-mtime <①的输出>

退出码：0=已写入（打印新版本号）；3=稿已被别人改过→重新执行①、读新稿、再改；
        4=质检未过（原稿未动，按输出修）；2=参数/路径错误
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # station/：导入 draft_store / locks
from draft_store import mtime_of, write_draft  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("page", type=int)
    ap.add_argument("svg", nargs="?", help="新稿文件")
    ap.add_argument("--mtime", action="store_true", help="只打印当前稿的版本号")
    ap.add_argument("--base-mtime", type=int, help="①拿到的版本号；新页（还没稿）可省略")
    args = ap.parse_args()

    page_dir = Path(args.task_dir) / "pages" / f"{args.page:03d}"
    if not page_dir.is_dir():
        print(f"✗ 没有这一页：{page_dir}")
        return 2
    if args.mtime:
        print(mtime_of(page_dir / "draft.svg"))
        return 0
    if not args.svg or not Path(args.svg).exists():
        print("✗ 缺少新稿文件")
        return 2

    res = write_draft(page_dir, Path(args.svg).read_text(encoding="utf-8"), args.base_mtime)
    if res["ok"]:
        print(f"✓ P{args.page} 已写入，新版本号 {res['mtime']}")
        return 0
    print(f"✗ P{args.page} {res['error']}")
    for d in res.get("details", []):
        print("  ", d)
    if res["code"] in (409, 428):
        print(f"  当前版本号 {res.get('current_mtime')}：重新读稿、在新稿基础上改，再带这个版本号提交")
        return 3
    if res["code"] == 422:
        return 4
    print(json.dumps(res, ensure_ascii=False))
    return 2


if __name__ == "__main__":
    sys.exit(main())
