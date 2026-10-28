/* 对比模式（M3.3A 基准·M4.7 实装）：滑杆分割 + Tab 闪烁
   左半=原页像素，右半=新稿渲染——查"图丢没丢"一眼定案 */
"use strict";

(function () {
  const btn = document.createElement("button");
  btn.id = "btn-compare";
  btn.className = "vbtn";
  btn.textContent = "对比";
  btn.title = "滑杆分割对比（Tab 闪烁互换）";
  document.querySelector(".mode-toggle").before(btn);

  let on = false, pos = 0.5, swap = false;

  const layer = document.createElement("div");
  layer.id = "cmp-layer";
  layer.innerHTML = `<img id="cmp-img" alt="原页">
    <div id="cmp-div"><span id="cmp-grip">↔</span></div>`;
  const holder = () => document.getElementById("draft-holder");

  btn.onclick = () => {
    on = !on;
    btn.classList.toggle("active", on);
    const h = holder();
    if (on) {
      const p = state.pages[state.cur];
      if (!p.has_original) { on = false; btn.classList.remove("active"); return; }
      h.appendChild(layer);
      layer.querySelector("#cmp-img").src =
        `/api/task/${state.task}/page/${p.page}/original`;
      apply();
    } else layer.remove();
  };

  function apply() {
    const img = layer.querySelector("#cmp-img");
    // swap=true 时原页沉底（闪烁对比）
    const cut = swap ? 1 - pos : pos;
    img.style.clipPath = `inset(0 ${(1 - cut) * 100}% 0 0)`;
    layer.querySelector("#cmp-div").style.left = `${cut * 100}%`;
    // 原页是 4:3、新稿 16:9：以新稿高度铺满对齐顶部（同宽对比）
    img.style.position = "absolute";
    img.style.inset = "0";
    img.style.width = "100%";
    img.style.objectFit = "contain";
  }

  layer.querySelector("#cmp-div").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const move = (ev) => {
      const r = layer.getBoundingClientRect();
      pos = Math.max(0.02, Math.min(0.98, (ev.clientX - r.left) / r.width));
      apply();
    };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });

  document.addEventListener("keydown", (e) => {
    if (!on) return;
    if (e.key === "Tab") { e.preventDefault(); swap = !swap; apply(); }
  });

  // 翻页后重挂
  const origRender = window.render;
  window.render = (i) => { origRender(i); if (on) { btn.click(); btn.click(); } };
})();
