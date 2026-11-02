/* 工作台的唯一轮询（PLAN §8.5 stream.js），每 3 秒一轮，顺序固定：
     ① 意见队列：发现 agent 新完成的意见 → 横幅
     ② 页清单：新出的稿点亮页带；当前页的稿在盘上变了才重载右栏（看 draft_mtime）
     ③ 一键出稿进度（只在出稿中查）
   铁律：后台永不打断前台——不跳页；不重载当前页，除非①当前页正处于"生成中"等待态，
   或②当前页的稿真的被换了（agent 改完）。旧版每出一页就整体重载并跳回第一个未裁决页（诊断 #3）。
   这里只读服务器、更新 state、调用 workbench.js 的绘制函数，从不改写 render（诊断 #7）。 */
"use strict";

(function () {
  const INTERVAL = 3000;
  let seenDone = null;   // 已知完成的意见 ts；null = 还没建立基线（首轮只记账不弹，避免历史 done 刷屏）
  let busy = false;      // 上一轮还没回来就不发下一轮（服务器慢时请求不堆积）
  let conflictAsked = 0; // 已经为哪个版本弹过"载入新稿 / 保留我的修改"

  async function pollPages() {
    const d = await (await fetch(api("/pages"), { cache: "no-store" })).json();
    if (!d.pages || !state.pages.length) return;
    const cur = state.pages[state.cur];
    const byPage = new Map(state.pages.map((p) => [p.page, p]));

    // 原地更新字段（对象引用不变，别处持有的 p 也跟着新）；页数变了才整体替换并按页号找回当前页
    if (d.pages.length === state.pages.length && d.pages.every((p) => byPage.has(p.page))) {
      for (const np of d.pages) {
        const op = byPage.get(np.page);
        // 版本号只进不退：迟到的旧响应不许把刚保存的新版本号改回去
        if (np.draft_mtime < op.draft_mtime) np.draft_mtime = op.draft_mtime;
        Object.assign(op, np);
      }
    } else {
      state.pages = d.pages;
      const i = state.pages.findIndex((p) => p.page === cur.page);
      state.cur = i >= 0 ? i : 0;
    }

    const now = state.pages[state.cur];
    const shownMtime = state.shown[now.page];
    if (now.has_draft && shownMtime === undefined && $("svgbox").innerHTML === "") {
      render();                                   // 正在等的这一页出稿了
    } else if (now.has_draft && shownMtime !== undefined && now.draft_mtime > shownMtime) {
      // 盘上的稿比右栏显示的新（agent 改完）。必须用"更新"而不是"不等"：
      // 保存前发出的轮询可能在保存完成后才回来，带着旧版本号——用 !== 会把自己刚存的稿当成别人改的去重载
      if (editor.busy()) {
        // 用户手上有没保存的修改（或正在打字）：不自动载入，问用户（同一版本只问一次）
        if (conflictAsked !== now.draft_mtime) { conflictAsked = now.draft_mtime; editor.conflict(now.draft_mtime); }
        drawTop(); drawVerdicts();
      } else {
        await render();
        flash();
      }
    } else {
      drawTop(); drawVerdicts();                  // 只刷新页带和裁决键（聊天里裁决的也会同步过来）
    }
  }

  async function pollRequests() {
    const reqs = await (await fetch(api("/requests"), { cache: "no-store" })).json();
    if (!Array.isArray(reqs)) return;
    state.requests = reqs;
    // 按 id 认条目：ts 只到秒，同一秒两条会被当成一条（服务器给旧记录补了 id=ts）
    const done = reqs.filter((r) => r.status === "done");
    const fresh = seenDone ? done.filter((r) => !seenDone.has(r.id)) : [];
    seenDone = new Set(done.map((r) => r.id));
    if (fresh.length) onDone(fresh);
    drawTop(); drawOpinion();
  }

  function onDone(fresh) {
    const last = fresh[fresh.length - 1];
    const more = fresh.length > 1 ? `（另有 ${fresh.length - 1} 条也已完成）` : "";
    const text = last.text
      ? `P${last.page} 已按意见改好：「${last.text.slice(0, 24)}」${more}`
      : `P${last.page} 已重绘完成${more}`;
    const here = state.pages[state.cur].page === last.page;
    const i = state.pages.findIndex((p) => p.page === last.page);
    // 右栏重载不在这里做：只有稿的 mtime 变了才重载（pollPages 负责），避免"标了完成但稿没变"也闪
    banner(text, !here && i >= 0 ? [["查看", () => go(i)]] : []);
  }

  async function pollGen() {
    if (!state.gen || !state.gen.running) return;
    const g = await (await fetch(api("/generate/status"), { cache: "no-store" })).json();
    const wasRunning = state.gen.running;
    state.gen = g;
    if (wasRunning && !g.running) {
      if (g.returncode === 0) banner(`出稿完成：${g.drafts}/${g.total} 页已有稿`);
      else banner(`出稿中断（${g.drafts}/${g.total}）：${(g.output || "").split("\n").filter(Boolean).pop() || "见服务器日志"}`, [], 15000);
    }
  }

  async function tick() {
    if (busy || !state.pages.length) return;
    busy = true;
    try {
      // 队列在前：它轻（一个小文件），打开页面时橙点/横幅能立刻出来；页清单要读每页 meta，慢一些
      await pollRequests();
      await pollPages();
      await pollGen();
    } catch { /* 服务重启间隙静默跳过，下一轮再来 */ }
    finally { busy = false; }
  }

  // 首轮：等 load() 把页清单拿到再开始；队列基线也在首轮建立
  const boot = setInterval(() => {
    if (!state.pages.length) return;
    clearInterval(boot);
    tick();
    setInterval(tick, INTERVAL);
  }, 200);
})();
