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
      ops.push({ el: selected, dx: a2 - a1, dy: b2 - a1, prevT: start });
    }
  }

  // ---- 撤销（本会话 LIFO；M4.3 接 staged 落盘） ----
  function undo() {
    const op = ops.pop();
    if (!op) return;
    op.el.setAttribute("transform", op.prevT || "");
    if (selected === op.el) syncOverlay();
  }

  document.addEventListener("keydown", (e) => {
    if (!editing) return;
    if (e.key === "Escape") deselect();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    if (e.key === "Delete" && selected) { /* M4.3：删除 */}
  });
})();
