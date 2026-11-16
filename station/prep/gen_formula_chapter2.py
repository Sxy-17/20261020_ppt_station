
# -*- coding: utf-8 -*-
"""chapter2 公式页定制出稿：OLE 公式从整页截图裁剪成图片贴入新稿（R15 保底贴图路线）

为什么手排这 6 页：OLE 公式对象在导出链里不可编辑也不渲染，用户已定规矩
"公式改为图片"；每页布局简单、坐标从 XML 确定性换算，不猜拓扑。
裁剪源 = pages/NNN/original.png（1920×1080），坐标 = OLE shape EMU 等比映射。

重跑：.venv/Scripts/python station/prep/gen_formula_chapter2.py（幂等，覆盖 6 页稿）
"""
import sys
from pathlib import Path
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
TASK = ROOT / "projects" / "chapter2_loopopt_20261116"
IMG = TASK / "images"
IMG.mkdir(exist_ok=True)

INK, PRIM, RED, GRAY = "#1D2430", "#1F4E79", "#FF0000", "#8A94A0"
EMU_W, EMU_H = 12192000, 6858000
PAD = 10  # 裁剪外扩像素，防止贴边截字

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def crop(page, name, ex, ey, ew, eh):
    """EMU → png 像素裁剪，返回 (文件名, viewBox 坐标 w,h)"""
    px = lambda v, total, base: int(v / (EMU_W if total == 1920 else EMU_H) * base)
    x0 = max(0, px(ex, 1920, 1920) - PAD); y0 = max(0, px(ey, 1080, 1080) - PAD)
    x1 = min(1920, px(ex + ew, 1920, 1920) + PAD); y1 = min(1080, px(ey + eh, 1080, 1080) + PAD)
    im = Image.open(TASK / "pages" / page / "original.png").crop((x0, y0, x1, y1))
    fn = f"{page}_{name}.png"
    im.save(IMG / fn)
    return fn

def vb(ex, ey, ew, eh):
    """EMU → viewBox(1280×720) 矩形"""
    return (round(ex / EMU_W * 1280), round(ey / EMU_H * 720),
            round(ew / EMU_W * 1280), round(eh / EMU_H * 720))

HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" lang="zh-CN"\n'
        '  data-pptx-page-role="{role}" font-family="Microsoft YaHei" font-size="18">\n'
        '  <rect id="page-background" x="0" y="0" width="1280" height="720" fill="#FFFFFF" data-pptx-role="background"/>\n')

def title_g(text):
    return ('  <g id="page-title" data-pptx-bounds="80 40 1120 90">\n'
            f'    <text x="80" y="108" font-size="30" font-weight="bold" fill="{INK}">{esc(text)}</text>\n'
            f'    <line x1="80" y1="130" x2="240" y2="130" stroke="{PRIM}" stroke-width="2"/>\n'
            '  </g>\n')

def img_g(gid, x, y, w, h, fn):
    return (f'  <g id="{gid}" data-pptx-bounds="{x} {y} {w} {h}">\n'
            f'    <image href="../images/{fn}" x="{x}" y="{y}" width="{w}" height="{h}" '
            f'preserveAspectRatio="xMidYMax meet"/>\n  </g>\n')

def text_g(gid, x, y, lines, size=24, color=INK, leading=40, w=1120):
    """lines=[(text, style)] style: {}|{"color":..,"bold":True}"""
    out = [f'  <g id="{gid}" data-pptx-bounds="{x} {y-30} {w} {leading*len(lines)+10}">\n']
    for i, (t, st) in enumerate(lines):
        c = st.get("color", color)
        b = ' font-weight="bold"' if st.get("bold") else ""
        out.append(f'    <text x="{x}" y="{y+i*leading}" font-size="{size}" fill="{c}"{b}>{esc(t)}</text>\n')
    out.append("  </g>\n")
    return "".join(out)

pages = {}

# ---- P65 程序变换目标3：bullets(2行) + OLE 大图（原位 y276 起）----
fn = crop("065", "ole", 965200, 2630967, 10007600, 3810000)
x, y, w, h = vb(965200, 2630967, 10007600, 3810000)
svg = HEAD.format(role="content") + title_g("程序变换的目标3: 挖掘更多优化机会")
svg += text_g("body-bullets", 104, 200, [
    ("发掘程序中更多的向量操作或并行性", {"bold": True}),
    ("    将阻碍循环向量化/并行化的部分剥离", {"bold": True})], size=24, leading=44)
svg += img_g("formula-ole", x, y, w, h, fn) + "</svg>\n"
pages["065"] = svg

# ---- P66 可向量化/并行化：顶部红字 + OLE 近全幅图 ----
fn = crop("066", "ole", 624417, 1052513, 10871200, 5257800)
svg = HEAD.format(role="content")
svg += text_g("annotations", 80, 80, [
    ("可向量化、并行化", {"color": RED, "bold": True}),
    ("可向量化", {"color": RED, "bold": True})], size=24, leading=40)
# 图下移避开文字：x 居中，y=170，高度压到 530
w2, h2 = 1116, 530
svg += img_g("formula-ole", 82, 170, w2, h2, fn) + "</svg>\n"
pages["066"] = svg

# ---- P86 循环交换：文字信息全（bullets+矩阵），但含 2 图 + OLE，
# 无视觉不猜布局 → 正文区整页贴原图（R15），标题保留可检索 ----
fn = crop("086", "full", 300000, 1250000, 11500000, 5400000)
svg = HEAD.format(role="content") + title_g("循环交换")
svg += img_g("page-body-picture", 80, 150, 1120, 550, fn) + "</svg>\n"
pages["086"] = svg

# ---- P90 整页公式：无文字，OLE 居中大图 ----
fn = crop("090", "ole", 1219200, 609600, 9855200, 5638800)
x, y, w, h = vb(1219200, 609600, 9855200, 5638800)
svg = HEAD.format(role="content") + img_g("formula-ole", x, y, w, h, fn) + "</svg>\n"
pages["090"] = svg

# ---- P94 循环倾斜(1)：bullets 上部 + 两个 OLE 小图并排（原位 y451 起）----
f1 = crop("094", "ole1", 5000000, 4300000, 1866900, 1260475)
f2 = crop("094", "ole2", 8400000, 4300000, 1866900, 1260475)
svg = HEAD.format(role="content") + title_g("循环倾斜（１）")
svg += text_g("body-bullets", 104, 200, [
    ("改变循环迭代空间的形状", {"bold": True}),
    ("幺模矩阵：", {"bold": True}),
    ("改变循环中存在的依赖关系的" + "方向", {})], size=24, leading=44)
svg += img_g("formula-ole1", 525, 445, 196, 132, f1)
svg += img_g("formula-ole2", 882, 445, 196, 132, f2) + "</svg>\n"
pages["094"] = svg

# ---- P97 循环倾斜(2)：说明 + d′ 行 + 幺模矩阵小图 + DO 代码面板 ----
fn = crop("097", "ole", 6000751, 1319213, 1208616, 933450)
svg = HEAD.format(role="content") + title_g("循环倾斜")
svg += text_g("body-bullets", 104, 200, [
    ("选择幺模矩阵", {"bold": True}),
    ("依赖距离向量变为", {"bold": True}),
    ("d′ = (1, 1)U = (1, 2)     d′ = (1, −1)U = (1, 0)", {})], size=24, leading=44, w=820)
svg += img_g("matrix-ole", 960, 170, 140, 108, fn)
code = ["DO I1 = 2 , N+M-2",
        "  DO J1 = MAX(0, I1-M+2), MIN(N-2, I1)",
        "    I = I1 – J1 + 2",
        "    J = J1  + 2",
        "    A(I,J) = (A(I-1 , J-1) + A(I-1 , J+1)) /2",
        "  ENDDO",
        "ENDDO"]
lines = "".join(f'    <text x="140" y="{400+i*40}" font-family="Consolas" font-size="24" fill="{INK}">{esc(l.replace(" ", "\u00A0"))}</text>\n' for i, l in enumerate(code))
svg += (f'  <g id="code-panel" data-pptx-bounds="80 330 1120 330">\n'
        f'    <rect x="100" y="350" width="1080" height="300" rx="8" fill="#F5F7FA" stroke="{GRAY}" stroke-width="1"/>\n'
        + lines + "  </g>\n</svg>\n")
pages["097"] = svg

for page, svg in pages.items():
    (TASK / "pages" / page / "draft.svg").write_text(svg, encoding="utf-8")
    print(f"{page} ✓ formula draft written")
print("done")
