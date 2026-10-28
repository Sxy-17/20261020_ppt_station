/* 总览模式（M3.2a 网格/筛选 + M3.2b 批量裁决）
   选区：Ctrl+点选 追加、Shift+点选 范围、Ctrl+A 选筛选全部、Esc 清空；
   批量条：四裁决 + 跳过已裁决开关 + 范围直填 + 一级撤销。 */
"use strict";

(function () {
  const overviewEl = document.getElementById("overview");
  const bulkbarEl = document.getElementById("bulkbar");
  const selected = new Set();     // 选中的 state.pages 索引
  let anchorIdx = -1;
  let lastBatch = null;           // {list:[{idx,prev}], entries:[...]} 一级撤销

  document.getElementById("mode-single").onclick = () => setMode("single");
  document.getElementById("mode-overview").onclick = () => setMode("overview");

  function setMode(m) {
    document.body.dataset.mode = m;
    if (m === "overview") { buildFilterChips(); renderOverview(); }
    else { selected.clear(); updateBulkbar(); }
  }
  window.setMode = setMode;
  window.setFilter = (key) => { setMode("overview"); curFilter = key; buildFilterChips(); renderOverview(); };

  // ---------- 筛选（M3.2a） ----------
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
    const chips = [["all","全部"],["undone","未裁决"],["pass","✓通过"],["keep","▣保留"],
                   ["redraw","✦重绘"],["star","★回看"],["nodraft","⏳未出稿"]];
    const bar = document.getElementById("filter-chips");
    bar.innerHTML = "";
    for (const [key, label] of chips) {
      const b = document.createElement("button");
      b.className = "chip" + (curFilter === key ? " active" : "");
      b.textContent = `${label}·${c[key]}`;
      b.onclick = () => { curFilter = key; selected.clear(); buildFilterChips(); renderOverview(); };
      bar.appendChild(b);
    }
  }

  // ---------- 网格 ----------
  function renderOverview() {
    overviewEl.innerHTML = "";
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        fillThumb(e.target);
      }
    }, { root: overviewEl, rootMargin: "300px" });

    state.pages.forEach((p, i) => {
      if (!passesFilter(p)) return;
      const card = document.createElement("div");
      card.className = "ocard" + (selected.has(i) ? " selected" : "");
      card.dataset.idx = i;
      card.innerHTML = `
        <div class="thumb"></div>
        <div class="ocard-info">
          <span class="badge ${p.verdict || "none"}">${{keep:"▣",pass:"✓",redraw:"✦"}[p.verdict] || "●"}</span>
          ${p.star ? '<span class="star">★</span>' : ""}
          <span class="pn">P${p.page}</span>
          <span class="ot">${(p.title || p.role || "").slice(0, 14)}</span>
          ${p.has_draft ? "" : '<span class="nd">⏳</span>'}${p.has_motion ? '<span class="nmot">▶</span>' : ""}
        </div>`;
      card.onclick = (ev) => {
        if (ev.shiftKey && anchorIdx >= 0 && anchorIdx !== i) {
          const [a, b] = anchorIdx < i ? [anchorIdx, i] : [i, anchorIdx];
          for (let k = a; k <= b; k++) selected.add(k);
          renderOverview(); updateBulkbar(); return;
        }
        if (ev.ctrlKey || ev.metaKey) {
          selected.has(i) ? selected.delete(i) : selected.add(i);
          anchorIdx = i;
          card.classList.toggle("selected", selected.has(i));
          updateBulkbar(); return;
        }
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

  // ---------- 批量条 ----------
  function updateBulkbar() {
    const n = selected.size;
    bulkbarEl.style.display = n ? "flex" : "none";
    bulkbarEl.querySelector("#bulk-count").textContent = `已选 ${n} 页`;
  }

  async function applyBatch(verdict, logAction) {
    const skip = bulkbarEl.querySelector("#bulk-skip").checked;
    const idxs = [...selected].sort((a, b) => a - b)
      .filter((i) => !(skip && state.pages[i].verdict));
    if (!idxs.length) { alert("选区内没有可写页（全部已裁决且开了跳过）"); return; }
    // 记旧值供撤销（一级）
    lastBatch = { idxs, prev: idxs.map((i) => ({ verdict: state.pages[i].verdict, star: state.pages[i].star })) };
    const entries = idxs.map((i) => ({ page: state.pages[i].page, verdict }));
    const res = await fetch(`/api/task/${state.task}/verdicts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, log_action: logAction }),
    });
    const data = await res.json();
    if (!data.ok) { alert(data.error); return; }
    for (const w of data.written) {
      const p = state.pages.find((x) => x.page === w.page);
      p.verdict = w.verdict; p.star = w.star;
    }
    selected.clear();
    document.dispatchEvent(new Event("pages-updated"));
    buildFilterChips(); renderOverview(); updateBulkbar();
  }
  window.applyBatch = applyBatch;

  for (const b of bulkbarEl.querySelectorAll("[data-bv]"))
    b.onclick = () => applyBatch(b.dataset.bv, `batch-${b.dataset.bv || "clear"}`);
  bulkbarEl.querySelector("#bulk-cancel").onclick = () => { selected.clear(); renderOverview(); updateBulkbar(); };
  bulkbarEl.querySelector("#bulk-undo").onclick = async () => {
    if (!lastBatch) return;
    const entries = lastBatch.idxs.map((i, k) => ({
      page: state.pages[i].page,
      verdict: lastBatch.prev[k].verdict, star: lastBatch.prev[k].star }));
    await fetch(`/api/task/${state.task}/verdicts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, log_action: "undo-batch" }),
    });
    lastBatch.idx.forEach = null; lastBatch = null;
    await reloadPages();
  };
  // 范围直填：从 N 到 M
  bulkbarEl.querySelector("#bulk-range-apply").onclick = () => {
    const a = +bulkbarEl.querySelector("#bulk-from").value;
    const b = +bulkbarEl.querySelector("#bulk-to").value;
    const v = bulkbarEl.querySelector("#bulk-range-v").value;
    if (!a || !b || a > b) { alert("范围不合法"); return; }
    selected.clear();
    state.pages.forEach((p, i) => { if (p.page >= a && p.page <= b) selected.add(i); });
    applyBatch(v, `range-${v || "clear"}`);
  };

  async function reloadPages() {
    const data = await (await fetch(`/api/task/${state.task}/pages`)).json();
    state.pages = data.pages;
    document.dispatchEvent(new Event("pages-updated"));
    buildFilterChips(); renderOverview(); updateBulkbar();
  }

  // 键盘：Ctrl+A 选筛选全部 / Esc 清空
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.mode !== "overview") return;
    if (e.key === "Escape") { selected.clear(); renderOverview(); updateBulkbar(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      state.pages.forEach((p, i) => { if (passesFilter(p)) selected.add(i); });
      renderOverview(); updateBulkbar();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); bulkbarEl.querySelector("#bulk-undo").click(); }
  });
})();
