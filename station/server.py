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

# 与 agent 命令行工具共用的写入口（同在 station/ 下；以脚本运行时本目录已在 sys.path）
import draft_store
import req_queue
from locks import LockBusy

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


@app.get("/t/<name>/p/")
def workbench(name: str):
    """新工作台（PLAN §8）。
    为什么挂在 /t/<任务>/p/ 这么深：draft.svg 里图片写的是 ../images/xxx（导出契约，不能改），
    内联 SVG 的相对路径按"页面地址"解析——页面在 /t/<任务>/p/ 时，../images/x 恰好落到
    /t/<任务>/images/x，由下面的 workbench_image 兑现。稿件一字不改，审核所见=导出所得。"""
    if task_dir(name) is None:
        return jsonify({"error": "任务不存在"}), 404
    return send_from_directory(app.static_folder, "workbench.html")


@app.get("/t/<name>/images/<fn>")
def workbench_image(name: str, fn: str):
    """draft 引用的图片。查找规则与 station/export/export.py 的 staging 搬运一致（两处要同步改）：
      pNNN_original.png → pages/NNN/original.png（保留原样整页贴图）
      NNN_figure_K.ext  → pages/NNN/figure_K.ext（提取出的原插图）
      其他              → <任务>/images/<名>（上传的素材）"""
    import re
    d = task_dir(name)
    if d is None or any(c in fn for c in "/\\") or ".." in fn:
        return jsonify({"error": "参数非法"}), 404
    m = re.fullmatch(r"p(\d+)_original\.(png|jpg)", fn)
    m2 = re.fullmatch(r"(\d+)_figure_(\d+)\.(png|jpg|jpeg|gif)", fn)
    if m:
        f = d / "pages" / f"{int(m.group(1)):03d}" / f"original.{m.group(2)}"
    elif m2:
        f = d / "pages" / f"{int(m2.group(1)):03d}" / f"figure_{m2.group(2)}.{m2.group(3)}"
    else:
        f = d / "images" / fn
    if not f.exists():
        return jsonify({"error": "图片不存在"}), 404
    return send_file(f)


@app.get("/outline/<name>")
def outline_page(name: str):
    """大纲卡片确认页（M6.2，B 路线命门闸）"""
    if task_dir(name) is None:
        return jsonify({"error": "任务不存在"}), 404
    return send_from_directory(app.static_folder, "outline.html")


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
    motion_pages = set()
    anim = d / "animations.json"
    if anim.exists():
        try:
            motion_pages = {int(k) for k in json.loads(anim.read_text(encoding="utf-8")).get("pages", {})}
        except Exception:  # noqa: BLE001
            pass
    pages = []
    for pdir in sorted((d / "pages").glob("[0-9]*")):
        if not pdir.is_dir():
            continue
        meta_f = pdir / "meta.json"
        meta = json.loads(meta_f.read_text(encoding="utf-8")) if meta_f.exists() else {}
        v = read_verdict(pdir)
        draft = pdir / "draft.svg"
        pages.append({
            "page": int(pdir.name),
            "title": meta.get("title", ""),
            "role": meta.get("role_guess", ""),
            "suggest": meta.get("suggest", ""),
            "has_draft": draft.exists(),
            # 毫秒级修改时间：前端靠它发现"稿被别人改了"（旧版只看有没有稿，agent 改稿后右栏不刷新，诊断 #6）
            "draft_mtime": draft_store.mtime_of(draft),
            "has_original": (pdir / "original.png").exists(),
            "verdict": v.get("verdict", ""),   # keep|pass|redraw|""
            "star": v.get("star", False),
            "has_motion": int(pdir.name) in motion_pages,
        })
    info = {}
    if (d / "project.json").exists():
        info = json.loads((d / "project.json").read_text(encoding="utf-8"))
    return jsonify({"task": name, "info": info, "pages": pages, "agent_online": agent_online(d)})


def agent_online(d: Path) -> bool:
    """agent 是否在值守：wait_requests.py 每 2 秒写一次心跳（agent_watch.json），
    20 秒内有心跳算在线（留出 agent 领完活、改稿期间不查队列的空档由"working"状态表达）"""
    import time
    f = d / "agent_watch.json"
    try:
        return time.time() - json.loads(f.read_text(encoding="utf-8")).get("last_seen", 0) < 20
    except Exception:  # noqa: BLE001 —— 没有/坏心跳 = 不在线
        return False


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
    resp = send_file(f, mimetype="image/svg+xml", max_age=0)
    # 编辑器拿这个当保存时的基准版本（与读到的内容严格对应；/pages 里的值可能已过时）
    resp.headers["X-Draft-Mtime"] = str(draft_store.mtime_of(f))
    resp.headers["Access-Control-Expose-Headers"] = "X-Draft-Mtime"
    return resp


@app.route("/api/task/<name>/page/<int:n>/draft-wip", methods=["GET", "PUT", "DELETE"])
def api_draft_wip(name: str, n: int):
    """未保存编辑的防丢副本（PLAN §8.4，决策 C"未保存编辑永远先落盘"）。
    存 pages/NNN/draft.wip.json = {base_mtime, svg}：不过质检，导出器和 agent 都不读它。
    浏览器崩了/误关标签页，重开这一页时提示恢复。"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    pdir = d / "pages" / f"{n:03d}"
    if not pdir.is_dir():
        return jsonify({"error": "页面不存在"}), 404
    f = pdir / "draft.wip.json"
    if request.method == "GET":
        if not f.exists():
            return jsonify({"error": "没有未保存的修改"}), 404
        return send_file(f, mimetype="application/json", max_age=0)
    if request.method == "DELETE":
        f.unlink(missing_ok=True)
        return jsonify({"ok": True})
    body = request.get_json(force=True)
    svg = body.get("svg", "")
    if not isinstance(svg, str) or not svg.lstrip().startswith("<") or len(svg) > 2_000_000:
        return jsonify({"error": "内容不像 SVG 或超过 2MB"}), 400
    tmp = pdir / "draft.wip.json.tmp"
    tmp.write_text(json.dumps({"base_mtime": int(body.get("base_mtime") or 0), "svg": svg,
                               "ts": datetime.now().isoformat(timespec="seconds")},
                              ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
    return jsonify({"ok": True})


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
    sync_redraw_queue(d, n, old.get("verdict", ""), verdict)
    return jsonify({"ok": True, **data})


def sync_redraw_queue(d: Path, page: int, old: str, new: str) -> None:
    """「重绘」裁决同时进意见队列（PLAN §8.4）：agent 值守时一并领走，不用另找 verdict.json 扫。
    撤销重绘 → 作废还没被领走的那条（已领走的让 agent 做完，结果用户可再裁决）。"""
    if new == "redraw" and old != "redraw":
        req_queue.add(d, page, "", type_="redraw")
    elif old == "redraw" and new != "redraw":
        req_queue.cancel_redraw(d, page)


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
        sync_redraw_queue(d, data["page"], old.get("verdict", ""), verdict)
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


@app.get("/aesthetics/previews/<path:fn>")
def aesthetics_preview(fn: str):
    """审美库样张（随库迁移的派生资产）"""
    return send_from_directory(ROOT / "library" / "aesthetics" / "previews", fn)


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


@app.post("/api/task/new")
def api_new_task():
    """创建任务（M6.1）：A=翻新（intake 后自然产生），B=从零（此处建壳）"""
    body = request.get_json(force=True)
    name = body.get("name", "")
    if not name or any(c in name for c in "/\\. "):   # 拒绝 / \ . 空格（原写法 "\." 是无效转义，诊断 #12）
        return jsonify({"error": "任务名非法（字母数字-_）"}), 400
    kind = body.get("kind", "b")
    d = PROJECTS / name
    if d.exists():
        return jsonify({"error": "任务已存在"}), 400
    (d / "pages").mkdir(parents=True)
    now = datetime.now().isoformat(timespec="seconds")
    (d / "project.json").write_text(json.dumps(
        {"task": name, "kind": kind, "status": "created", "created": now},
        ensure_ascii=False, indent=2), encoding="utf-8")
    if kind == "b":
        (d / "outline.json").write_text(json.dumps(
            {"confirmed": False, "pages": []}, ensure_ascii=False, indent=2),
            encoding="utf-8")
    return jsonify({"ok": True, "task": name})


@app.get("/api/task/<name>/outline")
def api_get_outline(name: str):
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    f = d / "outline.json"
    return jsonify(json.loads(f.read_text(encoding="utf-8")) if f.exists()
                   else {"confirmed": False, "pages": []})


@app.post("/api/task/<name>/outline")
def api_put_outline(name: str):
    """大纲卡片保存（M6.1）：双入口——本页拖排或聊天改，都走这里"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    body = request.get_json(force=True)
    ol = {"confirmed": bool(body.get("confirmed", False)),
          "pages": body.get("pages", [])[:200],
          "ts": datetime.now().isoformat(timespec="seconds")}
    (d / "outline.json").write_text(
        json.dumps(ol, ensure_ascii=False, indent=2), encoding="utf-8")
    if ol["confirmed"]:
        pjf = d / "project.json"
        pj = json.loads(pjf.read_text(encoding="utf-8")) if pjf.exists() else {}
        pj["status"] = "outline-confirmed"
        pjf.write_text(json.dumps(pj, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"ok": True, **ol})


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
        prev = ROOT / "library/aesthetics/previews" / f"{f.stem}.svg"
        out.append({"id": field("id") or f.stem, "name": field("name"),
                    "category": field("category"), "applies": field("applies"),
                    "palette": palette,
                    "preview": f"/aesthetics/previews/{f.stem}.svg" if prev.exists() else ""})
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


import subprocess as _sp
import threading as _th

# 生成状态按任务分开记（内存即可：重启后读 draft 数判断）。
# 旧版是全局一份：A 任务在跑时 B 任务也显示"生成中"，且 B 无法启动（诊断 #12）
_gen_status: dict[str, dict] = {}
_gen_lock = _th.Lock()


@app.post("/api/task/<name>/generate")
def api_generate(name: str):
    """一键出稿（M4.10）：工作台内直接触发 batch_draft.py，新用户零命令行"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    with _gen_lock:   # 检查+置位要原子：两次快速点击不能起两个进程
        st = _gen_status.setdefault(name, {"running": False, "last_output": ""})
        if st["running"]:
            return jsonify({"error": "生成进行中", "output": st["last_output"][:500]}), 409
        st["running"] = True
        st["last_output"] = ""

    def run():
        try:
            r = _sp.run(
                [sys.executable, str(ROOT / "station" / "prep" / "batch_draft.py"), str(d)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                cwd=str(ROOT), timeout=600)
            st["last_output"] = (r.stdout + r.stderr)[-2000:]
            st["returncode"] = r.returncode
        except Exception as exc:  # noqa: BLE001
            st["last_output"] = f"生成失败：{exc}"
            st["returncode"] = -1
        finally:
            st["running"] = False

    _th.Thread(target=run, daemon=True).start()
    return jsonify({"ok": True, "message": "批量出稿已启动（生成中，页面会逐页亮起）"})


@app.get("/api/task/<name>/generate/status")
def api_generate_status(name: str):
    draft_count = 0
    total = 0
    d = task_dir(name)
    if d:
        for p in (d / "pages").glob("[0-9][0-9][0-9]"):
            total += 1
            if (p / "draft.svg").exists():
                draft_count += 1
    st = _gen_status.get(name, {"running": False, "last_output": ""})
    return jsonify({"running": st["running"], "returncode": st.get("returncode"),
                    "drafts": draft_count, "total": total,
                    "output": st["last_output"][-500:]})


@app.post("/api/task/<name>/page/<int:n>/request")
def api_add_request(name: str, n: int):
    """意见入队（M3.5a）：与聊天同一队列（双入口单队列）；读写全走 req_queue（持锁）"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    body = request.get_json(force=True)
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify({"error": "意见为空"}), 400
    return jsonify({"ok": True, **req_queue.add(d, n, text)})


@app.get("/api/task/<name>/requests")
def api_requests(name: str):
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(req_queue.read_all(d))


@app.post("/api/task/<name>/requests/update")
def api_update_request(name: str):
    """状态更新：按 id 改（旧调用方只传 ts 时用 ts 兜底——旧记录的 id 就是 ts）"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    body = request.get_json(force=True)
    status = body.get("status", "done")
    if status not in ("queued", "working", "done", "cancelled"):
        return jsonify({"error": f"非法状态：{status}"}), 400
    key = body.get("id") or body.get("ts")
    n = req_queue.set_status(d, [key], status) if key else 0
    if not n:
        return jsonify({"error": "未找到该条"}), 404
    return jsonify({"ok": True, "updated": n})


@app.post("/api/task/<name>/page/<int:n>/draft")
def api_save_draft(name: str, n: int):
    """保存编辑：与 agent 改稿走同一个写入口（draft_store.write_draft，PLAN §8.6）。
    请求头 X-Base-Mtime = 编辑起点那份稿的版本号；盘上已不是它 → 409，前端让用户二选一。"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    if not (ROOT / "ppt-master/skills/ppt-master/scripts/svg_to_pptx.py").exists():
        return jsonify({"error": "引擎未拉取：git submodule update --init --depth 1 ppt-master"}), 503
    base = request.headers.get("X-Base-Mtime", "")
    try:
        res = draft_store.write_draft(d / "pages" / f"{n:03d}", request.get_data(as_text=True),
                                      int(base) if base.isdigit() else None)
    except LockBusy:
        return jsonify({"error": "这一页正在被另一方写入，稍后重试"}), 503
    code = 200 if res["ok"] else res.pop("code")
    return jsonify(res), code


@app.get("/api/task/<name>/page/<int:n>/versions")
def api_versions(name: str, n: int):
    """draft 版本历史列表（M4.9）"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    vdir = d / "pages" / f"{n:03d}" / "versions"
    out = []
    if vdir.exists():
        for v in sorted(vdir.glob("*.svg"), reverse=True):
            out.append({"ts": v.stem, "size": v.stat().st_size})
    return jsonify(out)


@app.get("/api/task/<name>/page/<int:n>/version/<ts>")
def api_version(name: str, n: int, ts: str):
    """取某版本内容（恢复=前端拿它再 POST draft，质检门照常把关）"""
    d = task_dir(name)
    if d is None or not ts.replace("_", "").isdigit():
        return jsonify({"error": "参数非法"}), 404
    v = d / "pages" / f"{n:03d}" / "versions" / f"{ts}.svg"
    if not v.exists():
        return jsonify({"error": "版本不存在"}), 404
    return send_file(v, mimetype="image/svg+xml")


@app.post("/api/task/<name>/asset")
def api_asset(name: str):
    """编辑器插图上传（M4.4）：存任务 images/，draft 用 ../images/<名>引用
    （export 搬运规则已兼容 task/images/ 回退路径）"""
    d = task_dir(name)
    if d is None:
        return jsonify({"error": "任务不存在"}), 404
    f = request.files.get("file")
    if f is None:
        return jsonify({"error": "无文件"}), 400
    ext = (f.filename or "png").rsplit(".", 1)[-1].lower()
    if ext not in ("png", "jpg", "jpeg", "gif", "webp"):
        return jsonify({"error": f"不支持的类型 {ext}"}), 400
    data = f.read()
    if len(data) > 20 * 1024 * 1024:
        return jsonify({"error": "图片超过 20MB"}), 400
    # 文件名完全由服务器生成（纯 ASCII + 随机串）：旧版把用户文件名原样拼进路径——
    # 可被 ../ 穿越，中文名在导出链路（R6 路径一律 ASCII）也会出问题（诊断 #12）
    import uuid
    fname = f"upload_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.{ext}"
    (d / "images").mkdir(exist_ok=True)
    (d / "images" / fname).write_bytes(data)
    return jsonify({"ok": True, "name": fname})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7610)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--task", help="打开时直接定位到某任务")
    ap.add_argument("--root", help="任务根目录（默认 projects/）；测试一律指向 tmp/ 下的副本，别写用户区（R1）")
    args = ap.parse_args()
    if args.root:
        global PROJECTS
        PROJECTS = Path(args.root).resolve()

    url = f"http://127.0.0.1:{args.port}"
    if args.task:
        url += f"/t/{args.task}/p/"   # 新工作台（PLAN §8）
    if not args.no_browser:
        # 稍等服务器起来再开浏览器（daemon 场景由外层控制，这里简单延时）
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"◎ 审核工作台：{url}（Ctrl+C 退出）")
    app.run(host="127.0.0.1", port=args.port, debug=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
