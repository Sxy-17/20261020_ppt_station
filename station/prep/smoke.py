#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""工作台冒烟门（PLAN §8.7 R0，规范 R22）

为什么存在：编辑器 edit.js 曾因语法错误连续 7 个 commit 没加载过（失误 #25），
commit 前从没人在浏览器里跑过。本脚本把"在浏览器里跑过"变成一条命令：

  1. node --check  station/static/*.js       语法错误整文件被浏览器丢弃，必须先拦
  2. 临时起 station/server.py（空闲端口）     不碰用户开着的 7610
  3. Edge 无头截图 → tmp/smoke/              独立 profile，不抢用户 Edge 的锁
  4. 右栏判定：中心区域亮度标准差              空白/占位字≈纯色；有稿=变化大（与稿件底色无关）

用法：
    .venv/Scripts/python station/prep/smoke.py [--task 任务名]
退出码：0=全过；1=JS 语法错；2=服务起不来；3=截图失败；4=右栏无稿
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # station/prep/ 往上两级=工作区根（失误 #20：按文件实际层级算）
STATIC = ROOT / "station" / "static"
OUT = ROOT / "tmp" / "smoke"   # 测试产物只进 tmp/（R1）

# Edge 常见安装位置（本机实测在 x86 目录；两处都找）
EDGE_PATHS = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]
WINDOW = (1680, 980)
# 右栏判定区域（占截图的比例）：避开顶栏/底栏和右栏边框，只看画布中心
RIGHT_BOX = (0.56, 0.20, 0.94, 0.75)   # left, top, right, bottom
STD_THRESHOLD = 12.0   # 亮度标准差阈值：空栏实测 <5，有稿实测 >30（初值，可按实测调整，R12）

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


# 只查在用页面真正加载的脚本。旧工作台（index.html 及其 edit.js 等）正被 PLAN §8 取代，
# R9 清理时删除；在那之前不让它的已知坏文件挡住新工作台的验收。
LIVE_PAGES = ["workbench.html", "select.html", "outline.html"]


def live_scripts() -> list[Path]:
    import re
    names = set()
    for html in LIVE_PAGES:
        names |= set(re.findall(r'<script src="/static/([^"]+\.js)"', (STATIC / html).read_text(encoding="utf-8")))
    return [STATIC / n for n in sorted(names)]


def check_js() -> list[str]:
    """逐个 node --check；返回出错文件的首行错误信息"""
    errors = []
    for js in live_scripts():
        r = subprocess.run(["node", "--check", str(js)], capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        if r.returncode == 0:
            print(f"  ✓ {js.name}")
        else:
            # node 的报错第一行是 文件:行号，第二行是出错源码，取前两行足够定位
            msg = " | ".join(ln.strip() for ln in r.stderr.strip().splitlines()[:2])
            print(f"  ✗ {js.name}：{msg}")
            errors.append(js.name)
    return errors


def free_port() -> int:
    """让系统分配一个空闲端口（避免与用户正在用的 7610 冲突）"""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_ready(url: str, timeout: float = 15) -> list | None:
    """轮询 /api/tasks 直到服务响应；超时返回 None"""
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:  # noqa: BLE001 —— 服务还没起来，继续等
            time.sleep(0.3)
    return None


def right_pane_std(png: Path) -> float:
    """截图右栏中心区域的亮度标准差"""
    from PIL import Image, ImageStat
    im = Image.open(png).convert("L")
    w, h = im.size
    l, t, r, b = RIGHT_BOX
    box = im.crop((int(w * l), int(h * t), int(w * r), int(h * b)))
    return ImageStat.Stat(box).stddev[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", help="任务名（默认取 /api/tasks 第一个）")
    args = ap.parse_args()

    print("① JS 语法检查")
    js_errors = check_js()

    edge = next((p for p in EDGE_PATHS if p.exists()), None)
    if edge is None:
        print("✗ 找不到 msedge.exe，无法截图")
        return 3

    print("② 临时启动工作台服务")
    port = free_port()
    OUT.mkdir(parents=True, exist_ok=True)
    log = open(OUT / "server.log", "w", encoding="utf-8")
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "station" / "server.py"), "--port", str(port), "--no-browser"],
        stdout=log, stderr=subprocess.STDOUT, cwd=str(ROOT))
    try:
        tasks = wait_ready(f"http://127.0.0.1:{port}/api/tasks")
        if tasks is None:
            print(f"  ✗ 服务 15 秒内没有响应，见 {OUT / 'server.log'}")
            return 2
        print(f"  ✓ 端口 {port}，任务 {len(tasks)} 个")
        task = args.task or (tasks[0]["name"] if tasks else None)
        if not task:
            print("  ✗ projects/ 下没有任务，无法截图验证右栏")
            return 4

        print("③ 无头截图")
        png = OUT / f"smoke_{task}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        cmd = [str(edge), "--headless=new", "--disable-gpu", "--no-first-run",
               f"--user-data-dir={OUT / 'edge_profile'}",   # 独立 profile：不抢用户 Edge 的锁
               f"--screenshot={png}", f"--window-size={WINDOW[0]},{WINDOW[1]}",
               "--virtual-time-budget=6000", f"http://127.0.0.1:{port}/t/{task}/p/"]   # 新工作台（PLAN §8）
        subprocess.run(cmd, capture_output=True, timeout=60)
        if not png.exists():
            print("  ✗ Edge 没有产出截图")
            return 3
        print(f"  ✓ {png.relative_to(ROOT)}")

        print("④ 右栏判定")
        std = right_pane_std(png)
        has_draft = std >= STD_THRESHOLD
        print(f"  {'✓' if has_draft else '✗'} 右栏亮度标准差 {std:.1f}（阈值 {STD_THRESHOLD}）"
              f"{'：有稿' if has_draft else '：空白或只有占位字'}")
    finally:
        # 只关自己起的进程（R21：按自己持有的句柄点名，不按端口/名字乱杀）
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        log.close()

    print()
    if js_errors:
        print(f"FAIL：{len(js_errors)} 个 JS 文件语法错误（{', '.join(js_errors)}）——浏览器会整文件丢弃")
        return 1
    if not has_draft:
        print("FAIL：右栏没有显示稿件")
        return 4
    print("PASS：JS 语法全过，右栏有稿")
    return 0


if __name__ == "__main__":
    sys.exit(main())
