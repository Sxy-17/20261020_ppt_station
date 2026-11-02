# -*- coding: utf-8 -*-
"""draft.svg 的唯一写入口（PLAN §8.6）：网页保存和 agent 改稿都走这里

一次写入 = 持页锁 → 版本校验 → 写临时文件 → qc.py 质检 → 留 .bak → 原子替换 → 存版本
  版本校验（乐观并发）：调用方说"我是基于 mtime=X 的稿改的"；盘上已经不是 X 了，
    说明中途有人改过（agent 改完、或用户在网页保存过）→ 拒绝，让调用方先看新稿再决定。
    旧版谁后写谁赢，另一方的修改悄悄丢失。
  先质检再替换：旧版先覆写 draft.svg 再质检、失败再回滚，中间窗口里导出/agent 可能读到坏稿（诊断 #11）。
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime
from pathlib import Path

from locks import file_lock, replace_retry

ROOT = Path(__file__).resolve().parents[1]   # station/ 的上一级 = 工作区根（失误 #20 #23：按文件实际层级算）
QC = ROOT / "station" / "qc.py"
KEEP_VERSIONS = 10


def mtime_of(f: Path) -> int:
    """毫秒级修改时间；与 server.py /pages 的 draft_mtime 同一算法（两处要一致）"""
    return f.stat().st_mtime_ns // 1_000_000 if f.exists() else 0


def write_draft(page_dir: Path, svg_text: str, base_mtime: int | None) -> dict:
    """返回 {"ok": True, "mtime": 新mtime} 或 {"ok": False, "code": HTTP语义码, "error": ..., ...}
    base_mtime：调用方看到的稿的 mtime；稿还不存在时传 None 或 0。
      已有稿却不给 base_mtime → 428（必须先看过当前稿才能改，防止盲写覆盖）"""
    page_dir = Path(page_dir)
    if not page_dir.is_dir():
        return {"ok": False, "code": 404, "error": "页面目录不存在"}
    if not svg_text.lstrip().startswith("<") or len(svg_text.encode("utf-8")) > 2_000_000:
        return {"ok": False, "code": 400, "error": "内容不像 SVG 或超过 2MB"}
    f = page_dir / "draft.svg"

    with file_lock(page_dir / "draft.lock"):
        cur = mtime_of(f)
        if f.exists() and not base_mtime:
            return {"ok": False, "code": 428, "error": "缺少基准版本：先读当前稿的 mtime 再改", "current_mtime": cur}
        if f.exists() and int(base_mtime) != cur:
            return {"ok": False, "code": 409, "error": "稿已被别人改过（基准版本过期）", "current_mtime": cur}

        # 临时文件放在同一目录：稿里的 ../images/ 相对引用在质检时照样成立
        tmp = page_dir / "draft.next.svg"
        tmp.write_text(svg_text, encoding="utf-8")
        r = subprocess.run([sys.executable, str(QC), str(tmp)], capture_output=True,
                           text=True, encoding="utf-8", errors="replace", cwd=str(ROOT))
        if r.returncode != 0:
            tmp.unlink(missing_ok=True)
            errs = [ln.strip()[:200] for ln in r.stdout.splitlines() if "ERROR" in ln or "✗" in ln][:8]
            return {"ok": False, "code": 422, "error": "质检未过，原稿未动", "details": errs}

        if f.exists():
            (page_dir / "draft.svg.bak").write_bytes(f.read_bytes())
        replace_retry(tmp, f)   # 服务器正把稿发给浏览器时 draft.svg 被短暂打开，重试

        # 版本历史：留最近 KEEP_VERSIONS 份，坏编辑随时可找回
        vdir = page_dir / "versions"
        vdir.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]   # 带毫秒：同一秒两次保存不互相覆盖
        (vdir / f"{stamp}.svg").write_text(svg_text, encoding="utf-8")
        for old in sorted(vdir.glob("*.svg"))[:-KEEP_VERSIONS]:
            old.unlink()
        return {"ok": True, "mtime": mtime_of(f)}
