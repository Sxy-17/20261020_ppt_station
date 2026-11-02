/* 右栏编辑器（PLAN §8.4）· R5：选中 / 拖动 / 方向键微调 / 撤销 / 保存过质检门 / 未保存防丢
   与 workbench.js 的约定（显式调用，不改写对方函数——诊断 #7）：
     render() 载入新稿后调 editor.attach(svg, 页, 版本号)；离页/通过前调 editor.save()；
     键盘先交给 editor.handleKey(e)，返回 true 表示编辑器已处理。
   交互规则参照 ppt-master svg_editor：先单击选中、再按住拖动（不会误拖背景或没选中的东西）。 */
"use strict";

const editor = (() => {
  let svg = null;          // 当前右栏的 <svg>
  let page = null;         // state.pages 里的当前页对象
  let base = 0;            // 编辑起点那份稿的版本号（保存时作 X-Base-Mtime）
  let selected = null;
  let undo = [];           // 快照栈（svg.innerHTML）：稿件都是几 KB，整份快照最简单可靠
  let lastKey = "", lastAt = 0;   // 合并连续的同类操作（连按方向键只算一步撤销）
  let wipTimer = null;
  let saving = null;       // 正在进行的保存（Promise）；重复调用共用同一次
  const ed = { dirty: false };

  /* ---------- 挂载 / 卸载 ---------- */
  ed.attach = (svgEl, p, mtime) => {
    ed.detach();
    svg = svgEl; page = p; base = mtime;
    checkWip();
  };
  ed.detach = () => {
    deselect(); clearQC();
    svg = null; page = null; undo = []; ed.dirty = false;
    clearTimeout(wipTimer);
    drawChip();
  };
  // 用户在冲突时选了"保留我的修改"：接受盘上的新版本号作基准，下次保存覆盖它
  ed.acceptBase = (mtime) => { base = mtime; };
  ed.discard = async () => {
    if (page) await fetch(api(`/page/${page.page}/draft-wip`), { method: "DELETE" }).catch(() => {});
    ed.dirty = false; undo = [];
  };

  /* ---------- 坐标 ---------- */
  // 屏幕点 → 某元素父级坐标系（拖动位移要在父级坐标里算，缩放/窗口大小都无关）
  function toParent(el, x, y) {
    return new DOMPoint(x, y).matrixTransform(el.parentNode.getScreenCTM().inverse());
  }
  function isBackground(el) {
    return el.id === "page-background" || el.getAttribute("data-pptx-role") === "background";
  }
  // 点到的东西 → 可选单元：默认是根级语义组（<svg> 的直接子级）；Alt 时是元素本身
  function unitOf(node, alt) {
    if (!svg || !svg.contains(node) || node === svg) return null;
    let el = node.tagName === "tspan" ? node.closest("text") : node;
    if (!alt) while (el.parentNode !== svg) el = el.parentNode;
    if (!el || el === svg || isBackground(el) || el.closest("defs")) return null;
    return el;
  }

  /* ---------- 位移：只用 translate，原有 transform 原样保留在后面 ---------- */
  function tf(el) { return { x: +(el.dataset.edTx || 0), y: +(el.dataset.edTy || 0) }; }
  function setTf(el, x, y) {
    if (el.dataset.edT0 === undefined) el.dataset.edT0 = el.getAttribute("transform") || "";
    // 根级组第一次被挪：记下原始版面格子，保存时格子 = 原格子 + 总位移
    if (el.parentNode === svg && el.dataset.edB0 === undefined && el.getAttribute("data-pptx-bounds"))
      el.dataset.edB0 = el.getAttribute("data-pptx-bounds");
    el.dataset.edTx = round(x); el.dataset.edTy = round(y);
    const t0 = el.dataset.edT0;
    el.setAttribute("transform", `translate(${round(x)} ${round(y)})${t0 ? " " + t0 : ""}`);
  }
  const round = (v) => Math.round(v * 10) / 10;

  /* ---------- 选中 ---------- */
  function select(el) {
    deselect();
    selected = el;
    el.classList.add("ed-sel");
    $("svgbox").classList.add("has-sel");
    $("selbox").hidden = false;
    syncOverlay();
  }
  function deselect() {
    if (selected) selected.classList.remove("ed-sel");
    selected = null;
    $("svgbox").classList.remove("has-sel");
    $("selbox").hidden = true;
  }
  function syncOverlay() {
    if (!selected) return;
    const host = $("draft-slide").getBoundingClientRect(), r = selected.getBoundingClientRect();
    Object.assign($("selbox").style, { left: r.left - host.left - 3 + "px", top: r.top - host.top - 3 + "px",
      width: r.width + 6 + "px", height: r.height + 6 + "px" });
  }
  ed.syncOverlay = syncOverlay;

  /* ---------- 改动记账 ---------- */
  function snapshot(key = "") {
    const now = Date.now();
    if (key && key === lastKey && now - lastAt < 800) { lastAt = now; return; }   // 合并连续同类操作
    lastKey = key; lastAt = now;
    undo.push(svg.innerHTML);
    if (undo.length > 100) undo.shift();
  }
  function changed() {
    ed.dirty = true;
    clearQC();
    drawChip();
    clearTimeout(wipTimer);
    wipTimer = setTimeout(saveWip, 1000);   // 停手 1 秒落一份防丢副本（不过质检）
  }
  function doUndo() {
    if (!undo.length) return;
    const id = selected && selected.id;
    svg.innerHTML = undo.pop();
    lastKey = "";
    svg.querySelectorAll(".ed-sel").forEach((n) => n.classList.remove("ed-sel"));
    selected = null;
    if (id) { const el = svg.getElementById(id); if (el) select(el); else deselect(); } else deselect();
    changed();
  }

  /* ---------- 鼠标：单击选中；已选中再按住 = 拖动 ---------- */
  let drag = null;
  $("svgbox").addEventListener("pointerdown", (e) => {
    if (!svg || e.button !== 0) return;
    const u = unitOf(e.target, e.altKey);
    if (!u) { deselect(); return; }
    e.preventDefault();                         // 防止浏览器原生拖图片/选文字
    if (u !== selected) { select(u); return; }
    const p0 = toParent(u, e.clientX, e.clientY);
    drag = { el: u, p0, t0: tf(u), moved: false };
    $("svgbox").setPointerCapture(e.pointerId);
  });
  $("svgbox").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toParent(drag.el, e.clientX, e.clientY);
    const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;   // 手抖不算拖
    if (!drag.moved) { snapshot(); drag.moved = true; }
    setTf(drag.el, drag.t0.x + dx, drag.t0.y + dy);
    syncOverlay();
  });
  $("svgbox").addEventListener("pointerup", () => {
    if (drag && drag.moved) changed();
    drag = null;
  });

  /* ---------- 键盘 ---------- */
  ed.handleKey = (e) => {
    if (!svg) return false;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); doUndo(); return true; }
    if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); ed.save(); return true; }
    if (k === "Escape" && selected) { deselect(); return true; }
    if (k.startsWith("Arrow") && selected && !ctrl) {
      // 选中时方向键 = 微调（1px，Shift 10px）；没选中时方向键仍是翻页
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1, t = tf(selected);
      snapshot("nudge:" + (selected.id || ""));
      setTf(selected, t.x + (k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0),
                      t.y + (k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0));
      syncOverlay(); changed();
      return true;
    }
    return false;
  };

  /* ---------- 序列化：去掉编辑器痕迹，同步 data-pptx-bounds ---------- */
  // 屏幕矩形 → 画布坐标矩形 [x, y, w, h]
  function canvasBox(el) {
    const r = el.getBoundingClientRect(), inv = svg.getScreenCTM().inverse();
    const a = new DOMPoint(r.left, r.top).matrixTransform(inv), b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
    return [a.x, a.y, b.x - a.x, b.y - a.y];
  }

  function serialize() {
    // 先在活 DOM 上同步 data-pptx-bounds（要用浏览器量尺寸），再克隆清理。
    // 为什么必须同步：质检按 bounds 判"组与组重叠""内容超出组"——旧编辑器只挪内容不改 bounds，
    // 挪过的组要么被误拦（内容超出旧格子），要么真重叠了却放行（诊断 #9，已实测）
    for (const g of svg.children) {
      if (!g.getAttribute || !g.getAttribute("data-pptx-bounds")) continue;
      let [x, y, w, h] = (g.dataset.edB0 || g.getAttribute("data-pptx-bounds")).trim().split(/[\s,]+/).map(Number);
      const own = tf(g);
      x += own.x; y += own.y;                       // 整组平移：格子跟着走，大小不变（保留生成器划的版面）
      if (g.querySelector("[data-ed-tx]")) {
        // 组内单个元素被挪过：格子扩到装得下新位置（只扩不缩，免得内容超出格子）
        const [bx, by, bw, bh] = canvasBox(g);
        const x2 = Math.max(x + w, bx + bw), y2 = Math.max(y + h, by + bh);
        x = Math.min(x, bx); y = Math.min(y, by); w = x2 - x; h = y2 - y;
      }
      g.setAttribute("data-pptx-bounds", [x, y, w, h].map(round).join(" "));
    }

    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".ed-sel").forEach((n) => n.classList.remove("ed-sel"));
    clone.querySelectorAll("[class='']").forEach((n) => n.removeAttribute("class"));
    for (const el of clone.querySelectorAll("[data-ed-tx], [data-ed-t0], [data-ed-b0]")) {
      const { x, y } = tf(el), t0 = el.dataset.edT0 || "";
      if (el.dataset.edTx !== undefined) {
        if (!x && !y) { if (t0) el.setAttribute("transform", t0); else el.removeAttribute("transform"); }
      }
      delete el.dataset.edTx; delete el.dataset.edTy; delete el.dataset.edT0; delete el.dataset.edB0;
    }
    return new XMLSerializer().serializeToString(clone);
  }

  /* ---------- 保存 = 统一写入口（版本校验 + 质检门 + 原子替换） ---------- */
  ed.save = () => {
    if (!svg || !ed.dirty) return Promise.resolve(true);
    if (saving) return saving;
    saving = (async () => {
      const p = page, text = serialize();
      clearQC();
      drawChip("保存中…");
      let r, d;
      try {
        r = await fetch(api(`/page/${p.page}/draft`), {
          method: "POST", headers: { "Content-Type": "image/svg+xml", "X-Base-Mtime": String(base) }, body: text });
        d = await r.json();
      } catch {
        drawChip("没保存上：服务器连不上（修改还在，Ctrl+S 重试）", "bad");
        return false;
      }
      if (page !== p) return false;               // 保存途中被换了页（不应发生，防御）
      if (r.ok && d.ok) {
        base = d.mtime;
        p.draft_mtime = d.mtime;
        state.shown[p.page] = d.mtime;            // 告诉轮询：这是我自己写的，别当成"别人改了"去重载
        ed.dirty = false;
        clearTimeout(wipTimer);
        fetch(api(`/page/${p.page}/draft-wip`), { method: "DELETE" }).catch(() => {});
        drawChip("已保存 ✓");
        setTimeout(() => { if (page === p && !ed.dirty) drawChip(); }, 1500);
        return true;
      }
      if (r.status === 422) {
        markBad(d.details || []);
        drawChip(`质检未过：${shortReason(d.details)}（Ctrl+Z 撤回再试）`, "bad");
        return false;
      }
      if (r.status === 409) {
        conflict(d.current_mtime);
        drawChip("没保存：agent 刚改过这页", "bad");
        return false;
      }
      drawChip(`没保存上：${d.error || r.status}`, "bad");
      return false;
    })().finally(() => { saving = null; });
    return saving;
  };

  // 盘上的稿被别人改了而我有未保存修改：让用户二选一（不替用户决定）
  function conflict(mtime) {
    const p = page;
    banner(`agent 刚更新了 P${p.page}，你还有未保存的修改`, [
      ["载入新稿", async () => { await ed.discard(); await render(); flash(); }],
      ["保留我的修改", () => { ed.acceptBase(mtime); state.shown[p.page] = mtime; ed.save(); }],
    ], 0);
  }
  ed.conflict = conflict;

  function shortReason(details = []) {
    const t = details.join(" ");
    const ov = /<g id="([^"]+)"> data-pptx-bounds overlaps <g id="([^"]+)">/.exec(t);
    if (ov) return `${ov[1]} 和 ${ov[2]} 重叠`;
    if (/exceeds/.test(t)) return "内容超出所在区块";
    if (/viewBox|outside|canvas/i.test(t)) return "超出画布";
    return (details[0] || "见服务器输出").replace(/^\[ERROR\]\s*/, "").slice(0, 60);
  }

  // 把质检点名的组在画布上框红
  function markBad(details) {
    const ids = new Set();
    for (const line of details) for (const m of line.matchAll(/<g id="([^"]+)">/g)) ids.add(m[1]);
    const host = $("draft-slide").getBoundingClientRect();
    for (const id of ids) {
      const el = svg.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect(), box = document.createElement("div");
      box.className = "qcbad";
      Object.assign(box.style, { left: r.left - host.left + "px", top: r.top - host.top + "px",
        width: r.width + "px", height: r.height + "px" });
      $("draft-slide").appendChild(box);
    }
  }
  function clearQC() { document.querySelectorAll(".qcbad").forEach((n) => n.remove()); }

  /* ---------- 未保存防丢：wip 副本 ---------- */
  function saveWip() {
    if (!svg || !ed.dirty) return;
    // 存活 DOM（带编辑器记账属性），恢复后还能接着撤销位移
    fetch(api(`/page/${page.page}/draft-wip`), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_mtime: base, svg: svg.outerHTML }),
    }).catch(() => {});
  }
  async function checkWip() {
    const p = page;
    let w;
    try {
      const r = await fetch(api(`/page/${p.page}/draft-wip`), { cache: "no-store" });
      if (!r.ok) return;
      w = await r.json();
    } catch { return; }
    if (page !== p) return;
    banner(`P${p.page} 有上次没保存的修改（${(w.ts || "").replace("T", " ")}）`, [
      ["恢复", () => {
        if (page !== p) return;
        $("svgbox").innerHTML = w.svg;
        svg = $("svgbox").querySelector("svg");
        base = w.base_mtime;
        undo = [];
        changed();
      }],
      ["丢弃", () => { fetch(api(`/page/${p.page}/draft-wip`), { method: "DELETE" }).catch(() => {}); }],
    ], 0);
  }

  // 关标签页前提醒（wip 已在盘上，这里只是多一道保险）
  addEventListener("beforeunload", (e) => { if (ed.dirty) { saveWip(); e.preventDefault(); e.returnValue = ""; } });
  addEventListener("resize", () => setTimeout(syncOverlay, 0));

  return ed;
})();
