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
  zoom: { orig: 1, draft: 1 },             // 各栏相对"适配"的缩放倍数（Ctrl+滚轮），换页保持
};

/* ---------- 加载 ---------- */
async function load() {
  // 页清单和意见队列一起拿：打开页面时页带上的橙点（有意见在处理）立刻就有，不等第一轮轮询
  const [r, rq] = await Promise.all([fetch(api("/pages")), fetch(api("/requests")).catch(() => null)]);
  const d = await r.json();
  if (d.error) { $("deck").textContent = d.error; return; }
  if (rq && rq.ok) { const q = await rq.json(); if (Array.isArray(q)) state.requests = q; }
  state.pages = d.pages;
  state.agentOnline = !!d.agent_online;
  $("deck").textContent = d.info.source_original_name || TASK;
  $("deck").title = TASK;
  document.title = `${$("deck").textContent} · 工作台`;
  // 首页：第一个未裁决的已出稿页；都裁决了就停在 P1
  const i = state.pages.findIndex((p) => p.has_draft && !p.verdict);
  go(i >= 0 ? i : 0, true);
}

/* ---------- 翻页：有未保存修改先保存，质检不过就留在本页（不静默丢弃，PLAN §8.4） ---------- */
async function go(i, force = false) {
  if (i < 0 || i >= state.pages.length) return;
  if (i === state.cur && !force) return;
  if (editor.dirty && !(await editor.save())) return;
  state.cur = i;
  render();
}

/* ---------- 渲染当前页（唯一入口） ---------- */
async function render() {
  const p = state.pages[state.cur];
  const mySeq = ++state.seq;
  editor.detach();          // 先放下上一页的编辑状态（调用方已保证没有未保存修改）
  drawTop();
  drawVerdicts();
  drawChip();
  resetOpinion();

  // 左：原页截图。按图片真实宽高比放大（旧课件多为 4:3，但不假设）
  const img = $("orig-img");
  img.onload = () => { state.ratio.orig = img.naturalWidth / img.naturalHeight; fit(); };
  img.src = p.has_original ? api(`/page/${p.page}/original`) : "";

  // 右：新稿。未出稿显示等待态；出稿了 fetch 文本内联（后续编辑要直接操作 DOM）
  $("add").hidden = true; $("addmenu").hidden = true;
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
  // 版本号取响应头：它和读到的内容严格对应（/pages 里的值可能比内容旧一拍）
  const mtime = +(r.headers.get("X-Draft-Mtime") || p.draft_mtime);
  const text = await r.text();
  if (mySeq !== state.seq) return;
  $("svgbox").innerHTML = text;
  $("wait").hidden = true;
  state.shown[p.page] = mtime;
  p.draft_mtime = mtime;
  const svg = $("svgbox").querySelector("svg");
  const vb = svg && svg.viewBox.baseVal;
  if (vb && vb.width && vb.height) state.ratio.draft = vb.width / vb.height;
  fit();
  if (svg) editor.attach(svg, p, mtime);
  $("add").hidden = !svg;
}

// 右栏右上角状态签：编辑状态优先，其次说明裁决对导出意味着什么
function drawChip(msg, cls = "") {
  const c = $("chip"), p = state.pages[state.cur];
  c.className = cls;
  if (msg) { c.textContent = msg; return; }
  if (editor.dirty) { c.className = "dirty"; c.textContent = "未保存 · Ctrl+S"; }
  else if (p && p.verdict === "keep") c.textContent = "导出时用原图";
  else if (p && p.verdict === "redraw") {
    const job = state.requests.find((r) => r.page === p.page && r.type === "redraw" && (r.status === "queued" || r.status === "working"));
    c.textContent = !job ? "已标重绘" : job.status === "working" ? "已标重绘 · agent 正在重画"
      : state.agentOnline ? "已标重绘 · 排队等 agent" : "已标重绘 · agent 未值守，还没人处理";
    if (job && job.status !== "working" && !state.agentOnline) c.className = "bad";
  }
  else c.textContent = "";
}

/* ---------- 布局：两栏按各自画幅等比放到最大 ---------- */
function fit() {
  for (const key of ["orig", "draft"]) {
    const ratio = state.ratio[key], z = state.zoom[key];
    const r = $(`${key}-pane`).getBoundingClientRect();
    // 适配尺寸：预留上方 28px 给"原页/新稿"标签，左右各 24px 呼吸；再乘这一栏的缩放倍数
    const w = Math.max(0, Math.min(r.width - 48, (r.height - 56) * ratio)) * z;
    $(`${key}-slide`).style.width = w + "px";
    $(`${key}-slide`).style.height = w / ratio + "px";
    $(`${key}-label`).innerHTML = (key === "orig" ? "原页" : "新稿") +
      (Math.abs(z - 1) > 0.01 ? `<span class="z" data-pane="${key}" title="点一下恢复适配（Ctrl+0）">缩放 ${Math.round(z * 100)}%</span>` : "");
  }
  editor.syncOverlay();     // 画布尺寸变了，选中框跟着走
}
addEventListener("resize", fit);

/* ---------- Ctrl+滚轮：缩放鼠标所在那一栏的稿件，而不是整个网页 ---------- */
// 以鼠标位置为中心：缩放前后，鼠标下面的那个点保持不动（看图软件的手感）
function zoomPane(key, factor, cx, cy) {
  const slide = $(`${key}-slide`), sc = $(`${key}-scroll`);
  const before = slide.getBoundingClientRect();
  if (cx === undefined) { const r = sc.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const fx = (cx - before.left) / before.width, fy = (cy - before.top) / before.height;
  state.zoom[key] = Math.max(0.5, Math.min(6, state.zoom[key] * factor));
  fit();
  const after = slide.getBoundingClientRect();
  sc.scrollLeft += after.left + fx * after.width - cx;
  sc.scrollTop += after.top + fy * after.height - cy;
}
// 点标签上的"缩放 xx%"复原这一栏
document.addEventListener("click", (e) => {
  const z = e.target.closest && e.target.closest(".label .z");
  if (z) { state.zoom[z.dataset.pane] = 1; fit(); }
});
// passive:false 才能 preventDefault —— 拦下浏览器自己的整页缩放
addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const pane = e.target.closest && e.target.closest(".pane");
  if (!pane) return;
  // 触控板捏合也会以 Ctrl+滚轮 送来，deltaY 小而密；指数换算让鼠标滚轮和触控板手感一致
  zoomPane(pane.id === "orig-pane" ? "orig" : "draft", Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
}, { passive: false });

/* ---------- 两栏分隔条：拖动改左右宽度（有时要把右栏放大细看） ---------- */
const SPLIT_KEY = "wb.split";   // 记在浏览器里：换页、刷新都保持；纯界面偏好，不写进任务文件
function setSplit(left) {
  left = Math.max(0.2, Math.min(0.8, left));   // 两边都至少留 20%，不至于拖没了
  $("main").style.gridTemplateColumns = `minmax(0, ${left}fr) 12px minmax(0, ${1 - left}fr)`;
  localStorage.setItem(SPLIT_KEY, String(left));
  fit();
}
(() => {
  const saved = parseFloat(localStorage.getItem(SPLIT_KEY));
  if (saved) $("main").style.gridTemplateColumns = `minmax(0, ${saved}fr) 12px minmax(0, ${1 - saved}fr)`;
  const sp = $("split");
  sp.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    sp.classList.add("on");
    document.body.classList.add("resizing");
  });
  sp.addEventListener("pointermove", (e) => {
    if (!sp.hasPointerCapture(e.pointerId)) return;
    const m = $("main").getBoundingClientRect();
    const pad = 16, inner = m.width - pad * 2 - 12;          // 去掉左右内边距和分隔条自身
    setSplit((e.clientX - m.left - pad - 6) / inner);
  });
  const end = (e) => { sp.classList.remove("on"); document.body.classList.remove("resizing"); };
  sp.addEventListener("pointerup", end);
  sp.addEventListener("lostpointercapture", end);
  sp.addEventListener("dblclick", () => setSplit(0.5));
})();

/* ---------- 顶栏：页码 + 页带 ---------- */
const VERDICT_LABEL = { keep: "保留原图", pass: "通过", redraw: "重绘" };

function drawTop() {
  const p = state.pages[state.cur];
  $("pageno").textContent = `P${p.page} / ${state.pages.length}`;

  const strip = $("strip");
  if (strip.children.length !== state.pages.length) {
    strip.innerHTML = state.pages.map((q, i) => `<div class="cell" data-i="${i}">${q.page}</div>`).join("");
  }
  state.pages.forEach((q, i) => {
    const c = strip.children[i];
    const n = pendingOf(q.page);
    c.className = "cell" + (!q.has_draft ? " wait" : q.verdict ? " " + q.verdict : "") +
      (i === state.cur ? " cur" : "") + (n ? " pending" : "");
    const st = !q.has_draft ? "生成中" : VERDICT_LABEL[q.verdict] || "待审";
    c.title = `P${q.page}${q.title ? " · " + q.title : ""} · ${st}${n ? ` · 意见处理中 ${n}` : ""}`;
  });

  // 换页时把当前格滚进视野；没换页就不动，免得和用户手动滚页带"抢"
  if (state.stripCur !== state.cur) {
    state.stripCur = state.cur;
    const c = strip.children[state.cur], sr = strip.getBoundingClientRect(), cr = c.getBoundingClientRect();
    if (cr.left < sr.left || cr.right > sr.right) strip.scrollLeft += cr.left - sr.left - sr.width / 2 + cr.width / 2;
  }

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
// 页带上的竖向滚轮转成横向滚动：普通鼠标没有横滚轮
$("strip").addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  $("strip").scrollLeft += e.deltaY;
}, { passive: false });

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
  writing = true;                            // 先占住：保存可能要几秒，期间的连击一律忽略
  // 拍板前先把手改的保存下来（过质检门）；质检不过就不裁决、不前进，问题标在画布上
  if (!undo && editor.dirty && !(await editor.save())) { writing = false; return; }
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
  drawChip();
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
  const working = state.requests.some((r) => r.page === p.page && r.status === "working");
  // 说实话：排着队不等于有人在做。agent 没在值守时明说，并告诉用户怎么让它开始
  const s = $("op-state");
  if (!n) { s.className = ""; s.textContent = ""; }
  else if (working) { s.className = "busy"; s.textContent = `agent 正在改这页（${n} 条）`; }
  else if (state.agentOnline) { s.className = "busy"; s.textContent = `排队 ${n} 条 · agent 值守中，马上轮到`; }
  else { s.className = "idle"; s.textContent = `排队 ${n} 条 · agent 未值守：在聊天里说「值守」才会处理`; }
  s.title = s.textContent;
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
    banner("1 保留原图 · 2 通过 · 3 重绘（再按撤销） · ←/→ 翻页 · 右栏单击选中单个文字框/框（框连同框里的字一起动）、再按住拖动、方向键微调（Shift ×10）· 右下角方块缩放 · 箭头拖两端圆点改端点、拖小方块改弯度 · Alt+单击选整组 · 双击改字 · Delete 删除 · 右下角 + 新建 · Ctrl+Z 撤销 · Ctrl+S 保存 · Ctrl+滚轮缩放稿件、Ctrl+0 复原 · 拖两栏中间的竖条调宽度", [], 20000);
  }
};

/* ---------- 键盘 ---------- */
document.addEventListener("keydown", (e) => {
  // Ctrl+0 / Ctrl+= / Ctrl+- 也归稿件缩放（不让浏览器缩放整页）；输入框里也拦，免得打字时误缩整页
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "0") { e.preventDefault(); state.zoom.orig = state.zoom.draft = 1; fit(); return; }
    if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomPane("draft", 1.25); return; }
    if (e.key === "-") { e.preventDefault(); zoomPane("draft", 0.8); return; }
  }
  if (e.target.tagName === "INPUT") return;
  if (editor.handleKey(e)) return;          // 编辑器先接：Ctrl+Z/S、Esc、选中时的方向键
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "ArrowLeft") go(state.cur - 1);
  else if (e.key === "ArrowRight") go(state.cur + 1);
  else if (e.key === "1") verdict("keep");
  else if (e.key === "2") verdict("pass");
  else if (e.key === "3") verdict("redraw");
});

// 等三个脚本（workbench / editor / stream）都执行完再加载：render 里要调 editor
addEventListener("DOMContentLoaded", load);
