/* 工作台的唯一轮询（PLAN §8.5 stream.js）
   R3：意见队列 —— 发现 agent 新完成的意见 → 横幅提醒；当前页被改了就重载并闪一下。
   规矩：这里只读服务器、更新 state、调用 workbench.js 的绘制函数，从不改写 render（诊断 #7）。 */
"use strict";

(function () {
  const INTERVAL = 3000;
  let seenDone = null;   // 已知完成的意见 ts；null = 还没建立基线（首轮只记账不弹，避免历史 done 刷屏）

  async function pollRequests() {
    let reqs;
    try {
      reqs = await (await fetch(api("/requests"), { cache: "no-store" })).json();
    } catch { return; }  // 服务重启间隙静默跳过，下一轮再来
    if (!Array.isArray(reqs)) return;
    state.requests = reqs;

    const done = reqs.filter((r) => r.status === "done");
    const fresh = seenDone ? done.filter((r) => !seenDone.has(r.ts)) : [];
    seenDone = new Set(done.map((r) => r.ts));

    if (fresh.length) onDone(fresh);
    if (state.pages.length) { drawTop(); drawOpinion(); }
  }

  function onDone(fresh) {
    const last = fresh[fresh.length - 1];
    const more = fresh.length > 1 ? `（另有 ${fresh.length - 1} 条也已完成）` : "";
    const quote = (last.text || "重绘").slice(0, 24);
    const cur = state.pages[state.cur];

    // 当前页被 agent 改了：直接载入新稿并闪一下。
    // 编辑器上线（R5）后这里要先看有没有未保存修改，有就改成"载入新稿 / 保留我的修改"二选一
    if (fresh.some((r) => r.page === cur.page)) {
      render().then(flash);
    }
    if (last.page === cur.page) {
      banner(`P${last.page} 已按意见改好：「${quote}」${more}`);
    } else {
      const i = state.pages.findIndex((p) => p.page === last.page);
      banner(`P${last.page} 已按意见改好：「${quote}」${more}`, i >= 0 ? [["查看", () => go(i)]] : []);
    }
  }

  pollRequests();
  setInterval(pollRequests, INTERVAL);
})();
