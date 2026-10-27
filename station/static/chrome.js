/* 胶片条 + 分段进度条（M3.4b，Lightroom 式筛片流） */
"use strict";

(function () {
  const strip = document.getElementById("filmstrip");

  // ---- 分段进度条：注入 topbar，包一层 render 钩子同步 ----
  const segsEl = document.createElement("div");
  segsEl.id = "progress-segs";
  segsEl.title = "绿=通过 蓝灰=保留 紫=重绘 灰=未裁决（点击筛选）";
  document.getElementById("progress").after(segsEl);

  function updateSegs() {
    const c = { pass: 0, keep: 0, redraw: 0, undone: 0 };
    for (const p of state.pages) p.verdict ? c[p.verdict]++ : c.undone++;
    const total = state.pages.length || 1;
    segsEl.innerHTML = "";
    for (const key of ["pass", "keep", "redraw", "undone"]) {
      if (!c[key]) continue;
      const s = document.createElement("span");
      s.className = `seg seg-${key}`;
      s.style.flexGrow = c[key];
      s.textContent = c[key] > 3 ? c[key] : "";
      s.onclick = () => window.setFilter(key === "undone" ? "undone" : key);
      segsEl.appendChild(s);
    }
  }

  // ---- 胶片条：迷你缩略图 + 当前高亮 + 懒加载 ----
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      fillThumb(e.target);
    }
  }, { root: strip, rootMargin: "150px" });

  function buildStrip() {
    strip.innerHTML = "";
    state.pages.forEach((p, i) => {
      const c = document.createElement("div");
      c.className = "fcard" + (i === state.cur ? " cur" : "") +
        (p.verdict ? ` v-${p.verdict}` : "") + (p.star ? " starred" : "");
      c.dataset.idx = i;
      c.innerHTML = `<div class="fthumb"></div>
        <span class="fpn">P${p.page}${p.star ? "★" : ""}</span>
        ${p.has_draft ? "" : '<span class="fnd">⏳</span>'}`;
      c.onclick = () => window.render(i);
      strip.appendChild(c);
      io.observe(c);
    });
  }

  async function fillThumb(card) {
    const p = state.pages[+card.dataset.idx];
    const holder = card.querySelector(".fthumb");
    if (p.has_draft) {
      const res = await fetch(`/api/task/${state.task}/page/${p.page}/draft`);
      if (res.ok) { holder.innerHTML = await res.text(); return; }
    }
    holder.innerHTML = `<img src="/api/task/${state.task}/page/${p.page}/original" alt="">`;
  }

  function syncCurrent() {
    strip.querySelectorAll(".fcard").forEach((c) => {
      const on = +c.dataset.idx === state.cur;
      c.classList.toggle("cur", on);
      if (on) c.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
  }

  // 包 render：任何翻页/裁决后同步（app.js 的 window.render 是唯一渲染入口）
  const origRender = window.render;
  window.render = (i) => { origRender(i); updateSegs(); syncCurrent(); };
  document.addEventListener("pages-updated", () => { buildStrip(); updateSegs(); });
  // 初次任务加载（app.js 启动后异步完成，轮询一次兜底）
  const t = setInterval(() => {
    if (state.pages.length) { buildStrip(); updateSegs(); clearInterval(t); }
  }, 300);
})();
