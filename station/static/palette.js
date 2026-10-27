/* 命令面板（M3.4a，Linear/Raycast 式）：所有动作可搜可达 */
"use strict";

(function () {
  let open = false, items = [], sel = 0;

  const el = document.createElement("div");
  el.id = "palette";
  el.innerHTML = `
    <div class="palette-box">
      <input id="palette-input" placeholder="跳页(如 12 / P12) · 裁决 · 筛选 · 切模式 · 切任务…">
      <div id="palette-list"></div>
    </div>`;
  document.body.appendChild(el);
  const input = el.querySelector("#palette-input");
  const listEl = el.querySelector("#palette-list");

  function commands() {
    const cmds = [
      { label: "总览模式", hint: "缩略图网格", run: () => window.setMode("overview") },
      { label: "单页模式", hint: "对照审核", run: () => window.setMode("single") },
      { label: "裁决当前页：通过", hint: "2", run: () => window.setVerdict("pass") },
      { label: "裁决当前页：保留原样", hint: "1", run: () => window.setVerdict("keep") },
      { label: "裁决当前页：重绘", hint: "3", run: () => window.setVerdict("redraw") },
      { label: "星标当前页", hint: "S", run: () => { const p = state.pages[state.cur]; window.setVerdict(p.verdict, { star: !p.star }); } },
      { label: "清除当前页裁决", run: () => window.setVerdict("") },
      { label: "筛选：未裁决", run: () => window.setFilter("undone") },
      { label: "筛选：★回看", run: () => window.setFilter("star") },
      { label: "筛选：⏳未出稿", run: () => window.setFilter("nodraft") },
      { label: "筛选：全部", run: () => window.setFilter("all") },
    ];
    // 动态：跳页（当前任务页）+ 切任务
    for (const p of state.pages.slice(0, 200)) {
      cmds.push({ label: `P${p.page} ${p.title || p.role || ""}`.trim(),
                  hint: "跳页", run: () => { window.render(state.pages.indexOf(p)); window.setMode("single"); } });
    }
    return cmds;
  }

  function refresh() {
    const q = input.value.trim().toLowerCase().replace(/^p/, "");
    items = commands().filter((c) => {
      if (!q) return c.hint !== "跳页";          // 空查询不刷屏（页太多）
      const num = q.match(/^\d+$/) ? +q : null;
      if (num !== null) return c.label.startsWith(`P${num}`) || c.label.toLowerCase().includes(q);
      return c.label.toLowerCase().includes(q) || (c.hint || "").toLowerCase().includes(q);
    }).slice(0, 12);
    sel = 0;
    listEl.innerHTML = items.map((c, i) =>
      `<div class="pitem${i === 0 ? " active" : ""}" data-i="${i}">
         <span>${c.label}</span><span class="phint">${c.hint || ""}</span></div>`).join("");
    listEl.querySelectorAll(".pitem").forEach((n) => {
      n.onclick = () => exec(+n.dataset.i);
    });
  }

  function exec(i) {
    const c = items[i];
    toggle(false);
    if (c) c.run();
  }

  function toggle(force) {
    open = force !== undefined ? force : !open;
    el.style.display = open ? "flex" : "none";
    if (open) { input.value = ""; refresh(); input.focus(); }
  }
  window.togglePalette = toggle;

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggle(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") exec(sel);
  });
  el.addEventListener("mousedown", (e) => { if (e.target === el) toggle(false); });

  function move(d) {
    sel = Math.max(0, Math.min(items.length - 1, sel + d));
    listEl.querySelectorAll(".pitem").forEach((n, i) => n.classList.toggle("active", i === sel));
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); }
  });
})();
