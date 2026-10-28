/* 编辑器 M4.1：编辑模式开关 + 元素选中 + 拖动移动 + Ctrl+Z（内存态）
   保存/落盘在 M4.3；本步只动浏览器内存，刷新即还原——安全试手。 */
"use strict";

(function () {
  let editing = false;
  let selected = null;          // 选中元素（svg 根直接子级=语义单元优先）
  let overlay = null;           // 选中框（DOM 覆盖层，不污染 SVG）
  const ops = [];               // {el, dx, dy} 拖动流水（撤销用）

  // ---- 开关按钮（注入 verdictbar）----
  const btn = document.createElement("button");
  btn.id = "btn-edit";
  btn.className = "vbtn";
  btn.textContent = "✏ 编辑";
  btn.title = "编辑模式（M4.1：选中/拖动）";
  document.querySelector(".verdict-group").after(btn);

  const saveBtn = document.createElement("button");
  saveBtn.id = "btn-save";
  saveBtn.className = "vbtn";
  saveBtn.textContent = "保存修改";
  saveBtn.title = "把编辑烘进几何属性并落盘（过质检门）";
  saveBtn.onclick = saveDraft;
  btn.after(saveBtn);

  async function saveDraft() {
    const svg = svgEl();
    if (!svg) return;
    const clone = svg.cloneNode(true);
    // bake：把 translate 烘进几何属性（质检器不认游离 transform 的页也要过）
    for (const el of [...clone.querySelectorAll("[transform]")]) {
      const [tx, ty] = translateOf(el.getAttribute("transform"));
      if (!tx && !ty) { el.removeAttribute("transform"); continue; }
      const tag = el.tagName.toLowerCase();
      const add = (a, dv) => { const v = el.getAttribute(a); if (v !== null) el.setAttribute(a, +v + dv); };
      if (tag === "rect" || tag === "image") { add("x", tx); add("y", ty); }
      else if (tag === "text") { add("x", tx); add("y", ty);
        for (const t of el.querySelectorAll("tspan[x]")) { t.setAttribute("x", +t.getAttribute("x") + tx); } }
      else if (tag === "line") { add("x1", tx); add("x2", tx); add("y1", ty); add("y2", ty); }
      else if (tag === "ellipse" || tag === "circle") { add("cx", tx); add("cy", ty); }
      // path/g/polygon 等保留 transform（导出器可译）
      else continue;
      el.removeAttribute("transform");
    }
    const text = new XMLSerializer().serializeToString(clone);
    const p = state.pages[state.cur];
    const res = await fetch(`/api/task/${state.task}/page/${p.page}/draft`, {
      method: "POST", headers: { "Content-Type": "image/svg+xml" }, body: text });
    const data = await res.json();
    if (!data.ok) {
      alert("保存被质检门拦下（已回滚，内存编辑保留）：
" + (data.details || []).join("
"));
      return;
    }
    ops.length = 0;
    window.render(state.cur);   // 重新拉取落盘版
  }

  btn.onclick = () => {
    editing = !editing;
    btn.classList.toggle("active", editing);
    document.body.classList.toggle("editing", editing);
    if (!editing) deselect();
  };

  // ---- 每次渲染新 draft 后重新挂钩 ----
  const origRender = window.render;
  window.render = (i) => { origRender(i); if (editing) hook(); };

  function svgEl() {
    return document.querySelector("#draft-holder > svg");
  }
  function holder() { return document.getElementById("draft-holder"); }

  function hook() {
    const svg = svgEl();
    if (!svg) return;
    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
  }

  // ---- 选中 ----
  function unitOf(node) {
    // 默认抓语义单元（svg 根直接子级）；背景/defs 不可选
    let el = node;
    while (el && el.parentElement !== svgEl()) el = el.parentElement;
    if (!el || el.tagName === "defs" || el.tagName === "svg") return null;
    if (el.id === "page-background") return null;
    return el;
  }

  function select(el) {
    deselect();
    selected = el;
    buildPanel();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ed-overlay";
      holder().appendChild(overlay);
    }
    overlay.hidden = false;
    syncOverlay();
  }
  function deselect() {
    selected = null;
    if (overlay) overlay.hidden = true;
    hidePanel();
  }

  // ---------- M4.2 属性面板 ----------
  let panel = null;
  function hidePanel() { if (panel) panel.hidden = true; }
  function buildPanel() {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ed-panel";
      holder().appendChild(panel);
    }
    panel.hidden = false;
    const el = selected;
    const tag = el.tagName.toLowerCase();
    const isText = tag === "text" || tag === "tspan";
    const isStroke = tag === "line" || tag === "path";
    let html = `<div class="ep-tag">${tag}${el.id ? " #" + el.id : ""}</div>`;
    if (tag === "text") {
      // 逐 tspan 编辑（保持定位结构）；无 tspan 则编辑整段
      const tspans = [...el.children].filter((c) => c.tagName === "tspan");
      if (tspans.length) {
        tspans.forEach((t, i) => {
          html += `<label class="ep-row">行${i + 1}<textarea data-edit-t="${i}" rows="1">${t.textContent}</textarea></label>`;
        });
      } else {
        html += `<label class="ep-row">文本<textarea id="ep-text" rows="2">${el.textContent}</textarea></label>`;
      }
      html += `<div class="ep-row">字号<input id="ep-size" type="number" value="${parseFloat(el.getAttribute("font-size")) || 18}" step="1"></div>`;
      html += `<label class="ep-row">加粗<input id="ep-bold" type="checkbox" ${(el.getAttribute("font-weight") === "bold") ? "checked" : ""}></label>`;
      html += `<div class="ep-row">颜色<input id="ep-color" type="color" value="${normColor(el.getAttribute("fill"))}"></div>`;
    } else if (!isStroke && tag !== "g") {
      html += `<div class="ep-row">填充<input id="ep-fill" type="color" value="${normColor(el.getAttribute("fill"))}"></div>`;
    }
    if (isStroke) {
      html += `<div class="ep-row">线色<input id="ep-stroke" type="color" value="${normColor(el.getAttribute("stroke"))}"></div>`;
      html += `<div class="ep-row">线宽<input id="ep-sw" type="number" step="0.5" value="${el.getAttribute("stroke-width") || 2}"></div>`;
    }
    html += `<div class="ep-tip">M4.2 内存态 · 保存链路 M4.3</div>`;
    panel.innerHTML = html;
    wirePanel(el);
  }
  function normColor(c) {
    if (!c) return "#1d2430";
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    const m = /#([0-9a-f]{3})$/i.exec(c);
    if (m) return "#" + m[1].split("").map((x) => x + x).join("");
    return "#1d2430";
  }
  function wirePanel(el) {
    panel.querySelectorAll("[data-edit-t]").forEach((ta) => {
      ta.oninput = () => {
        const t = [...el.children].filter((c) => c.tagName === "tspan")[+ta.dataset.editT];
        if (t && t.textContent !== ta.value) {
          ops.push({ type: "attr", el: t, attr: "#text", old: t.textContent, new: ta.value });
          t.textContent = ta.value;
        }
      };
    });
    const q = (id) => panel.querySelector("#" + id);
    if (q("ep-text")) q("ep-text").oninput = (e) => {
      ops.push({ type: "attr", el, attr: "#text", old: null, new: e.target.value });
      el.textContent = e.target.value;
    };
    if (q("ep-size")) q("ep-size").onchange = (e) => setAttr(el, "font-size", e.target.value);
    if (q("ep-bold")) q("ep-bold").onchange = (e) => setAttr(el, "font-weight", e.target.checked ? "bold" : "normal");
    if (q("ep-color")) q("ep-color").oninput = (e) => setAttr(el, "fill", e.target.value.toUpperCase());
    if (q("ep-fill")) q("ep-fill").oninput = (e) => setAttr(el, "fill", e.target.value.toUpperCase());
    if (q("ep-stroke")) q("ep-stroke").oninput = (e) => setAttr(el, "stroke", e.target.value.toUpperCase());
    if (q("ep-sw")) q("ep-sw").onchange = (e) => setAttr(el, "stroke-width", e.target.value);
  }
  function syncOverlay() {
    if (!selected) return;
    const hr = holder().getBoundingClientRect();
    const r = selected.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: r.left - hr.left + "px", top: r.top - hr.top + "px",
      width: r.width + "px", height: r.height + "px",
    });
  }

  // ---- 拖动 ----
  let dragging = false, last = null, start = null, t0 = "";

  function down(e) {
    if (!editing) return;
    const unit = unitOf(e.target);
    if (!unit) { deselect(); return; }
    select(unit);
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    // 记住进入拖动前有没有 transform（M4.1 我们自己只写 translate）
    t0 = unit.getAttribute("transform") || "";
    start = t0;
    unit.setPointerCapture && unit.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function translateOf(t) {
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t || "");
    return m ? [+m[1], +m[2]] : [0, 0];
  }

  function move(e) {
    if (!dragging || !selected) return;
    const [ox, oy] = translateOf(start);
    // 屏幕位移 → SVG 坐标（经 CTM 逆变换，缩放/窗口尺寸无关——ppt-master 同款思路）
    const svg = svgEl();
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const p1 = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    const p0 = new DOMPoint(last.x, last.y).matrixTransform(inv);
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    last = { x: e.clientX, y: e.clientY };
    const [tx, ty] = translateOf(selected.getAttribute("transform"));
    selected.setAttribute("transform", `translate(${tx + dx} ${ty + dy})`);
    syncOverlay();
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    const t = selected ? selected.getAttribute("transform") : "";
    if (t && t !== start) {
      const [a1, b1] = translateOf(start);
      const [a2, b2] = translateOf(t);
      ops.push({ type: 'move', el: selected, dx: a2 - a1, dy: b2 - a1, prevT: start });
    }
  }

  // ---- 撤销（本会话 LIFO；M4.3 接 staged 落盘） ----
  function undo() {
    const op = ops.pop();
    if (!op) return;
    if (op.type === "add") { op.el.remove(); deselect(); return; }
    if (op.type === "del") { op.parent.insertBefore(op.el, op.next); return; }
    if (op.type === "attr") {
      if (op.attr === "#text") { op.el.textContent = op.old ?? op.new; }
      else if (op.old === null) op.el.removeAttribute(op.attr);
      else op.el.setAttribute(op.attr, op.old);
    } else {
      op.el.setAttribute("transform", op.prevT || "");
    }
    if (selected === op.el) { syncOverlay(); buildPanel(); }
  }
  function setAttr(el, attr, val) {
    ops.push({ type: "attr", el, attr, old: el.getAttribute(attr), new: val });
    el.setAttribute(attr, val);
  }

  holder().addEventListener("dblclick", (e) => {
    if (!editing) return;
    const t = e.target.closest("text, tspan");
    if (t) {
      const unit = unitOf(t);
      if (unit) select(unit);
      const ta = panel && (panel.querySelector("[data-edit-t]") || panel.querySelector("#ep-text"));
      if (ta) { ta.focus(); ta.select && ta.select(); }
    }
  });

  // ---------- M4.6 拖角缩放（右下柄，等比） ----------
  const handle = document.createElement("div");
  handle.id = "ed-handle";
  handle.title = "拖动缩放";
  holder().appendChild(handle);
  handle.hidden = true;
  function placeHandle() {
    if (!selected) { handle.hidden = true; return; }
    handle.hidden = false;
    const r = selected.getBoundingClientRect(), hr = holder().getBoundingClientRect();
    Object.assign(handle.style, {
      left: r.left - hr.left + r.width - 7 + "px",
      top: r.top - hr.top + r.height - 7 + "px",
    });
  }
  const origSync = syncOverlay;
  syncOverlay = () => { origSync(); placeHandle(); };

  let sizing = false, s0 = null, b0 = null, snap = [];
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!selected) return;
    sizing = true;
    s0 = { x: e.clientX, y: e.clientY };
    const r = selected.getBoundingClientRect();
    b0 = { w: Math.max(r.width, 12), h: Math.max(r.height, 12) };
    // 快照属性（撤销+回滚用）
    snap = attrsOf().map(([el, k]) => [el, k, el.getAttribute(k)]);
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!sizing || !selected) return;
    const k = Math.max(0.2, Math.min(6, 1 + (e.clientX - s0.x) / b0.w));
    applyScale(k);
    syncOverlay();
  });
  handle.addEventListener("pointerup", () => {
    if (!sizing) return;
    sizing = false;
    for (const [el, k, old] of snap) {
      const now = el.getAttribute(k);
      if (now !== old) ops.push({ type: "attr", el, attr: k, old, new: now });
    }
  });
  function attrsOf() {
    const t = selected.tagName.toLowerCase(), out = [];
    const want = { rect: ["x","y","width","height"], image: ["x","y","width","height"],
      ellipse: ["cx","cy","rx","ry"], circle: ["cx","cy","r"], text: ["font-size"],
      line: ["x1","y1","x2","y2"] }[t] || [];
    if (t === "text") out.push([selected, "font-size"]);
    for (const k of want) out.push([selected, k]);
    return out;
  }
  function applyScale(k) {
    const el = selected, t = el.tagName.toLowerCase();
    const g = (a) => parseFloat(el.getAttribute(a));
    const st = (a, v) => el.setAttribute(a, +(v.toFixed(1)));
    if (t === "rect" || t === "image") {
      st("width", g("width") / lastK * k); st("height", g("height") / lastK * k);
    } else if (t === "ellipse") { st("rx", g("rx") / lastK * k); st("ry", g("ry") / lastK * k); }
    else if (t === "circle") { st("r", g("r") / lastK * k); }
    else if (t === "text") { st("font-size", g("font-size") / lastK * k); }
    else if (t === "line") {
      st("x2", g("x1") + (g("x2") - g("x1")) / lastK * k);
      st("y2", g("y1") + (g("y2") - g("y1")) / lastK * k);
    } else { /* path/g/polygon：留给 ✦美化 */ }
    lastK = k;
  }
  let lastK = 1;
  handle.addEventListener("pointerdown", () => { lastK = 1; });

  // ---------- M4.4 新建/删除/插图 ----------
  const bar = document.createElement("div");
  bar.id = "ed-toolbar";
  bar.innerHTML = ["文本", "矩形", "圆", "线"].map((t) =>
    `<button class="vbtn" data-new="${t}">＋${t}</button>`).join("") +
    `<button class="vbtn" id="ed-img">＋图片</button><input type="file" id="ed-file" accept="image/*" hidden>` +
    `<button class="vbtn" id="ed-beautify" title="把选中的粗画结构交给 agent 按图形配方重画（拓扑保真）">✦ 美化选中</button>`;
  btn.before(bar);
  const NS = "http://www.w3.org/2000/svg";
  let uid = 0;

  function rootGroups(svg) {
    return [...svg.children].filter((c) => c.tagName === "g" && c.getAttribute("data-pptx-bounds"));
  }
  function boundsOf(g) {
    return g.getAttribute("data-pptx-bounds").split(" ").map(Number);
  }
  function intersects(a, b) {
    return !(a[0] + a[2] <= b[0] + 1 || b[0] + b[2] <= a[0] + 1 ||
             a[1] + a[3] <= b[1] + 1 || b[1] + b[3] <= a[1] + 1);
  }
  // 落点：先找包含点的语义组（归入其内部，不占新区）；否则找不与任何组重叠的空位
  function hostFor(svg, x, y, w, h) {
    for (const g of rootGroups(svg)) {
      const b = boundsOf(g);
      if (x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]) return g;
    }
    let ny = Math.min(Math.max(y, 8), 700 - h);
    for (let tries = 0; tries < 90; tries++, ny += 8) {
      const box = [x, ny, w, h];
      if (!rootGroups(svg).some((g) => intersects(box, boundsOf(g)))) {
        const g = document.createElementNS(NS, "g");
        g.id = `user-new-${++uid}`;
        g.setAttribute("data-pptx-bounds", box.join(" "));
        svg.appendChild(g);
        return g;
      }
    }
    return null;
  }
  function insert(el, w, h) {
    const svg = svgEl();
    if (!svg) return;
    const host = hostFor(svg, 620 - w / 2, 340 - h / 2, w, h);
    if (!host) { alert("找不到不重叠的空位"); return; }
    host.appendChild(el);
    ops.push({ type: "add", el, parent: host });
    select(el);
  }
  bar.querySelectorAll("[data-new]").forEach((b) => b.onclick = () => {
    if (!svgEl()) return;
    const t = b.dataset.new;
    if (t === "文本") {
      const e = document.createElementNS(NS, "text");
      e.setAttribute("x", 620); e.setAttribute("y", 350);
      e.setAttribute("font-size", 20); e.setAttribute("fill", "#1D2430");
      e.textContent = "新文本";
      insert(e, 80, 26);
    } else if (t === "矩形") {
      const e = document.createElementNS(NS, "rect");
      e.setAttribute("x", 560); e.setAttribute("y", 320);
      e.setAttribute("width", 120); e.setAttribute("height", 60);
      e.setAttribute("fill", "#F5F7FA"); e.setAttribute("stroke", "#1F4E79");
      e.setAttribute("stroke-width", 1.5);
      insert(e, 120, 60);
    } else if (t === "圆") {
      const e = document.createElementNS(NS, "ellipse");
      e.setAttribute("cx", 620); e.setAttribute("cy", 350);
      e.setAttribute("rx", 45); e.setAttribute("ry", 45);
      e.setAttribute("fill", "#F5F7FA"); e.setAttribute("stroke", "#1F4E79");
      e.setAttribute("stroke-width", 1.5);
      insert(e, 90, 90);
    } else if (t === "线") {
      const e = document.createElementNS(NS, "line");
      e.setAttribute("x1", 560); e.setAttribute("y1", 350);
      e.setAttribute("x2", 680); e.setAttribute("y2", 350);
      e.setAttribute("stroke", "#1F4E79"); e.setAttribute("stroke-width", 2);
      insert(e, 120, 2);
    }
  });
  bar.querySelector("#ed-img").onclick = () => bar.querySelector("#ed-file").click();
  bar.querySelector("#ed-file").onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const p = state.pages[state.cur];
    const r = await fetch(`/api/task/${state.task}/asset`, { method: "POST", body: fd });
    const d = await r.json();
    if (!d.ok) { alert(d.error); return; }
    const e = document.createElementNS(NS, "image");
    e.setAttribute("href", `../images/${d.name}`);
    const ratio = 4 / 3;
    e.setAttribute("x", 560); e.setAttribute("y", 320);
    e.setAttribute("width", 160); e.setAttribute("height", 160 / ratio);
    e.setAttribute("preserveAspectRatio", "xMidYMid meet");
    insert(e, 160, 120);
    ev.target.value = "";
  };
  // ✦ 美化选中：结构契约（元素id/类型/文字）进意见队列，agent 按 diagram-recipe 重画
  bar.querySelector("#ed-beautify").onclick = async () => {
    if (!selected) { alert("先点选要美化的元素/组"); return; }
    const el = selected;
    const desc = `✦美化 ${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}：` +
      (el.textContent || "").trim().slice(0, 40);
    const p = state.pages[state.cur];
    const r = await fetch(`/api/task/${state.task}/page/${p.page}/request`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: desc + "（按当前模板图形配方重画，拓扑保真）" }),
    });
    const d = await r.json();
    if (d.ok) { alert("已提交美化请求（进入队列，agent 消化后横幅提醒）"); window.refreshPendingCount(); }
  };

  function del() {
    if (!selected) return;
    let el = selected, parent = el.parentNode;
    // 删根组=删整单元；内部元素只删自己
    ops.push({ type: "del", el, parent, next: el.nextSibling });
    el.remove();
    deselect();
  }

  document.addEventListener("keydown", (e) => {
    if (!editing) return;
    if (e.key === "Escape") deselect();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    if (e.key === "Delete" && selected) { /* M4.3：删除 */}
  });
})();
