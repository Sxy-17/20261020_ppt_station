# -*- coding: utf-8 -*-
"""跨进程文件锁（PLAN §8.6）

为什么需要：写 draft.svg 和意见队列的有两类进程——工作台服务器（网页）和 agent 跑的
命令行脚本（write_draft.py / wait_requests.py）。线程锁管不到别的进程，所以用
"独占创建锁文件"：os.open(O_CREAT|O_EXCL) 在 Windows 和 POSIX 上都是原子的，
谁先建成谁拿到锁，用完删掉。

进程崩溃会留下锁文件：超过 STALE 秒的锁视为残留，直接接管（正常持锁只有几秒——
质检最慢也就几秒，所以 30 秒足够判死）。
"""
from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path

STALE = 30.0      # 锁文件超过这么久没释放 = 持有者已死
WAIT = 15.0       # 最多等这么久；等不到就抛错，让调用方报"忙"而不是卡死


class LockBusy(RuntimeError):
    pass


@contextmanager
def file_lock(lock_path: Path, wait: float = WAIT):
    lock_path = Path(lock_path)
    deadline = time.time() + wait
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()}".encode())
            os.close(fd)
            break
        except (FileExistsError, PermissionError):
            # PermissionError：Windows 上锁文件正处于"删除中"或被杀毒/索引短暂打开时，
            # 独占创建报的是拒绝访问而不是已存在——同样当作"别人持锁"，等一下再试
            try:
                if time.time() - lock_path.stat().st_mtime > STALE:
                    lock_path.unlink(missing_ok=True)   # 残留锁：接管
                    continue
            except (FileNotFoundError, PermissionError):
                pass                                    # 刚好被释放/正在删除：走下面的等待重试
            if time.time() > deadline:
                raise LockBusy(f"等锁超时：{lock_path.name}")
            time.sleep(0.05)
    try:
        yield
    finally:
        for _ in range(40):                              # 删锁也可能被短暂占用：重试，别留下假锁
            try:
                lock_path.unlink(missing_ok=True)
                break
            except PermissionError:
                time.sleep(0.05)


def replace_retry(src: Path, dst: Path, tries: int = 40) -> None:
    """原子替换 dst；Windows 上 dst 被别的进程短暂打开（读稿、杀毒扫描）时会拒绝访问，重试约 2 秒"""
    for k in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if k == tries - 1:
                raise
            time.sleep(0.05)
