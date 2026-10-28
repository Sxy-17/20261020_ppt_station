/* 审核工作台 M3.1：双面板对照 + 翻页 + 裁决三选一 + ★回看
   状态皆文件：本页只读 pages API、写 verdict API，无本地状态残留 */
"use strict";

const state = {
  task: null,        // 任务名（从 URL hash 取，如 #task_20261027_2244）
  pages: [],         // 页面清单
  cur: 0,            // 当前页索引（state.pages 内）
};

const $ = (id) => document.getElementById(id);

// ---------- 数据加载 ----------
async function loadTask(name) {
  state.task = name;
  const res = await fetch(`/api/task/${name}/pages`);
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  state.pages = data.pages;
  state.kind = data.info.kind || "a";
  document.body.classList.toggle("b-mode", state.kind === "b");
  $("task-name").textContent = `${name}（${data.info.status || "?"}）`;
  buildPageSelect();
  const first = state.pages.findIndex((p) => p.verdict === "") || 0;
  render(first < 0 ? 0 : first);
}

function buildPageSelect() {
  const sel = $("page-select");
  sel.innerHTML = "";
  for (const p of state.pages) {
    const o = document.createElement("option");
    o.value = p.page;
    const mark = p.verdict ? {keep:"▣",pass:"✓",redraw:"✦"}[p.verdict] : "●";
    const star = p.star ? "★" : " ";
    const draft = p.has_draft ? "" : " ⏳";
    o.textContent = `${mark}${star} P${p.page} ${p.title || ""}${draft}`;
    sel.appendChild(o);
  }
}

// ---------- 渲染当前页 ----------
async function render(idx) {
  state.cur = Math.max(0, Math.min(idx, state.pages.length - 1));
  const p = state.pages[state.cur];
  $("page-select").value = p.page;

  // 左：原图
  $("original-img").src = `/api/task/${state.task}/page/${p.page}/original`;

  // 右：draft（fetch 文本注入，保留交互可能；无稿显示占位）
  const holder = $("draft-holder");
  const res = await fetch(`/api/task/${state.task}/page/${p.page}/draft`);
  if (res.ok) {
    holder.innerHTML = await res.text();
    $("draft-state").textContent = "";
  } else {
    holder.innerHTML = `<div class="placeholder">尚未出稿${res.status === 404 ? "（排队/生成中）" : ""}</div>`;
    $("draft-state").textContent = "⏳";
  }

  // 底部：裁决按钮态 + 页面元信息
  for (const b of document.querySelectorAll(".vbtn[data-v]"))
    b.classList.toggle("active", b.dataset.v === p.verdict && p.verdict !== "");
  $("btn-star").classList.toggle("active", !!p.star);
  $("page-meta").textContent =
    `P${p.page} · ${p.role || "?"}${p.suggest === "redraw" ? " · 引擎建议重绘" : p.suggest === "keep" ? " · 引擎建议保留原图" : ""}`;

  const done = state.pages.filter((x) => x.verdict).length;
  $("progress").textContent = `${done}/${state.pages.length} 已裁决`;
  refreshPendingCount();
}

// ---------- 裁决写入 ----------
window.setVerdict = setVerdict;
async function setVerdict(verdict, extra = {}) {
  const p = state.pages[state.cur];
  const res = await fetch(`/api/task/${state.task}/page/${p.page}/verdict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdict, ...extra }),
  });
  const data = await res.json();
  if (!data.ok) { alert(data.error || "写入失败"); return; }
  p.verdict = data.verdict;
  p.star = data.star;
  buildPageSelect();
  render(state.cur);
}

// ---------- 事件 ----------
$("btn-prev").onclick = () => render(state.cur - 1);
$("btn-next").onclick = () => render(state.cur + 1);
$("page-select").onchange = (e) => {
  const i = state.pages.findIndex((p) => p.page === +e.target.value);
  render(i);
};
for (const b of document.querySelectorAll(".vbtn[data-v]"))
  b.onclick = () => setVerdict(b.dataset.v);
$("btn-star").onclick = () => {
  const p = state.pages[state.cur];
  setVerdict(p.verdict, { star: !p.star });   // 只切星标，不动裁决
};

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "ArrowLeft") render(state.cur - 1);
  else if (e.key === "ArrowRight") render(state.cur + 1);
  else if (e.key === "1") setVerdict("keep");
  else if (e.key === "2") setVerdict("pass");
  else if (e.key === "3") setVerdict("redraw");
  else if (e.key === "s" || e.key === "S") {
    const p = state.pages[state.cur];
    setVerdict(p.verdict, { star: !p.star });
  }
});

// ---------- 意见框（M3.5a）：提交进队列，翻页不等待 ----------
async function sendOpinion() {
  const input = $("opinion-input");
  const text = input.value.trim();
  if (!text) return;
  const p = state.pages[state.cur];
  const res = await fetch(`/api/task/${state.task}/page/${p.page}/request`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!data.ok) { alert(data.error || "提交失败"); return; }
  input.value = "";
  refreshPendingCount();
}
$("opinion-send").onclick = sendOpinion;
$("opinion-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendOpinion();
  e.stopPropagation();   // 别触发翻页/裁决快捷键
});

// 当前页待消化计数（挂在 page-meta 后面）
async function refreshPendingCount() {
  const reqs = await (await fetch(`/api/task/${state.task}/requests`)).json();
  const p = state.pages[state.cur];
  const n = reqs.filter((r) => r.page === p.page && r.status === "queued").length;
  const done = reqs.filter((r) => r.page === p.page && r.status === "done").length;
  $("page-meta").dataset.pending = n ? `待消化 ${n}` : "";
  $("page-meta").dataset.done = done ? `已消化 ${done}` : "";
}
window.refreshPendingCount = refreshPendingCount;

// ---------- 批量裁决后刷新（overview.js 派发） ----------
document.addEventListener("pages-updated", () => { buildPageSelect(); render(state.cur); });

// ---------- 启动：hash 定位任务，缺省列第一个 ----------
(async () => {
  const hash = location.hash.replace("#", "");
  if (hash) return loadTask(hash);
  const tasks = await (await fetch("/api/tasks")).json();
  if (tasks.length) loadTask(tasks[0].name);
  else $("task-name").textContent = "projects/ 下没有任务";
})();
