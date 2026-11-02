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
    c.className = "cell" + (!q.has_draft ? " wait" : q.verdict ? " " + q.verdict : "") +
      (i === state.cur ? " cur" : "");
    const st = !q.has_draft ? "生成中" : VERDICT_LABEL[q.verdict] || "待审";
    c.title = `P${q.page}${q.title ? " · " + q.title : ""} · ${st}`;
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
