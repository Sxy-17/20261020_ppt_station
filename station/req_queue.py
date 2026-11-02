# -*- coding: utf-8 -*-
"""意见队列 pending_requests.jsonl 的唯一读写入口（PLAN §8.6）

网页（server.py）和 agent（wait_requests.py）都只通过这里改队列，且全程持锁：
旧版"网页追加"与"agent 整文件重写改状态"之间没有锁，同一时刻会丢掉刚追加的意见（诊断）。

每条记录：
  id      唯一编号（新增）。旧版只有秒级 ts，同一秒两条意见 ts 相同，按 ts 改状态会误伤另一条
  ts      提交时间
  page    页号
  type    opinion=意见框/聊天的大白话；redraw=用户按了「3 重绘」
  text    意见原话（redraw 可为空）
  status  queued 排队 → working agent 已领走 → done 改完；cancelled 用户撤销了重绘
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

from locks import file_lock, replace_retry

REQ_FILE = "pending_requests.jsonl"
LOCK_FILE = "pending_requests.lock"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _read(task: Path) -> list[dict]:
    f = task / REQ_FILE
    if not f.exists():
        return []
    out = []
    for ln in f.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(ln)
        except Exception:  # noqa: BLE001 —— 坏行跳过，不让一行坏数据拖垮整个队列
            continue
        r.setdefault("id", r.get("ts", ""))      # 旧记录没有 id：用 ts 顶上（旧数据只读兼容）
        r.setdefault("type", "opinion")
        out.append(r)
    return out


def _write(task: Path, reqs: list[dict]) -> None:
    # 先写临时文件再替换：写到一半崩了也不会留下半截队列
    tmp = task / (REQ_FILE + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in reqs), encoding="utf-8")
    replace_retry(tmp, task / REQ_FILE)   # 被短暂占用时重试；旧写法直接抛错 → 500 → 这条意见丢失


def read_all(task: Path) -> list[dict]:
    with file_lock(task / LOCK_FILE):
        return _read(task)


def add(task: Path, page: int, text: str, type_: str = "opinion") -> dict:
    req = {"id": uuid.uuid4().hex[:12], "ts": _now(), "page": page, "type": type_,
           "text": text[:500], "status": "queued"}
    with file_lock(task / LOCK_FILE):
        reqs = _read(task)
        reqs.append(req)
        _write(task, reqs)
    return req


def set_status(task: Path, ids: list[str], status: str) -> int:
    """按 id 改状态；返回改了几条"""
    hit = 0
    with file_lock(task / LOCK_FILE):
        reqs = _read(task)
        for r in reqs:
            if r["id"] in ids:
                r["status"] = status
                r[f"{status}_ts"] = _now()
                hit += 1
        if hit:
            _write(task, reqs)
    return hit


def cancel_redraw(task: Path, page: int) -> int:
    """用户撤销了某页的「重绘」：把该页还没被 agent 领走的 redraw 项作废"""
    with file_lock(task / LOCK_FILE):
        reqs = _read(task)
        hit = 0
        for r in reqs:
            if r["page"] == page and r["type"] == "redraw" and r["status"] == "queued":
                r["status"] = "cancelled"
                r["cancelled_ts"] = _now()
                hit += 1
        if hit:
            _write(task, reqs)
    return hit


def claim_next_page(task: Path, reclaim_after: float = 1800) -> dict | None:
    """agent 领活：取最早排队那条所在的页，把这一页所有排队项一起领走（标 working）。
    同页多条意见一次看全，免得改完一条又回来改同一页。
    working 超过 reclaim_after 秒没完成的视为上一个 agent 中途退出，重新放回可领。"""
    with file_lock(task / LOCK_FILE):
        reqs = _read(task)
        now = datetime.now()
        for r in reqs:
            if r["status"] == "working":
                try:
                    if (now - datetime.fromisoformat(r.get("working_ts", ""))).total_seconds() > reclaim_after:
                        r["status"] = "queued"
                except ValueError:
                    r["status"] = "queued"
        queued = [r for r in reqs if r["status"] == "queued"]
        if not queued:
            return None
        page = queued[0]["page"]
        items = [r for r in queued if r["page"] == page]
        for r in items:
            r["status"] = "working"
            r["working_ts"] = _now()
        _write(task, reqs)
    return {"page": page, "items": items}
