/* 选择页（M3.3）：诊断+处方表单 → selection.json 收据 */
"use strict";

const task = location.pathname.split("/").pop();
const $ = (s) => document.querySelector(s);
$("#sel-task").textContent = task;

// ---- 诊断区 ----
(async () => {
  const res = await fetch(`/api/task/${task}/diagnosis`);
  if (!res.ok) { $("#diag-body").textContent = "（无诊断数据——先跑准备链）"; return; }
  const d = await res.json();
  const fonts = (d.actual_fonts || []).map((f) => `${f.name}×${f.count}`).join("、");
  $("#diag-body").innerHTML = `
    <div>${d.deck.pages} 页 · 画幅 ${d.deck.ratio} · 主色 <span class="swatch" style="background:${d.primary_color}"></span>${d.primary_color}（${d.primary_color_source}）</div>
    <div>字体：${fonts || "未检出"}</div>
    <div>图形页 ${d.diagram_pages.length}（重绘候选）· 拥挤页 ${d.crowded_pages.length} · 空页 ${d.empty_pages.length}${d.hidden_pages.length ? ` · 隐藏 ${d.hidden_pages.length}` : ""}</div>
    <div>角色：${Object.entries(d.role_counts || {}).map(([k, v]) => `${k}×${v}`).join(" · ")}</div>`;
  // 处方预选联动：4:3 原稿且未建议换幅时保持 16:9 推荐（换幅是默认升级）
})();

// ---- 风格卡片 ----
let templates = [];
(async () => {
  templates = await (await fetch("/api/templates")).json();
  const box = $("#tpl-cards");
  box.innerHTML = "";
  templates.forEach((t, i) => {
    const card = document.createElement("div");
    card.className = "tpl-card" + (i === 0 ? " active" : "");
    const swatches = Object.values(t.palette).slice(0, 6)
      .map((c) => `<span class="swatch" style="background:${c}"></span>`).join("");
    const prev = t.preview
      ? `<div class="tprev"><img src="${t.preview}" alt="${t.name} 样张"></div>` : "";
    card.innerHTML = `${prev}<div class="swatches">${swatches}</div>
      <div class="tname">${t.name}${i === 0 ? " ◆" : ""}</div>
      <div class="tcat">${t.category}</div>`;
    card.onclick = () => {
      box.querySelectorAll(".tpl-card").forEach((x) => x.classList.remove("active"));
      card.classList.add("active");
    };
    box.appendChild(card);
  });
})();

function choices() {
  const active = $("#tpl-cards .tpl-card.active");
  const idx = active ? [...$("#tpl-cards").children].indexOf(active) : 0;
  return {
    template: templates[idx] ? templates[idx].id : "",
    ratio: $('input[name=ratio]:checked').value,
    range: $('input[name=range]:checked').value === "front"
      ? `前${$("#range-n").value}页`
      : $('input[name=range]:checked').value === "custom" ? $("#range-custom").value : "all",
    figure_policy: $('input[name=fig]:checked').value,
    motion: $('input[name=motion]:checked').value,
  };
}

async function submit(delegate) {
  const res = await fetch(`/api/task/${task}/selection`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delegate, choices: choices() }),
  });
  const data = await res.json();
  if (!data.ok) { alert(data.error || "提交失败"); return; }
  document.querySelectorAll(".select-foot .vbtn, .radios, .tpl-cards").forEach((x) => (x.disabled = true));
  $("#done").hidden = false;
}

$("#btn-go").onclick = () => submit(false);
$("#btn-delegate").onclick = () => submit(true);
