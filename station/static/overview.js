/* 总览模式（M3.2a）：缩略图网格 + 筛选片 + 懒加载
   缩略图 = draft 内联（有稿）否则 original.png；角标 = 裁决状态 */
"use strict";

(function () {
  const overviewEl = document.getElementById("overview");
  let anchorIdx = -1;   // shift 范围选择锚点（M3.2b 用）

  // ---- 模式切换 ----
  document.getElementById("mode-single").onclick = () => setMode("single");
  document.getElementById("mode-overview").onclick = () => setMode("overview");

  function setMode(m) {
    document.body.dataset.mode = m;
    if (m === "overview") buildFilterChips(), renderOverview();
  }
  window.setMode = setMode;   // 命令面板/胶片条复用

  // ---- 筛选 ----
  let curFilter = "all";
  function passesFilter(p) {
    switch (curFilter) {
      case "undone": return !p.verdict;
      case "pass": return p.verdict === "pass";
      case "keep": return p.verdict === "keep";
      case "redraw": return p.verdict === "redraw";
      case "star": return p.star;
      case "nodraft": return !p.has_draft;
      default: return true;
    }
  }
  function buildFilterChips() {
    const c = state.pages.reduce((a, p) => {
      a.all++; if (!p.verdict) a.undone++;
      if (p.verdict === "pass") a.pass++; if (p.verdict === "keep") a.keep++;
      if (p.verdict === "redraw") a.redraw++; if (p.star) a.star++;
      if (!p.has_draft) a.nodraft++;
      return a;
    }, {all:0, undone:0, pass:0, keep:0, redraw:0, star:0, nodraft:0});
    const chips = [
      ["all","全部"],["undone","未裁决"],["pass","✓通过"],["keep","▣保留"],
      ["redraw","✦重绘"],["star","★回看"],["nodraft","⏳未出稿"],
    ];
    const bar = document.getElementById("filter-chips");
    bar.innerHTML = "";
    for (const [key, label] of chips) {
      const b = document.createElement("button");
      b.className = "chip" + (curFilter === key ? " active" : "");
      b.textContent = `${label}·${c[key]}`;
      b.onclick = () => { curFilter = key; buildFilterChips(); renderOverview(); };
      bar.appendChild(b);
    }
  }

  // ---- 渲染网格（懒加载：IntersectionObserver 命中才填缩略图） ----
  function renderOverview() {
    overviewEl.innerHTML = "";
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        fillThumb(e.target);
      }
    }, { root: overviewEl, rootMargin: "200px" });

    let shown = 0;
    state.pages.forEach((p, i) => {
      if (!passesFilter(p)) return;
      shown++;
      const card = document.createElement("div");
      card.className = "ocard";
      card.dataset.idx = i;
      card.innerHTML = `
        <div class="thumb"></div>
        <div class="ocard-info">
          <span class="badge ${p.verdict || "none"}">${{keep:"▣",pass:"✓",redraw:"✦"}[p.verdict] || "●"}</span>
          ${p.star ? '<span class="star">★</span>' : ""}
          <span class="pn">P${p.page}</span>
          <span class="ot">${(p.title || p.role || "").slice(0, 14)}</span>
          ${p.has_draft ? "" : '<span class="nd">⏳</span>'}
        </div>`;
      card.onclick = (ev) => {
        if (ev.shiftKey && anchorIdx >= 0) { selectRange(anchorIdx, i); return; }
        anchorIdx = i;
        window.render(i); setMode("single");
      };
      overviewEl.appendChild(card);
      io.observe(card);
    });
  }

  async function fillThumb(card) {
    const p = state.pages[+card.dataset.idx];
    const holder = card.querySelector(".thumb");
    if (p.has_draft) {
      const res = await fetch(`/api/task/${state.task}/page/${p.page}/draft`);
      if (res.ok) { holder.innerHTML = await res.text(); return; }
    }
    holder.innerHTML = `<img src="/api/task/${state.task}/page/${p.page}/original" alt="">`;
  }

  // M3.2b 占位（下一步实现批量选择）
  function selectRange() {}
})();
