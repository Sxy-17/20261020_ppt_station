#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""值守模式：agent 阻塞等待用户在网页提的意见 / 按的「3 重绘」（PLAN §8.6）

为什么需要：agent 活在聊天里、按轮次工作，网页写进队列的意见它收不到通知——
原来要等用户回聊天说"继续"才会去读。值守 = agent 自己在一轮里循环：
    等活 → 改稿（write_draft.py）→ 标完成 → 再等，直到超时没有新活。

用法：
    # 等下一页的活（同页多条一次领走），领到即打印 JSON 并退出 0；超时退出 2
    .venv/Scripts/python station/prep/wait_requests.py <task_dir> [--timeout 600]
    # 改完：标完成（网页 3 秒内出横幅）
    .venv/Scripts/python station/prep/wait_requests.py <task_dir> --done <id> [<id> ...]
    # 放弃（比如需要视觉但本会话没有）：放回队列
    .venv/Scripts/python station/prep/wait_requests.py <task_dir> --release <id> [<id> ...]

领到的 JSON：{"page", "items":[{id,type,text,...}], "original", "draft", "draft_mtime"}
  type=redraw 且 text 为空 = 用户只按了重绘没写要求：照原图拓扑重画（R15：必须有视觉）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # station/：导入 req_queue / draft_store
import req_queue  # noqa: E402
from draft_store import mtime_of  # noqa: E402
from locks import replace_retry  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


HEARTBEAT = "agent_watch.json"


def heartbeat(task: Path) -> None:
    """值守心跳：每查一次队列写一次时间。工作台据此显示「agent 值守中 / 未值守」——
    否则用户按了重绘，界面写"已交给 agent"，其实根本没人在处理（用户实测困惑）"""
    tmp = task / (HEARTBEAT + ".tmp")
    tmp.write_text(json.dumps({"pid": os.getpid(), "last_seen": time.time()}), encoding="utf-8")
    replace_retry(tmp, task / HEARTBEAT)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task_dir")
    ap.add_argument("--timeout", type=float, default=600, help="没有新活就等这么多秒后退出（默认 10 分钟）")
    ap.add_argument("--interval", type=float, default=2, help="查队列间隔秒数")
    ap.add_argument("--done", nargs="+", metavar="ID", help="把这些项标为完成")
    ap.add_argument("--release", nargs="+", metavar="ID", help="把这些项放回队列")
    args = ap.parse_args()

    task = Path(args.task_dir)
    if not (task / "pages").is_dir():
        print(f"✗ 不是任务目录：{task}")
        return 2

    if args.done or args.release:
        ids, status = (args.done, "done") if args.done else (args.release, "queued")
        n = req_queue.set_status(task, ids, status)
        print(f"✓ {n} 条标为 {status}" if n else "✗ 没找到这些 id")
        return 0 if n else 2

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        heartbeat(task)
        job = req_queue.claim_next_page(task)
        if job:
            pdir = task / "pages" / f"{job['page']:03d}"
            job["original"] = str(pdir / "original.png")
            job["draft"] = str(pdir / "draft.svg")
            job["draft_mtime"] = mtime_of(pdir / "draft.svg")   # 改稿时作为 --base-mtime 交给 write_draft.py
            print(json.dumps(job, ensure_ascii=False, indent=2))
            return 0
        time.sleep(args.interval)
    print(f"（{args.timeout:.0f} 秒内没有新意见，值守结束）")
    return 2


if __name__ == "__main__":
    sys.exit(main())
