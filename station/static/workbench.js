/* 新工作台（PLAN §8）· 本步 R1：顶栏页带 + 双栏对照 + 翻页
   规矩：一个状态对象、一个渲染入口 render()，不允许别的文件改写它（旧版链式改写 render 的教训，诊断 #7）。 */
"use strict";

const $ = (id) => document.getElementById(id);

// 任务名从地址取：/t/<任务>/p/
const TASK = decodeURIComponent(location.pathname.split("/")[2] || "");
const api = (p) => `/api/task/${encodeURIComponent(TASK)}${p}`;

const state = {
  pages: [],      // GET /pages 的页清单
  cur: 0,         // 当前页在 pages 里的下标
  seq: 0,         // 渲染序号：只有最新一次 render 的响应能写进右栏（防翻页竞态，诊断 #4）
  requests: [],   // 意见队列（pending_requests.jsonl），stream.js 定时刷新
  shown: {},      // 页号 → 右栏当前显示的稿的 draft_mtime；stream.js 据此判断"盘上的稿比显示的新"
  gen: null,      // 一键出稿状态（/generate/status），stream.js 刷新
  ratio: { orig: 4 / 3, draft: 16 / 9 },   // 两栏画幅，加载后按真实尺寸更新
};

/* ---------- 加载 ---------- */
async function load() {
  const r = await fetch(api("/pages"));
  const d = await r.json();
  if (d.error) { $("deck").textContent = d.error; return; }
  state.pages = d.pages;
  $("deck").textContent = d.info.source_original_name || TASK;
  $("deck").title = TASK;
  document.title = `${$("deck").textContent} · 工作台`;
  // 首页：第一个未裁决的已出稿页；都裁决了就停在 P1
  const i = state.pages.findIndex((p) => p.has_draft && !p.verdict);
  go(i >= 0 ? i : 0, true);
}

/* ---------- 翻页 ---------- */
function go(i, force = false) {
  if (i < 0 || i >= state.pages.length) return;
  if (i === state.cur && !force) return;
  state.cur = i;
  render();
}

/* ---------- 渲染当前页（唯一入口） ---------- */
async function render() {
  const p = state.pages[state.cur];
  const mySeq = ++state.seq;
  drawTop();
  drawVerdicts();
  resetOpinion();

  // 左：原页截图。按图片真实宽高比放大（旧课件多为 4:3，但不假设）
  const img = $("orig-img");
  img.onload = () => { state.ratio.orig = img.naturalWidth / img.naturalHeight; fit(); };
  img.src = p.has_original ? api(`/page/${p.page}/original`) : "";

  // 右：新稿。未出稿显示等待态；出稿了 fetch 文本内联（后续编辑要直接操作 DOM）
  if (!p.has_draft) {
    $("svgbox").innerHTML = "";
    $("wait").innerHTML = `<span><i></i>P${p.page} 生成中…出稿后自动显示</span>`;
    $("wait").hidden = false;
    return;
  }
  const r = await fetch(api(`/page/${p.page}/draft`), { cache: "no-store" });
  if (mySeq !== state.seq) return;      // 用户已翻走：丢弃这次过期响应
  if (!r.ok) {
    $("svgbox").innerHTML = "";
    $("wait").innerHTML = `<span>P${p.page} 读取新稿失败（${r.status}）</span>`;
    $("wait").hidden = false;
    return;
  }
  $("svgbox").innerHTML = await r.text();
  $("wait").hidden = true;
  state.shown[p.page] = p.draft_mtime;
  const svg = $("svgbox").querySelector("svg");
  const vb = svg && svg.viewBox.baseVal;
  if (vb && vb.width && vb.height) state.ratio.draft = vb.width / vb.height;
  fit();
}

/* ---------- 布局：两栏按各自画幅等比放到最大 ---------- */
function fit() {
  for (const [pane, slide, ratio] of [["orig-pane", "orig-slide", state.ratio.orig],
                                      ["draft-pane", "draft-slide", state.ratio.draft]]) {
    const r = $(pane).getBoundingClientRect();
    // 预留上方 28px 给"原页/新稿"标签，左右各 24px 呼吸
    const w = Math.max(0, Math.min(r.width - 48, (r.height - 56) * ratio));
    $(slide).style.width = w + "px";
    $(slide).style.height = w / ratio + "px";
  }
}
addEventListener("resize", fit);

/* ---------- 顶栏：页码 + 页带 ---------- */
const VERDICT_LABEL = { keep: "保留原图", pass: "通过", redraw: "重绘" };

function drawTop() {
  const p = state.pages[state.cur];
  $("pageno").textContent = `P${p.page} / ${state.pages.length}`;

  const strip = $("strip");
  if (strip.children.length !== state.pages.length) {
    strip.innerHTML = state.pages.map((_, i) => `<div class="cell" data-i="${i}"></div>`).join("");
  }
  state.pages.forEach((q, i) => {
    const c = strip.children[i];
    const n = pendingOf(q.page);
    c.className = "cell" + (!q.has_draft ? " wait" : q.verdict ? " " + q.verdict : "") +
      (i === state.cur ? " cur" : "") + (n ? " pending" : "");
    const st = !q.has_draft ? "生成中" : VERDICT_LABEL[q.verdict] || "待审";
    c.title = `P${q.page}${q.title ? " · " + q.title : ""} · ${st}${n ? ` · 意见处理中 ${n}` : ""}`;
  });

  const done = state.pages.filter((q) => q.verdict).length;
  const ready = state.pages.filter((q) => q.has_draft).length;
  $("tally").textContent = ready < state.pages.length
    ? `已审 ${done} · 已出稿 ${ready}/${state.pages.length}`
    : `已审 ${done}/${state.pages.length}`;
}

// 页带点击跳页（未出稿的页也能去：右栏显示"生成中"，左栏照样可看原页）
$("strip").onclick = (e) => {
  const c = e.target.closest(".cell");
  if (c) go(+c.dataset.i);
};

// 点页码 → 原地变输入框，回车跳转
$("pageno").onclick = () => {
  if ($("pageno").querySelector("input")) return;
  $("pageno").innerHTML = `P<input value="${state.pages[state.cur].page}">`;
  const inp = $("pageno").querySelector("input");
  inp.select();
  inp.onkeydown = (e) => {
    e.stopPropagation();   // 输入数字时别触发 1/2/3 裁决快捷键
    if (e.key === "Enter") {
      const i = state.pages.findIndex((q) => q.page === +inp.value);
      if (i >= 0) go(i);
      drawTop();
    }
    if (e.key === "Escape") drawTop();
  };
  inp.onblur = () => drawTop();
};

/* ---------- 裁决：三键 + 自动前进；对已裁决页再按同键 = 撤销（PLAN §8.4） ---------- */
function drawVerdicts() {
  const p = state.pages[state.cur];
  for (const b of document.querySelectorAll(".vb")) {
    b.classList.toggle("on", b.dataset.v === p.verdict);
    b.disabled = !p.has_draft;   // 没稿可看就不能拍板（"沉默不确认"的另一面：没看过不确认）
  }
}

function say(text, bad = false) {
  $("msg").textContent = text;
  $("msg").className = bad ? "bad" : "";
}

let writing = false;   // 写盘期间忽略连击：防止一次按键写两遍、或前进两页
async function verdict(v) {
  const p = state.pages[state.cur];
  if (!p.has_draft || writing) return;
  const undo = p.verdict === v;              // 再按同键 = 撤销
  writing = true;
  try {
    const r = await fetch(api(`/page/${p.page}/verdict`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: undo ? "" : v }),
    });
    const d = await r.json();
    if (!d.ok) { say(`P${p.page} 裁决没写进去：${d.error || r.status}`, true); return; }
    p.verdict = d.verdict;                   // 以服务器落盘结果为准，不信本地猜测
    say("");
  } catch (err) {
    say(`P${p.page} 裁决没写进去：服务器连不上`, true);
    return;
  } finally {
    writing = false;
  }
  if (undo) { drawTop(); drawVerdicts(); return; }   // 撤销后留在本页，方便重新选
  if (v === "redraw") {
    // 重绘：先让用户有机会说"怎么重画"，写不写都行，回车才去下一页
    drawTop(); drawVerdicts();
    const inp = $("op-input");
    inp.placeholder = "重绘要求（可留空），回车去下一页 · Esc 留在本页";
    inp.dataset.thenNext = "1";
    inp.focus();
    return;
  }
  advance();
}

// 下一个未裁决页：先往后找，到末尾再从头找；未出稿的也算（去了显示"生成中"）
function advance() {
  for (let k = 1; k < state.pages.length; k++) {
    const i = (state.cur + k) % state.pages.length;
    if (!state.pages[i].verdict) { go(i); return; }
  }
  drawTop(); drawVerdicts();
  say(`全部 ${state.pages.length} 页已裁决 · 在聊天里说「导出」生成 .pptx`);
}

for (const b of document.querySelectorAll(".vb")) {
  // 点完立即 blur：焦点留在按钮上时回车会再触发一次（= 撤销）
  b.onclick = () => { b.blur(); verdict(b.dataset.v); };
}

/* ---------- 意见框（PLAN §8.4）：永远对应当前页，回车提交，提交后不等待 ---------- */
const OP_PLACEHOLDER = "意见：大白话告诉 agent 这页怎么改，回车提交";

// "处理中" = 排队(queued) 或 agent 已领走正在改(working)
function pendingOf(page) {
  return state.requests.filter((r) => r.page === page && (r.status === "queued" || r.status === "working")).length;
}

function resetOpinion() {
  const inp = $("op-input");
  inp.placeholder = OP_PLACEHOLDER;
  delete inp.dataset.thenNext;
  // 换页时如果光标还停在空的意见框里（比如按 3 后直接点了页带），交还给页面：
  // 否则接下来按 1/2/3 会变成往框里打字。框里有字就不动，免得用户写到一半被打断
  if (document.activeElement === inp && !inp.value) inp.blur();
  drawOpinion();
}

function drawOpinion() {
  const p = state.pages[state.cur];
  if (!p) return;
  const n = pendingOf(p.page);
  $("op-state").className = n ? "busy" : "";
  $("op-state").textContent = n ? `已交给 agent · 处理中 ${n} 条` : "";
}

let sending = false;
$("op-input").addEventListener("keydown", async (e) => {
  e.stopPropagation();               // 打字时数字键/方向键不触发裁决和翻页
  const inp = e.target;
  if (e.key === "Escape") { delete inp.dataset.thenNext; inp.placeholder = OP_PLACEHOLDER; inp.blur(); return; }
  if (e.key !== "Enter" || e.isComposing || sending) return;   // 输入法选词时的回车不算提交
  const text = inp.value.trim();
  const p = state.pages[state.cur];
  if (text) {
    sending = true;
    try {
      const r = await fetch(api(`/page/${p.page}/request`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!d.ok) { say(`意见没提交上：${d.error || r.status}`, true); return; }
      state.requests.push(d);        // 立刻反映到页带橙点，不等下一次轮询
      inp.value = "";
      say("");
    } catch {
      say("意见没提交上：服务器连不上", true);
      return;
    } finally {
      sending = false;
    }
  }
  drawTop(); drawOpinion();
  if (inp.dataset.thenNext) { delete inp.dataset.thenNext; inp.blur(); advance(); }
});

/* ---------- 横幅：非弹窗，自动消失；同一时刻只留最新一条 ---------- */
let bannerTimer = null;
function banner(text, actions = [], ttl = 8000) {
  const b = $("banner");
  b.innerHTML = "";
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = text;              // textContent：意见是用户原话，不当 HTML 解析
  b.appendChild(t);
  for (const [label, fn] of actions) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.onclick = () => { b.hidden = true; fn(); };
    b.appendChild(btn);
  }
  const x = document.createElement("button");
  x.className = "ghost";
  x.textContent = "×";
  x.onclick = () => { b.hidden = true; };
  b.appendChild(x);
  b.hidden = false;
  clearTimeout(bannerTimer);
  if (ttl) bannerTimer = setTimeout(() => { b.hidden = true; }, ttl);
}

function flash() {
  const s = $("draft-slide");
  s.classList.remove("flash");
  void s.offsetWidth;                // 强制重排，让动画能重复触发
  s.classList.add("flash");
}

/* ---------- ⋯ 菜单：一键出稿 / 导出状态 / 快捷键 ---------- */
function drawMenu() {
  const g = state.gen, btn = document.querySelector('#menu [data-act="gen"]');
  const missing = state.pages.filter((p) => !p.has_draft).length;
  btn.disabled = (g && g.running) || missing === 0;
  $("gen-state").textContent = g && g.running ? "生成中…" : missing ? `${missing} 页待出` : "已全部出稿";
}

$("more").onclick = (e) => { e.stopPropagation(); drawMenu(); $("menu").hidden = !$("menu").hidden; };
document.addEventListener("click", (e) => { if (!$("menu").contains(e.target)) $("menu").hidden = true; });

$("menu").onclick = async (e) => {
  const a = e.target.closest("[data-act]");
  if (!a || a.disabled) return;
  $("menu").hidden = true;
  const act = a.dataset.act;
  if (act === "gen") {
    const r = await fetch(api("/generate"), { method: "POST" });
    const d = await r.json();
    if (!d.ok) { say(`没能开始出稿：${d.error}`, true); return; }
    state.gen = { running: true };
    // 只点亮页带，不跳页、不重载当前页（PLAN §8.4"后台永不打断前台"）
    banner("后台出稿中：页带会逐格点亮，不会打断你正在看的页");
  } else if (act === "export") {
    const left = state.pages.filter((p) => !p.verdict).map((p) => "P" + p.page);
    const redraw = state.pages.filter((p) => p.verdict === "redraw").map((p) => "P" + p.page);
    if (left.length) banner(`还有 ${left.length} 页未裁决：${left.slice(0, 8).join("、")}${left.length > 8 ? "…" : ""}`, [], 12000);
    else if (redraw.length) banner(`${redraw.length} 页标了重绘、等 agent 重画：${redraw.slice(0, 8).join("、")}`, [], 12000);
    else banner("全部已裁决 · 在聊天里说「导出」生成 .pptx", [], 12000);
  } else if (act === "keys") {
    banner("1 保留原图 · 2 通过 · 3 重绘（再按撤销） · ←/→ 翻页 · 点页码输入跳页 · 意见框回车提交", [], 15000);
  }
};

/* ---------- 键盘 ---------- */
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "ArrowLeft") go(state.cur - 1);
  else if (e.key === "ArrowRight") go(state.cur + 1);
  else if (e.key === "1") verdict("keep");
  else if (e.key === "2") verdict("pass");
  else if (e.key === "3") verdict("redraw");
});

load();
