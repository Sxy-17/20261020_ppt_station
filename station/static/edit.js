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

  document.addEventListener("keydown", (e) => {
    if (!editing) return;
    if (e.key === "Escape") deselect();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    if (e.key === "Delete" && selected) { /* M4.3：删除 */}
  });
})();
