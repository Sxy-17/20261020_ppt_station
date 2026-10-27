#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""审核工作台服务器（M3.1）

模式抄 ppt-master confirm_ui/svg_editor：localhost Flask + 状态皆文件。
网页只是 tasks 目录的可视化皮肤——聊天里说"P5 通过"与网页上点"通过"
写的是同一个 verdict.json（双入口单队列原则）。

用法：
    .venv/Scripts/python station/server.py [--port 7610] [--no-browser] [--task 任务名]
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import webbrowser
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory

ROOT = Path(__file__).resolve().parents[1]  # station/ 的上一级=工作区根（注意与 prep/ 下脚本差一层，教训#20）
PROJECTS = ROOT / "projects"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

app = Flask(__name__, static_folder="static", static_url_path="/static")


def task_dir(name: str) -> Path | None:
    """安全取任务目录：拒绝路径穿越（任务名只允许字母数字下划线连字符）"""
    if not name or any(c in name for c in "/\\.."):
        return None
    d = PROJECTS / name
    return d if d.is_dir() else None


def read_verdict(page_dir: Path) -> dict:
    f = page_dir / "verdict.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 —— 坏收据不炸页面，视为未裁决
            return {}
    return {}


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/tasks")
def api_tasks():
    """任务清单（有 project.json 的目录）"""
    tasks = []
    for d in sorted(PROJECTS.iterdir()):
        pj = d / "project.json"
        if pj.exists():
            data = json.loads(pj.read_text(encoding="utf-8"))
            tasks.append({"name": d.name, "status": data.get("status", "?"),
                          "pages": data.get("pages", 0)})
    return jsonify(tasks)


@app.get("/api/task/<name>/pages")
def api_pages(name: str):
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    pages = []
    for pdir in sorted((d / "pages").glob("[0-9]*")):
        if not pdir.is_dir():
            continue
        meta_f = pdir / "meta.json"
        meta = json.loads(meta_f.read_text(encoding="utf-8")) if meta_f.exists() else {}
        v = read_verdict(pdir)
        pages.append({
            "page": int(pdir.name),
            "title": meta.get("title", ""),
            "role": meta.get("role_guess", ""),
            "suggest": meta.get("suggest", ""),
            "has_draft": (pdir / "draft.svg").exists(),
            "has_original": (pdir / "original.png").exists(),
            "verdict": v.get("verdict", ""),   # keep|pass|redraw|""
            "star": v.get("star", False),
        })
    info = {}
    if (d / "project.json").exists():
        info = json.loads((d / "project.json").read_text(encoding="utf-8"))
    return jsonify({"task": name, "info": info, "pages": pages})


@app.get("/api/task/<name>/page/<int:n>/original")
def api_original(name: str, n: int):
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    f = d / "pages" / f"{n:03d}" / "original.png"
    if not f.exists():
        return jsonify({"error": "无截图"}), 404
    return send_file(f, mimetype="image/png")


@app.get("/api/task/<name>/page/<int:n>/draft")
def api_draft(name: str, n: int):
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    f = d / "pages" / f"{n:03d}" / "draft.svg"
    if not f.exists():
        return jsonify({"error": "尚未出稿"}), 404
    return send_file(f, mimetype="image/svg+xml")


@app.post("/api/task/<name>/page/<int:n>/verdict")
def api_verdict(name: str, n: int):
    """裁决落盘——网页与聊天共用的唯一写入口（本服务器侧）"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    body = request.get_json(force=True)
    verdict = body.get("verdict", "")
    if verdict not in ("keep", "pass", "redraw", ""):  # ""=清除裁决
        return jsonify({"error": f"非法裁决值：{verdict}"}), 400
    pdir = d / "pages" / f"{n:03d}"
    if not pdir.is_dir():
        return jsonify({"error": "页面不存在"}), 404
    # 保留旧意见字段，覆盖裁决三件套（合并写，避免丢 note）
    old = read_verdict(pdir)
    data = {
        "page": n,
        "verdict": verdict,
        "star": bool(body.get("star", old.get("star", False))),
        "note": body.get("note", old.get("note", "")),
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    (pdir / "verdict.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True, **data})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7610)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--task", help="打开时直接定位到某任务")
    args = ap.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    if args.task:
        url += f"/#{args.task}"
    if not args.no_browser:
        # 稍等服务器起来再开浏览器（daemon 场景由外层控制，这里简单延时）
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"◎ 审核工作台：{url}（Ctrl+C 退出）")
    app.run(host="127.0.0.1", port=args.port, debug=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
