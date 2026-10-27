/* 通知（M3.5b）：意见被 agent 消化完 → 顶端滑入横幅；铃铛累计队列状态 */
"use strict";

(function () {
  let seenDone = new Set();   // 已知 done 的 ts（判断"新完成"）
  let initialized = false;

  // 铃铛（注入 topbar 尾部）
  const bell = document.createElement("button");
  bell.id = "bell";
  bell.className = "vbtn"
  bell.title = "意见队列状态";
  document.querySelector(".kbd-hint").before(bell);

  // 铃铛面板
  const panel = document.createElement("div");
  panel.id = "bell-panel";
  panel.hidden = true;
  document.body.appendChild(panel);
  bell.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) poll(true); };
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== bell) panel.hidden = true;
  });

  // 横幅容器
  const banners = document.createElement("div");
  banners.id = "banners";
  document.body.appendChild(banners);

  function showBanner(entries) {
    for (const r of entries.slice(-3)) {
      const b = document.createElement("div");
      b.className = "banner";
      b.innerHTML = `<span class="b-ok">✓ 已消化</span>
        <span class="b-page">P${r.page}</span>
        <span class="b-text">${(r.text || "").slice(0, 24)}</span>
        <button class="b-go">查看</button><button class="b-x">×</button>`;
      b.querySelector(".b-go").onclick = () => {
        const i = state.pages.findIndex((p) => p.page === r.page);
        if (i >= 0) { window.render(i); window.setMode("single"); }
        b.remove();
      };
      b.querySelector(".b-x").onclick = () => b.remove();
      banners.appendChild(b);
      setTimeout(() => b.remove(), 10000);   // 非弹窗：自动消退
    }
  }

  async function poll(force = false) {
    if (!state.task) return;
    let reqs = [];
    try {
      reqs = await (await fetch(`/api/task/${state.task}/requests`)).json();
    } catch { return; }   // 服务重启间隙静默跳过
    const queued = reqs.filter((r) => r.status === "queued");
    const done = reqs.filter((r) => r.status === "done");
    bell.textContent = queued.length
      ? `🔔${queued.length}` : (done.length ? "🔔✓" : "🔔");
    // 新完成检测：首轮只记账不弹（避免历史 done 刷屏）
    const doneTs = new Set(done.map((r) => r.ts));
    const fresh = initialized ? done.filter((r) => !seenDone.has(r.ts)) : [];
    if (fresh.length) showBanner(fresh);
    seenDone = doneTs;
    initialized = true;
    if (force) {
      panel.innerHTML = reqs.slice(-10).reverse().map((r) =>
        `<div class="bitem ${r.status}" data-page="${r.page}">
           <span class="bs">${r.status === "done" ? "✓" : "⏳"}</span>
           <span class="bp">P${r.page}</span>
           <span class="bt">${(r.text || "").slice(0, 30)}</span>
         </div>`).join("") || '<div class="bempty">队列为空</div>';
      panel.querySelectorAll(".bitem").forEach((n) => {
        n.onclick = () => {
          const i = state.pages.findIndex((p) => p.page === +n.dataset.page);
          if (i >= 0) { window.render(i); window.setMode("single"); panel.hidden = true; }
        };
      });
    }
  }

  poll();
  setInterval(poll, 5000);
})();
