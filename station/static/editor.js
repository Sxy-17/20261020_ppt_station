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
    closeTextEdit(false);   // 调用方已经处理过保存/放弃；这里不再提交，免得改动落到下一页的状态里
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
  // 点到的东西 → 可选对象。
  // 默认 = 鼠标下那个"将来导出成一个 PPT 形状"的对象（一个文字框、一个框、一条线）：
  //   用户要逐个文字框改属性、逐个框拖动（P3 目录每行、P7 流程图每个框）；旧版默认选整个根级组，只能整体改
  // whole = true（Alt+单击 / 属性条「整组」）= 它所在的根级语义组
  function unitOf(node, whole) {
    if (!svg || !svg.contains(node) || node === svg) return null;
    let el = node.tagName === "tspan" ? node.closest("text") : node;
    if (whole) el = rootOf(el);
    if (!el || el === svg || isBackground(el) || el.closest("defs")) return null;
    return el;
  }

  /* ---------- 框带着框里的东西走 ---------- */
  // 稿里的流程图框常是"一个 rect + 叠在上面的几行字"，彼此是兄弟、没有成组；
  // 只挪 rect 字会留在原地。所以选中能装东西的形状时，完全落在它里面的对象一起移动/删除
  const CONTAINER = "rect, ellipse, circle, polygon";
  const LEAF = "text, rect, ellipse, circle, polygon, polyline, path, line, image";
  function followersOf(el) {
    if (!el.matches(CONTAINER) || el.parentNode === svg) return [];
    const [x, y, w, h] = canvasBox(el), tol = 2;
    if (w < 8 || h < 8) return [];
    const root = rootOf(el), out = [];
    for (const c of root.querySelectorAll(LEAF)) {
      if (c === el || c.closest("defs") || isBackground(c)) continue;
      if (c.parentNode.closest && c.parentNode.closest("text")) continue;
      const [cx, cy, cw, ch] = canvasBox(c);
      if (cw * ch >= w * h) continue;                       // 比自己大的不算"里面的"（防两个同尺寸框互相带）
      if (cx >= x - tol && cy >= y - tol && cx + cw <= x + w + tol && cy + ch <= y + h + tol) out.push(c);
    }
    return out;
  }
  let followers = [];
  const moving = () => (selected ? [selected, ...followers] : []);

  /* ---------- 细线好点中（R7）：鼠标落在背景上时，在附近几像素内找线 ---------- */
  // 箭头、连线常只有 1~2px，要点得很准；这里给线临时加粗做命中测试（不改稿件），找最上面那条
  const NEAR_PX = 6;
  function nearStroke(cx, cy) {
    const cands = [...svg.querySelectorAll("line, polyline, path")].filter((el) => !el.closest("defs"));
    for (let i = cands.length - 1; i >= 0; i--) {
      const el = cands[i], m = el.getScreenCTM();
      if (!m || !m.a) continue;
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      const sw = parseFloat(getComputedStyle(el).strokeWidth) || 1;
      // 容差换算到元素自己的坐标单位：m.a = 元素坐标 1 单位在屏幕上占几像素（缩放后也对）
      el.style.strokeWidth = sw + (2 * NEAR_PX) / m.a + "px";
      const hit = el.isPointInStroke(p);
      el.style.strokeWidth = "";
      if (hit) return el;
    }
    return null;
  }

  /* ---------- 线 / 箭头的点（R7）：端点 + 曲线弯度控制点 ---------- */
  // path 只认稿里实际出现的绝对坐标命令 M L C Q（生成器只写这几种）；遇到别的命令不出手柄，只能整体挪
  function pointsOf(el) {
    const t = el.tagName;
    if (t === "line") return [
      { x: +el.getAttribute("x1"), y: +el.getAttribute("y1"), kind: "end" },
      { x: +el.getAttribute("x2"), y: +el.getAttribute("y2"), kind: "end" }];
    if (t === "polyline") {
      const n = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1], kind: "end" });
      return pts;
    }
    if (t === "path") {
      const d = el.getAttribute("d") || "";
      if (!/^[\sMLCQ0-9.,eE+-]+$/.test(d)) return [];
      const segs = [...d.matchAll(/([MLCQ])([^MLCQ]*)/g)];
      const pts = [];
      for (const [, cmd, args] of segs) {
        const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
        for (let i = 0; i + 1 < n.length; i += 2) {
          const last = i + 2 >= n.length;
          // C/Q 的最后一对是落点，前面的是弯度控制点
          pts.push({ x: n[i], y: n[i + 1], kind: (cmd === "C" || cmd === "Q") && !last ? "ctrl" : "end", cmd, first: i === 0 });
        }
      }
      return pts;
    }
    return [];
  }
  function setPoints(el, pts) {
    const r = (v) => round(v);
    const t = el.tagName;
    if (t === "line") {
      el.setAttribute("x1", r(pts[0].x)); el.setAttribute("y1", r(pts[0].y));
      el.setAttribute("x2", r(pts[1].x)); el.setAttribute("y2", r(pts[1].y));
    } else if (t === "polyline") {
      el.setAttribute("points", pts.map((p) => `${r(p.x)},${r(p.y)}`).join(" "));
    } else if (t === "path") {
      let d = "";
      for (const p of pts) d += (p.first ? (d ? " " : "") + p.cmd : "") + ` ${r(p.x)} ${r(p.y)}`;
      el.setAttribute("d", d.trim().replace(/([MLCQ]) /g, "$1"));
    }
  }

  /* ---------- 箭头头部跟着线变色（R7） ---------- */
  // 头部是 <defs> 里单独定义的 marker，颜色写死。改线色时为新颜色复制一份 marker 换上，
  // 结构照抄原 marker（引擎的 marker 三角契约不变），只改颜色
  function markerFor(id, color) {
    const base = svg.getElementById(id);
    if (!base) return id;
    const rootId = id.replace(/-c[0-9A-F]{6}$/, "");
    const nid = `${rootId}-c${color.slice(1)}`;
    if (!svg.getElementById(nid)) {
      const m = (svg.getElementById(rootId) || base).cloneNode(true);
      m.id = nid;
      for (const s of m.querySelectorAll("*")) {
        if (s.getAttribute("fill") && s.getAttribute("fill") !== "none") s.setAttribute("fill", color);
        if (s.getAttribute("stroke") && s.getAttribute("stroke") !== "none") s.setAttribute("stroke", color);
      }
      base.parentNode.appendChild(m);
    }
    return nid;
  }
  function recolorMarkers(el, color) {
    for (const a of ["marker-start", "marker-end", "marker-mid"]) {
      const v = el.getAttribute(a), m = v && /url\(#([^)]+)\)/.exec(v);
      if (m) el.setAttribute(a, `url(#${markerFor(m[1], color)})`);
    }
  }

  // 选中关系在撤销后要能找回来：记"从 <svg> 往下的子节点序号路径"（叶子对象大多没有 id）
  function pathOf(el) { const p = []; while (el && el !== svg) { p.unshift([...el.parentNode.children].indexOf(el)); el = el.parentNode; } return p; }
  function byPath(p) { let el = svg; for (const i of p) { el = el && el.children[i]; } return el && el !== svg ? el : null; }

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
    followers = followersOf(el);
    for (const m of moving()) m.classList.add("ed-sel");
    $("svgbox").classList.add("has-sel");
    $("selbox").hidden = false;
    buildProps();
    syncOverlay();
  }
  function deselect() {
    closeTextEdit(true);
    for (const m of moving()) m.classList.remove("ed-sel");
    selected = null;
    followers = [];
    $("svgbox").classList.remove("has-sel");
    $("selbox").hidden = true;
    $("props").hidden = true;
    document.querySelectorAll(".selfollow, .hdl").forEach((n) => n.remove());
  }

  /* ---------- 手柄（R7）：缩放 / 端点 / 弯度 ---------- */
  const RESIZABLE = ["rect", "image", "ellipse", "circle", "text"];
  let handleDrag = false;    // 拖手柄期间不重画手柄以外的东西（属性条让开）
  function drawHandles(host) {
    document.querySelectorAll(".hdl").forEach((n) => n.remove());
    if (!selected || drag && drag.moved) return;
    const el = selected, pts = pointsOf(el);
    const mk = (kind, x, y, idx) => {
      const h = document.createElement("div");
      h.className = `hdl ${kind}`;
      h.style.left = x + "px"; h.style.top = y + "px";
      h.title = kind === "size" ? "拖动缩放（Shift 等比）" : kind === "ctrl" ? "拖动调弯度" : "拖动改端点（Shift 水平/垂直）";
      h.addEventListener("pointerdown", (e) => startHandle(e, kind, idx));
      $("draft-slide").appendChild(h);
    };
    if (pts.length) {
      const m = el.getScreenCTM();
      pts.forEach((p, i) => { const s = new DOMPoint(p.x, p.y).matrixTransform(m); mk(p.kind, s.x - host.left, s.y - host.top, i); });
    } else if (RESIZABLE.includes(el.tagName)) {
      const r = el.getBoundingClientRect();
      mk("size", r.right - host.left + 3, r.bottom - host.top + 3);
    }
  }
  const toLocal = (el, cx, cy) => new DOMPoint(cx, cy).matrixTransform(el.getScreenCTM().inverse());
  const num = (el, a) => parseFloat(el.getAttribute(a)) || 0;

  function startHandle(e, kind, idx) {
    e.preventDefault(); e.stopPropagation();
    const el = selected;
    if (!el) return;
    snapshot();
    handleDrag = true;
    $("props").hidden = true;
    const p0 = toLocal(el, e.clientX, e.clientY);
    // 起点状态：之后每一步都从起点算，不累积误差
    const pts0 = pointsOf(el);
    const a0 = { w: num(el, "width"), h: num(el, "height"), rx: num(el, "rx"), ry: num(el, "ry"), r: num(el, "r"),
                 cx: num(el, "cx"), cy: num(el, "cy") };
    const fs0 = el.tagName === "text"
      ? [el, ...el.querySelectorAll("tspan[font-size]")].map((t) => [t, fontSizeOf(t)]) : [];
    const bw0 = el.tagName === "text" ? Math.max(1, el.getBBox().width) : 1;

    const onMove = (ev) => {
      const p = toLocal(el, ev.clientX, ev.clientY), dx = p.x - p0.x, dy = p.y - p0.y;
      const t = el.tagName;
      if (kind !== "size") {
        const pts = pts0.map((q) => ({ ...q }));
        let nx = pts0[idx].x + dx, ny = pts0[idx].y + dy;
        if (ev.shiftKey && kind === "end" && pts.length >= 2) {
          // 以相邻点为基准拉成水平或垂直
          const o = pts0[idx === 0 ? 1 : idx - 1];
          if (Math.abs(nx - o.x) > Math.abs(ny - o.y)) ny = o.y; else nx = o.x;
        }
        pts[idx].x = nx; pts[idx].y = ny;
        setPoints(el, pts);
      } else if (t === "rect" || t === "image") {
        let w = Math.max(4, a0.w + dx), h = Math.max(4, a0.h + dy);
        if (t === "image" || ev.shiftKey) { const k = Math.max(w / a0.w, h / a0.h); w = a0.w * k; h = a0.h * k; }   // 图片默认等比，免得拉变形
        el.setAttribute("width", round(w)); el.setAttribute("height", round(h));
      } else if (t === "ellipse") {
        let rx = Math.max(2, a0.rx + dx / 2), ry = Math.max(2, a0.ry + dy / 2);
        if (ev.shiftKey) { const k = Math.max(rx / a0.rx, ry / a0.ry); rx = a0.rx * k; ry = a0.ry * k; }
        // 左上角不动：半径变了，圆心跟着挪
        el.setAttribute("rx", round(rx)); el.setAttribute("ry", round(ry));
        el.setAttribute("cx", round(a0.cx + rx - a0.rx)); el.setAttribute("cy", round(a0.cy + ry - a0.ry));
      } else if (t === "circle") {
        const r = Math.max(2, a0.r + Math.max(dx, dy) / 2);
        el.setAttribute("r", round(r));
        el.setAttribute("cx", round(a0.cx + r - a0.r)); el.setAttribute("cy", round(a0.cy + r - a0.r));
      } else if (t === "text") {
        // 文字框缩放 = 按横向拉伸比例改字号（自带字号的强调片段同比例）
        const k = Math.max(0.3, (bw0 + dx) / bw0);
        for (const [n, f] of fs0) n.setAttribute("font-size", Math.max(6, Math.round(f * k)));
      }
      syncOverlay();
    };
    const onUp = () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      handleDrag = false;
      touch(el);
      changed();
      buildProps(); syncOverlay();
    };
    // 监听挂在 window 上：手柄每一步都会重画，挂在手柄自己身上会丢事件
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  }

  /* ---------- 新建：文本 / 矩形 / 图片（R7） ---------- */
  // 落点 = 右栏当前看得见的那块画布的中心（放大后也是看着的地方）
  function dropPoint() {
    const sc = $("draft-scroll").getBoundingClientRect(), sl = $("draft-slide").getBoundingClientRect();
    const cx = (Math.max(sc.left, sl.left) + Math.min(sc.right, sl.right)) / 2;
    const cy = (Math.max(sc.top, sl.top) + Math.min(sc.bottom, sl.bottom)) / 2;
    return new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
  }
  // 落点在哪个语义组的格子里就归进哪个组（取最小的）；都不在就自立新组
  function hostAt(p) {
    let best = null, area = Infinity;
    for (const g of svg.children) {
      const b = g.getAttribute && g.getAttribute("data-pptx-bounds");
      if (!b || isBackground(g)) continue;
      const [x, y, w, h] = b.trim().split(/[\s,]+/).map(Number);
      if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h && w * h < area) { best = g; area = w * h; }
    }
    return best;
  }
  // 新建的东西默认用本页已有的颜色，不突兀。
  // pick="dark"：取本页用过的最深的颜色——正文色几乎总是最深的；按"出现最多"会选到编号/日期的点缀色（P3 实测）
  // pick="common"：取出现最多的（线色、框色这类没有"正文"概念的）
  function pageColor(sel, attr, fallback, pick) {
    const n = new Map();
    for (const el of svg.querySelectorAll(sel)) {
      if (el.closest("defs")) continue;
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec((getComputedStyle(el)[attr] || "").trim());
      if (!m) continue;
      const hex = "#" + m.slice(1, 4).map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase();
      if (hex !== "#FFFFFF") n.set(hex, (n.get(hex) || 0) + 1);
    }
    const all = [...n.entries()];
    if (!all.length) return fallback;
    const lum = (h) => { const v = parseInt(h.slice(1), 16); return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255); };
    all.sort(pick === "dark" ? (a, b) => lum(a[0]) - lum(b[0]) : (a, b) => b[1] - a[1]);
    return all[0][0];
  }
  const NS = "http://www.w3.org/2000/svg";
  function make(tag, attrs) { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
  function insert(el) {
    snapshot();
    const host = hostAt(dropPoint());
    if (host) {
      host.appendChild(el);
      touch(host);
    } else {
      const g = make("g", { id: `user-${Date.now().toString(36)}` });
      g.appendChild(el);
      svg.appendChild(g);
      const [x, y, w, h] = canvasBox(el);
      g.setAttribute("data-pptx-bounds", [x - 4, y - 4, w + 8, h + 8].map(round).join(" "));
      g.dataset.edGrow = "1";
    }
    changed();
    select(el);
  }
  $("add").addEventListener("click", (e) => { e.stopPropagation(); $("addmenu").hidden = !$("addmenu").hidden; });
  document.addEventListener("click", (e) => { if (!$("addmenu").contains(e.target) && e.target !== $("add")) $("addmenu").hidden = true; });
  $("addmenu").addEventListener("click", (e) => {
    const k = e.target.dataset && e.target.dataset.new;
    if (!k || !svg) return;
    $("addmenu").hidden = true;
    const p = dropPoint();
    if (k === "text") {
      const t = make("text", { x: round(p.x - 40), y: round(p.y + 8), "font-size": 22,
        fill: pageColor("text", "fill", "#1D2430", "dark") });
      t.textContent = "新文本";
      insert(t);
      openTextEdit(t.firstChild);                 // 新建文字直接进入改字
    } else if (k === "rect") {
      // 默认只描边不填充：新框画在最上层，填白会把底下的字盖住
      insert(make("rect", { x: round(p.x - 120), y: round(p.y - 60), width: 240, height: 120, rx: 8,
        fill: "none", stroke: pageColor("rect, line, path", "stroke", "#1F4E79", "common"), "stroke-width": 1.8 }));
    } else if (k === "image") {
      $("file").click();
    }
  });
  $("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !svg) return;
    const fd = new FormData();
    fd.append("file", f);
    let d;
    try { d = await (await fetch(api("/asset"), { method: "POST", body: fd })).json(); }
    catch { say("图片没传上：服务器连不上", true); return; }
    if (!d.ok) { say(`图片没传上：${d.error}`, true); return; }
    // 稿里写 ../images/<名>：与导出搬运规则一致（export.py 从 <任务>/images/ 取）
    const href = `../images/${d.name}`;
    const im = new Image();
    im.onload = () => {
      const p = dropPoint();
      const w = Math.min(360, im.naturalWidth || 360), h = w * (im.naturalHeight || 1) / (im.naturalWidth || 1);
      insert(make("image", { href, x: round(p.x - w / 2), y: round(p.y - h / 2), width: round(w), height: round(h),
        preserveAspectRatio: "xMidYMid meet" }));
    };
    im.onerror = () => say("图片传上了但读不出来", true);
    im.src = new URL(href, location.href).href;
  });
  function syncOverlay() {
    if (!selected || !selected.isConnected) return;
    const host = $("draft-slide").getBoundingClientRect(), r = selected.getBoundingClientRect();
    Object.assign($("selbox").style, { left: r.left - host.left - 3 + "px", top: r.top - host.top - 3 + "px",
      width: r.width + 6 + "px", height: r.height + 6 + "px" });
    // 跟着走的对象：细虚线框，让用户看清"拖这个框会带走哪些"
    document.querySelectorAll(".selfollow").forEach((n) => n.remove());
    for (const f of followers) {
      const fr = f.getBoundingClientRect(), d = document.createElement("div");
      d.className = "selfollow";
      Object.assign(d.style, { left: fr.left - host.left - 1 + "px", top: fr.top - host.top - 1 + "px",
        width: fr.width + 2 + "px", height: fr.height + 2 + "px" });
      $("draft-slide").appendChild(d);
    }
    drawHandles(host);
    // 属性条放在选中框上方，不盖住任何内容：画布内上方放不下（比如选了贴顶的标题）
    // 就借用画布上沿外面的留白；留白也不够才放到下方。水平方向不出画布
    const pr = $("props");
    if (pr.hidden) return;
    const pane = $("draft-pane").getBoundingClientRect();
    const minTop = -(host.top - pane.top - 4);          // 画布上沿以外还能用的高度（负数 = 画布外）
    const top = r.top - host.top - pr.offsetHeight - 10;
    pr.style.top = (top >= minTop ? top : r.bottom - host.top + 10) + "px";
    pr.style.left = Math.max(0, Math.min(r.left - host.left, host.width - pr.offsetWidth)) + "px";
  }
  ed.syncOverlay = syncOverlay;

  /* ---------- 浮动属性条：字号 / 加粗 / 颜色 / 删除（R6） ---------- */
  // 选中范围里的文字：选的是 <text> 就是它自己；选的是组就是组里所有 <text>
  function textsIn(el) { return el.tagName === "text" ? [el] : [...el.querySelectorAll("text")]; }
  // 选中范围里可上色的形状：有填充的改填充，只有描边的（线、空心框）改描边
  function shapesIn(el) {
    const SHAPES = "rect, circle, ellipse, polygon, polyline, path, line";
    return (el.matches(SHAPES) ? [el] : [...el.querySelectorAll(SHAPES)]).filter((s) => !isBackground(s));
  }
  function paintAttr(s) {
    const f = s.getAttribute("fill");
    return s.tagName === "line" || s.tagName === "polyline" || f === "none" ? "stroke" : "fill";
  }
  function fontSizeOf(t) { return parseFloat(t.getAttribute("font-size")) || parseFloat(getComputedStyle(t).fontSize) || 18; }

  // 一行里"有字的片段"：直接写在 <text> 里的字算 <text> 自己，写在 tspan 里的算那个 tspan
  function inkPieces(t) {
    const out = [];
    if ([...t.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) out.push(t);
    for (const s of t.querySelectorAll("tspan"))
      if ([...s.childNodes].some((n) => n.nodeType === 3 && n.data.trim())) out.push(s);
    return out;
  }
  const weightOf = (el) => parseInt(getComputedStyle(el).fontWeight, 10) || 400;
  // 看实际渲染出来的粗细：稿里加粗常写在 tspan 上，只看 <text> 的属性会判错
  function isBold(t) { const ps = inkPieces(t); return ps.length > 0 && ps.every((p) => weightOf(p) >= 600); }
  function setBold(t, on) {
    const w = on ? "bold" : "normal";
    const ps = inkPieces(t).filter((p) => p !== t);
    // 整行粗细一致：连同片段一起切；粗细混排（有行内强调）：只改外层，强调片段不碰
    const uniform = ps.every((p) => (weightOf(p) >= 600) === (weightOf(ps[0]) >= 600));
    t.setAttribute("font-weight", w);
    if (uniform) ps.forEach((p) => { if (p.hasAttribute("font-weight")) p.setAttribute("font-weight", w); });
  }

  // 候选色 = 本页已经在用的颜色（来自模板色板，比固定色盘更贴合整份稿）
  function pageColors() {
    const seen = new Map();
    for (const el of svg.querySelectorAll("[fill], [stroke]")) {
      if (isBackground(el)) continue;
      for (const a of ["fill", "stroke"]) {
        const c = (el.getAttribute(a) || "").toUpperCase();
        if (/^#[0-9A-F]{6}$/.test(c) && c !== "#FFFFFF") seen.set(c, (seen.get(c) || 0) + 1);
      }
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  }

  function buildProps() {
    const pr = $("props"), el = selected;
    const ts = textsIn(el), shapes = shapesIn(el);
    let h = "";
    if (ts.length) {
      const bold = ts.every(isBold);
      h += `<button data-a="fs-" title="减小字号">A−</button><span class="fs">${Math.round(fontSizeOf(ts[0]))}</span>` +
           `<button data-a="fs+" title="增大字号">A+</button>` +
           `<button data-a="bold" class="${bold ? "on" : ""}" title="加粗"><b>B</b></button><span class="sep"></span>`;
    }
    if (ts.length || shapes.length) {
      const what = ts.length ? "文字颜色" : "颜色";
      h += pageColors().map((c) => `<button class="sw" data-c="${c}" style="background:${c}" title="${what} ${c}"></button>`).join("");
      h += `<label class="pick" title="其他${what}"><input type="color" data-pick></label><span class="sep"></span>`;
    }
    h += `<button data-a="del" title="删除（Delete）${followers.length ? `，连同框里 ${followers.length} 个对象` : ""}">删除</button>`;
    // 选的是单个对象时，给一个跳到所在根级组的入口（等同 Alt+单击）
    if (el.parentNode !== svg && rootOf(el) && rootOf(el).getAttribute("data-pptx-bounds"))
      h += `<span class="sep"></span><button data-a="up" title="选中它所在的整组（Alt+单击）">整组</button>`;
    pr.innerHTML = h;
    pr.hidden = false;
  }

  function applyColor(c) {
    c = c.toUpperCase();                                  // 方言要求全大写 #RRGGBB
    const ts = textsIn(selected);
    snapshot("color:" + pathOf(selected).join("."));
    if (ts.length) ts.forEach((t) => t.setAttribute("fill", c));
    else shapesIn(selected).forEach((s) => {
      const a = paintAttr(s);
      s.setAttribute(a, c);
      if (a === "stroke") recolorMarkers(s, c);       // 箭头头部跟着变
    });
    touch(selected); changed();
  }

  $("props").addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]"), sw = e.target.closest("[data-c]");
    if (!selected || (!a && !sw)) return;
    if (sw) { applyColor(sw.dataset.c); return; }
    const act = a.dataset.a;
    if (act === "del") { removeSelected(); return; }
    if (act === "up") { select(rootOf(selected)); return; }
    const ts = textsIn(selected);
    if (act === "bold") {
      const on = !a.classList.contains("on");
      snapshot();
      ts.forEach((t) => setBold(t, on));
    } else {
      snapshot("fs:" + pathOf(selected).join("."));
      const d = act === "fs+" ? 2 : -2;
      for (const t of ts) {
        t.setAttribute("font-size", Math.max(8, Math.round(fontSizeOf(t) + d)));
        // 自带字号的 tspan（比如大号强调）跟着同步放缩，保持相对大小
        t.querySelectorAll("tspan[font-size]").forEach((s) => s.setAttribute("font-size", Math.max(8, Math.round(parseFloat(s.getAttribute("font-size")) + d))));
      }
    }
    touch(selected); changed(); buildProps(); syncOverlay();
  });
  $("props").addEventListener("input", (e) => { if (e.target.dataset.pick !== undefined && selected) applyColor(e.target.value); });

  function removeSelected() {
    if (!selected) return;
    snapshot();
    const els = moving();                      // 框连同框里的东西一起删（与拖动范围一致，Ctrl+Z 可恢复）
    const root = rootOf(selected);
    deselect();
    els.forEach((el) => el.remove());
    if (root && root.isConnected) touch(root);
    changed();
  }

  // 改了内容的根级组：保存时格子允许扩到装下新内容（字号变大、字变长）
  function rootOf(el) { while (el && el.parentNode !== svg) el = el.parentNode; return el; }
  function touch(el) { const r = rootOf(el); if (r && r.dataset) r.dataset.edGrow = "1"; }

  /* ---------- 双击原位改字（R6） ---------- */
  let editing = null;   // { node: 文字节点, input, old }
  // 对外："有没有用户还没落盘的东西"——正在打字（还没回车）也算，轮询不许此时重载右栏
  ed.busy = () => ed.dirty || !!editing;
  // 只改点中的那段文字节点：一行里可能夹着行内强调 tspan，整行替换会把强调抹掉
  function textNodeAt(target) {
    let el = target.closest("tspan, text");
    if (!el) return null;
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.data.trim());
    if (direct.length === 1) return direct[0];
    if (!direct.length) {
      // 点在只含子 tspan 的外层上：取第一个有字的叶子
      const leaf = [...el.querySelectorAll("tspan")].find((s) => [...s.childNodes].some((n) => n.nodeType === 3 && n.data.trim()));
      return leaf ? [...leaf.childNodes].find((n) => n.nodeType === 3 && n.data.trim()) : null;
    }
    return direct[0];
  }
  function openTextEdit(node) {
    closeTextEdit(true);
    const holder = node.parentNode;                       // tspan 或 text
    const host = $("draft-slide").getBoundingClientRect(), r = holder.getBoundingClientRect();
    const scale = svg.getScreenCTM().a;                   // 画布单位 → 屏幕像素
    const inp = document.createElement("input");
    inp.id = "textedit";
    inp.value = node.data.replace(/\u00a0/g, " ");        // NBSP 显示成空格，提交时行首再转回
    Object.assign(inp.style, {
      left: r.left - host.left - 3 + "px", top: r.top - host.top - 3 + "px",
      width: Math.max(r.width + 60, 140) + "px", height: r.height + 6 + "px",
      fontSize: fontSizeOf(holder.closest("text")) * scale + "px",
      fontWeight: getComputedStyle(holder).fontWeight,
    });
    $("draft-slide").appendChild(inp);
    editing = { node, input: inp, old: node.data };
    $("props").hidden = true;
    inp.focus(); inp.select();
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();                                // 打字时 1/2/3、方向键、Delete 都不归工作台
      if (e.key === "Enter" && !e.isComposing) closeTextEdit(true);
      if (e.key === "Escape") closeTextEdit(false);
    });
    inp.addEventListener("blur", () => closeTextEdit(true));
  }
  function closeTextEdit(commit) {
    if (!editing) return;
    const { node, input, old } = editing;
    editing = null;
    // 行首普通空格转 NBSP：普通空格导出时会被吞掉（ENGINEERING #10）
    const v = input.value.replace(/^ +/, (s) => "\u00a0".repeat(s.length));
    input.remove();
    if (commit && v !== old && node.isConnected) {
      snapshot();
      node.data = v;
      touch(node.parentNode);
      changed();
    }
    if (selected) { buildProps(); syncOverlay(); }
  }
  $("svgbox").addEventListener("dblclick", (e) => {
    if (!svg) return;
    // 按坐标重新命中：事件目标可能是被捕获改投的容器，不一定是鼠标下的文字
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const node = hit && svg.contains(hit) ? textNodeAt(hit) : null;
    if (node) openTextEdit(node);
  });

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
    const p = selected && pathOf(selected);
    svg.innerHTML = undo.pop();
    lastKey = "";
    svg.querySelectorAll(".ed-sel").forEach((n) => n.classList.remove("ed-sel"));
    selected = null; followers = [];
    $("props").hidden = true;
    const el = p && byPath(p);
    if (el) select(el); else deselect();
    changed();
  }

  /* ---------- 鼠标：单击选中；已选中再按住 = 拖动 ---------- */
  let drag = null;
  $("svgbox").addEventListener("pointerdown", (e) => {
    if (!svg || e.button !== 0) return;
    $("addmenu").hidden = true;
    let u = unitOf(e.target, e.altKey);
    // 点在背景/空白上：看看附近有没有细线（箭头、连线）
    if (!u || isBackground(e.target)) { const near = nearStroke(e.clientX, e.clientY); if (near) u = e.altKey ? rootOf(near) : near; }
    if (!u) { deselect(); return; }
    e.preventDefault();                         // 防止浏览器原生拖图片/选文字
    if (u !== selected) { select(u); return; }
    // 每个要动的对象各自记起点：它们可能在不同层的组里，位移要换算到各自父级坐标
    const items = moving().map((el) => ({ el, p0: toParent(el, e.clientX, e.clientY), t0: tf(el) }));
    // 指针捕获推迟到真正开始拖：按下就捕获的话，接下来的 dblclick 会被改投给画布容器，双击改字就找不到文字了
    drag = { items, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId };
  });
  $("svgbox").addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 3) return;   // 手抖不算拖
    if (!drag.moved) {
      snapshot(); drag.moved = true; $("props").hidden = true;   // 拖动时属性条让开
      $("svgbox").setPointerCapture(drag.pointerId);              // 拖出画布也能继续跟手
    }
    for (const it of drag.items) {
      const p = toParent(it.el, e.clientX, e.clientY);
      setTf(it.el, it.t0.x + p.x - it.p0.x, it.t0.y + p.y - it.p0.y);
    }
    syncOverlay();
  });
  $("svgbox").addEventListener("pointerup", () => {
    if (drag && drag.moved) { changed(); if (selected) { $("props").hidden = false; syncOverlay(); } }
    drag = null;
  });

  /* ---------- 键盘 ---------- */
  ed.handleKey = (e) => {
    if (!svg) return false;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); doUndo(); return true; }
    if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); ed.save(); return true; }
    if (k === "Escape" && !$("addmenu").hidden) { $("addmenu").hidden = true; return true; }
    if (k === "Escape" && selected) { deselect(); return true; }
    if ((k === "Delete" || k === "Backspace") && selected) { e.preventDefault(); removeSelected(); return true; }
    if (k.startsWith("Arrow") && selected && !ctrl) {
      // 选中时方向键 = 微调（1px，Shift 10px）；没选中时方向键仍是翻页
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      snapshot("nudge:" + pathOf(selected).join("."));
      for (const el of moving()) {
        const t = tf(el);
        setTf(el, t.x + (k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0),
                  t.y + (k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0));
      }
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
      if (g.querySelector("[data-ed-tx]") || g.dataset.edGrow) {
        // 组内元素挪过、或字号/文字改过：格子扩到装得下新内容（只扩不缩，免得内容超出格子）。
        // 扩大后若撞到别的组，质检会拦下并框红——那是真问题，交给用户决定怎么让
        const [bx, by, bw, bh] = canvasBox(g);
        const x2 = Math.max(x + w, bx + bw), y2 = Math.max(y + h, by + bh);
        x = Math.min(x, bx); y = Math.min(y, by); w = x2 - x; h = y2 - y;
      }
      g.setAttribute("data-pptx-bounds", [x, y, w, h].map(round).join(" "));
    }

    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".ed-sel").forEach((n) => n.classList.remove("ed-sel"));
    clone.querySelectorAll("[class='']").forEach((n) => n.removeAttribute("class"));
    clone.querySelectorAll("[data-ed-grow]").forEach((n) => delete n.dataset.edGrow);
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
