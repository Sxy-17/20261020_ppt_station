/* 大纲卡片确认页（M6.2）：CRUD + 排序 + 确认（双入口的网页侧） */
"use strict";

const task = location.pathname.split("/").pop();
const $ = (s) => document.querySelector(s);
$("#ol-task").textContent = task;
let pages = [];

const ROLES = ["cover", "toc", "section", "content", "code", "diagram", "ending"];

function card(p, i) {
  return `<div class="ocard ol-card" data-i="${i}">
    <span class="ol-n">${i + 1}</span>
    <input class="ol-title" value="${(p.title || "").replace(/"/g, "&quot;")}" placeholder="页面标题">
    <select class="ol-role">${ROLES.map((r) =>
      `<option${r === (p.role || "content") ? " selected" : ""}>${r}</option>`).join("")}</select>
    <input class="ol-anchor" value="${(p.anchor || "").replace(/"/g, "&quot;")}" placeholder="素材锚点（如 论文§1 / repo README）">
    <button class="vbtn ol-up" title="上移">↑</button>
    <button class="vbtn ol-dn" title="下移">↓</button>
    <button class="vbtn ol-del" title="删除">✕</button>
  </div>`;
}

function render() {
  $("#cards").innerHTML = pages.map(card).join("") ||
    '<div class="diag-body">（空——从聊天里让 agent 先出大纲，或点下方加一页手搓）</div>';
}

function collect() {
  pages = [...document.querySelectorAll(".ol-card")].map((el) => ({
    title: el.querySelector(".ol-title").value,
    role: el.querySelector(".ol-role").value,
    anchor: el.querySelector(".ol-anchor").value,
  }));
}

async function save(confirmed) {
  collect();
  const r = await fetch(`/api/task/${task}/outline`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmed, pages }),
  });
  const d = await r.json();
  if (!d.ok) { alert(d.error); return false; }
  return true;
}

$("#cards").addEventListener("click", async (e) => {
  const el = e.target.closest(".ol-card");
  if (!el) return;
  const i = +el.dataset.i;
  if (e.target.classList.contains("ol-del")) { collect(); pages.splice(i, 1); render(); }
  if (e.target.classList.contains("ol-up") && i > 0) { collect(); [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; render(); }
  if (e.target.classList.contains("ol-dn") && i < pages.length - 1) { collect(); [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; render(); }
});
$("#btn-add").onclick = () => { collect(); pages.push({ title: "", role: "content", anchor: "" }); render();
  const last = document.querySelector(".ol-card:last-child .ol-title"); if (last) last.focus(); };
$("#btn-save").onclick = async () => { if (await save(false)) $("#done").hidden = false, $("#done").textContent = "✓ 已保存（未确认）"; };
$("#btn-go").onclick = async () => { if (await save(true)) $("#done").hidden = false, $("#done").textContent = "✓ 大纲已确认，agent 开始逐页生成（工作台流式可见）"; };

(async () => {
  const d = await (await fetch(`/api/task/${task}/outline`)).json();
  pages = d.pages || [];
  render();
})();
