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


@app.get("/select/<name>")
def select_page(name: str):
    """选择页（M3.3）：一次性表单式确认页"""
    if task_dir(name) is None:
        return jsonify({"error": "任务不存在"}), 404
    return send_from_directory(app.static_folder, "select.html")


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


@app.post("/api/task/<name>/verdicts")
def api_verdicts(name: str):
    """批量裁决（M3.2b）：一次写多页 + 审计日志；撤销也走这里（回写旧值）。
    跳过已裁决页由客户端算好再发（服务端保持纯粹：收啥写啥）。"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    body = request.get_json(force=True)
    entries = body.get("entries", [])
    if not entries or len(entries) > 1000:
        return jsonify({"error": "entries 为空或超限"}), 400
    written = []
    for e in entries:
        pdir = d / "pages" / f"{int(e['page']):03d}"
        if not pdir.is_dir():
            continue
        verdict = e.get("verdict", "")
        if verdict not in ("keep", "pass", "redraw", ""):
            return jsonify({"error": f"非法裁决值：{verdict}"}), 400
        old = read_verdict(pdir)
        data = {"page": int(e["page"]), "verdict": verdict,
                "star": bool(e.get("star", old.get("star", False))),
                "note": e.get("note", old.get("note", "")),
                "ts": datetime.now().isoformat(timespec="seconds")}
        (pdir / "verdict.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        written.append(data)
    # 审计：谁在什么时候批量动了哪些页（batch_log.jsonl，追加式）
    if body.get("log_action"):
        with open(d / "batch_log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": datetime.now().isoformat(timespec="seconds"),
                                "action": body["log_action"],
                                "verdict": written[0]["verdict"] if written else "",
                                "pages": [w["page"] for w in written]},
                               ensure_ascii=False) + "\n")
    return jsonify({"ok": True, "written": written})


@app.get("/api/task/<name>/diagnosis")
def api_diagnosis(name: str):
    """选择页诊断区数据（M3.3）"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    f = d / "diagnosis.json"
    if not f.exists():
        return jsonify({"error": "尚未诊断"}), 404
    return send_file(f, mimetype="application/json")


@app.get("/api/templates")
def api_templates():
    """审美库模板卡片（M3.3）：轻量 frontmatter 解析，不引 YAML 依赖。
    只抽选择页需要的字段；正文纪律不传（agent 生成时直读 .md）。"""
    import re
    lib = ROOT / "library" / "aesthetics"
    out = []
    for f in sorted(lib.glob("template-*.md")):
        head = f.read_text(encoding="utf-8").split("---")[1]  # 首个 --- 之间
        def field(k):
            m = re.search(rf"^{k}:\s*(.+)$", head, re.M)
            return m.group(1).strip().strip('"') if m else ""
        palette = {}
        pm = re.search(r"^palette:\n((?:\s+\w+:.*\n?)+)", head, re.M)
        if pm:
            for ln in pm.group(1).strip().splitlines():
                mm = re.match(r'\s*(\w+):\s*"?#?([0-9A-Fa-f]{0,8})', ln)
                if mm and mm.group(2):
                    palette[mm.group(1)] = "#" + mm.group(2).upper()
        out.append({"id": field("id") or f.stem, "name": field("name"),
                    "category": field("category"), "applies": field("applies"),
                    "palette": palette})
    return jsonify(out)


@app.post("/api/task/<name>/selection")
def api_selection(name: str):
    """确认包收据落盘（M3.3）：selection.json + project.json 状态推进"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    body = request.get_json(force=True)
    sel = {"ts": datetime.now().isoformat(timespec="seconds"),
           "delegate": bool(body.get("delegate", False)),
           "choices": body.get("choices", {})}
    (d / "selection.json").write_text(
        json.dumps(sel, ensure_ascii=False, indent=2), encoding="utf-8")
    pjf = d / "project.json"
    pj = json.loads(pjf.read_text(encoding="utf-8")) if pjf.exists() else {}
    pj["status"] = "delegate" if sel["delegate"] else "confirmed"
    pj["selected_at"] = sel["ts"]
    pjf.write_text(json.dumps(pj, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True, **sel})


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
