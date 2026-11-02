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
    buildProps();
    syncOverlay();
  }
  function deselect() {
    closeTextEdit(true);
    if (selected) selected.classList.remove("ed-sel");
    selected = null;
    $("svgbox").classList.remove("has-sel");
    $("selbox").hidden = true;
    $("props").hidden = true;
  }
  function syncOverlay() {
    if (!selected || !selected.isConnected) return;
    const host = $("draft-slide").getBoundingClientRect(), r = selected.getBoundingClientRect();
    Object.assign($("selbox").style, { left: r.left - host.left - 3 + "px", top: r.top - host.top - 3 + "px",
      width: r.width + 6 + "px", height: r.height + 6 + "px" });
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
    h += `<button data-a="del" title="删除（Delete）">删除</button>`;
    pr.innerHTML = h;
    pr.hidden = false;
  }

  function applyColor(c) {
    c = c.toUpperCase();                                  // 方言要求全大写 #RRGGBB
    const ts = textsIn(selected);
    snapshot("color:" + (selected.id || ""));
    if (ts.length) ts.forEach((t) => t.setAttribute("fill", c));
    else shapesIn(selected).forEach((s) => s.setAttribute(paintAttr(s), c));
    touch(selected); changed();
  }

  $("props").addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]"), sw = e.target.closest("[data-c]");
    if (!selected || (!a && !sw)) return;
    if (sw) { applyColor(sw.dataset.c); return; }
    const act = a.dataset.a;
    if (act === "del") { removeSelected(); return; }
    const ts = textsIn(selected);
    if (act === "bold") {
      const on = !a.classList.contains("on");
      snapshot();
      ts.forEach((t) => setBold(t, on));
    } else {
      snapshot("fs:" + (selected.id || ""));
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
    const el = selected;
    const root = rootOf(el);
    deselect();
    el.remove();
    if (root && root !== el) touch(root);
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
    const id = selected && selected.id;
    svg.innerHTML = undo.pop();
    lastKey = "";
    svg.querySelectorAll(".ed-sel").forEach((n) => n.classList.remove("ed-sel"));
    selected = null;
    $("props").hidden = true;
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
    // 指针捕获推迟到真正开始拖：按下就捕获的话，接下来的 dblclick 会被改投给画布容器，双击改字就找不到文字了
    drag = { el: u, p0, t0: tf(u), moved: false, pointerId: e.pointerId };
  });
  $("svgbox").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toParent(drag.el, e.clientX, e.clientY);
    const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;   // 手抖不算拖
    if (!drag.moved) {
      snapshot(); drag.moved = true; $("props").hidden = true;   // 拖动时属性条让开
      $("svgbox").setPointerCapture(drag.pointerId);              // 拖出画布也能继续跟手
    }
    setTf(drag.el, drag.t0.x + dx, drag.t0.y + dy);
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
    if (k === "Escape" && selected) { deselect(); return true; }
    if ((k === "Delete" || k === "Backspace") && selected) { e.preventDefault(); removeSelected(); return true; }
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
