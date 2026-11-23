# -*- coding: utf-8 -*-
"""段落化后处理器 v3（lxml 元素级操作，替代脆弱的正则手术）

v3 新增（ch3 原生直出规范，见 library/aesthetics/other-native-pptx-workflow.md）：
  3) 行首字面圆点标记 → 原生 bullet 段落属性（对齐用户手工示范页）：
     - 首 run == "•"            → 一级：无 marL，buChar "•"（buFont Arial）
     - 首 run == "–"+1 全角空格 → 二级：marL=742950  lvl=2  indent=-342900，buChar "–"
     - 首 run == "–"+2 全角空格 → 三级：marL=1257300 lvl=4  indent=-342900，buChar "–"
     全部注入 buClr #1F4E79 + buSzPct 125000；标记字符（圆点+缩进空格）从文字剥离
  4) 处理过的段落框末尾补空段（endParaRPr sz=1800 + buNone，对齐示范页）
保留 v2 行为：
  1) <a:br> 处把所在 <a:p> 拆成多个 <a:p>（pPr 复制继承）
  2) 段首 \u200b+NBSP{1,}+· 剥前缀 → 注入 buChar="·" + marL 层级缩进（chapter2 方言）
  5) 残余 ZWSP 全清
用法：postprocess_pptx.py <pptx路径>
"""
import re
import shutil
import sys
import zipfile
from pathlib import Path
from lxml import etree

sys.stdout.reconfigure(encoding="utf-8")

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
def a(tag): return f"{{{A}}}{tag}"

LEVEL2_MARL, LEVEL2_INDENT = 342900, -342900   # v2 chapter2 方言
L1_MARL, L1_LVL = 742950, "2"                  # v3 二级（示范页实测）
L2_MARL, L2_LVL = 1257300, "4"                 # v3 三级
BU_COLOR = "1F4E79"
BULLET_RE = re.compile(r"^(•\u00A0*|–\u3000*)")  # 行首标记：• 或 –+全角空格×n

# CT_TextParagraphProperties 子元素法定顺序（OOXML schema）——注入必须按此序
PPR_ORDER = [a(x) for x in (
    "lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buSzTx", "buSzPct",
    "buSzPts", "buFontTx", "buFont", "buNone", "buAutoNum", "buChar",
    "tabLst", "defRPr", "extLst",
)]

def _ordered_insert(pPr, el):
    """把 el 插入 pPr 的合法位置（按 schema 序），同 tag 已存在则先移除。"""
    for old in pPr.findall(el.tag):
        pPr.remove(old)
    my_idx = PPR_ORDER.index(el.tag)
    for child in pPr:
        if child.tag in PPR_ORDER and PPR_ORDER.index(child.tag) > my_idx:
            child.addprevious(el)
            return
    pPr.append(el)

def _ensure_pPr(p):
    pPr = p.find(a("pPr"))
    if pPr is None:
        pPr = etree.Element(a("pPr"))
        p.insert(0, pPr)
    return pPr

def _inject_bullet(pPr, *, marL=None, lvl=None, indent=None, char=None):
    """按示范页规范注入 bullet 属性（色/号/字体/符号 + 缩进）。"""
    if marL is not None:
        pPr.set("marL", str(marL)); pPr.set("indent", str(indent))
        if lvl is not None:
            pPr.set("lvl", lvl)
    bc = etree.Element(a("buClr"))
    etree.SubElement(bc, a("srgbClr")).set("val", BU_COLOR)
    _ordered_insert(pPr, bc)
    bs = etree.Element(a("buSzPct")); bs.set("val", "125000")
    _ordered_insert(pPr, bs)
    if char is not None:
        bf = etree.Element(a("buFont")); bf.set("typeface", "Arial")
        _ordered_insert(pPr, bf)
        bch = etree.Element(a("buChar")); bch.set("char", char)
        _ordered_insert(pPr, bch)

def _strip_marker(p):
    """识别并剥离行首字面圆点标记。返回 (级别, True) 或 (None, False)。

    标记形态（SVG 方言，v3）——bullet 单独成 tspan（着色）与 bullet+空格同 tspan 两种写法都识别：
      首个 run 以 "•" 开头 → 0 级
      首个 run 以 "–" 开头 → 级别 = 首 run 的全角空格数，不足时看下一个 run 的行首全角空格
      （ 1→1 级、≥2→2 级）
    """
    runs = p.findall(a("r"))
    if not runs:
        return None, False
    t0 = runs[0].find(a("t"))
    if t0 is None or not (t0.text or ""):
        return None, False
    m = BULLET_RE.match(t0.text or "")
    if not m:
        return None, False
    head = m.group(0)
    if head.startswith("•"):
        lvl = 0
    else:
        n = len(head) - 1  # 去 “–” 本身，余下全是全角空格
        if n == 0:
            # 空格在下一个 run（bullet 独立 tspan 写法）：预读
            nxt = runs[1].find(a("t")) if len(runs) > 1 else None
            n = len((nxt.text or "")) - len((nxt.text or "").lstrip("\u3000")) if nxt is not None else 0
        lvl = 1 if n == 1 else (2 if n >= 2 else None)
        if lvl is None:
            return None, False
    rest = (t0.text or "")[len(head):]
    if rest:
        t0.text = rest
    else:
        # 首 run 剥空后整 run 删除（着色圆点 tspan 的常见形态）
        p.remove(runs[0])
        # 下一个 run 的行首全角空格/NBSP 一并归零（缩进空格不进文字）
        nr = p.find(a("r"))
        if nr is not None:
            nt = nr.find(a("t"))
            if nt is not None and (nt.text or "").startswith(("\u3000", "\u00A0")):
                nt.text = (nt.text or "").lstrip("\u3000\u00A0")
                if not nt.text:
                    p.remove(nr)
    return lvl, True

def _append_tail_empty(p_body):
    """框末补空段（对齐示范页：sz1800 + buNone + 行距150%）。"""
    last = p_body.findall(a("p"))
    if not last:
        return
    lp = last[-1]
    if not lp.findall(a("r")):   # 已有空段就不重复加
        return
    ap = etree.SubElement(p_body, a("p"))
    pPr = etree.SubElement(ap, a("pPr"))
    pPr.set("marL", "0"); pPr.set("indent", "0")
    ln = etree.SubElement(pPr, a("lnSpc"))
    etree.SubElement(ln, a("spcPct")).set("val", "150000")
    etree.SubElement(pPr, a("buFontTx"))
    etree.SubElement(pPr, a("buNone"))
    epr = etree.SubElement(ap, a("endParaRPr"))
    epr.set("kumimoji", "1"); epr.set("lang", "zh-CN")
    epr.set("altLang", "en-US"); epr.set("sz", "1800"); epr.set("dirty", "0")

path = Path(sys.argv[1])
tmp = path.with_suffix(".tmp.pptx")
stats = {"split": 0, "lvl2": 0, "v3": 0, "tail": 0}
zin = zipfile.ZipFile(str(path))
zout = zipfile.ZipFile(str(tmp), "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename.startswith("ppt/slides/slide") and item.filename.endswith(".xml"):
        root = etree.fromstring(data)
        # 1) br 拆段（v2 行为保留）
        for p in root.iter(a("p")):
            if not p.findall(".//" + a("br")):
                continue
            groups, cur = [], []
            for child in list(p):
                if child.tag == a("pPr"):
                    continue
                if child.tag == a("br"):
                    stats["split"] += 1
                    groups.append(cur); cur = []
                else:
                    cur.append(child)
            groups.append(cur)
            ppr = p.find(a("pPr"))
            parent = p.getparent()
            idx = list(parent).index(p)
            new_ps = []
            for g in groups:
                np = etree.SubElement(parent, a("p"))
                if ppr is not None:
                    np.append(etree.fromstring(etree.tostring(ppr)))
                for ch in g:
                    np.append(ch)
                new_ps.append(np)
            parent.remove(p)
            for k, np in enumerate(new_ps):
                parent.insert(idx + k, np)
        # 2) v2 chapter2 方言：ZWSP+NBSP+· → 原生二级
        for p in root.iter(a("p")):
            first_r = p.find(a("r"))
            if first_r is None:
                continue
            t = first_r.find(a("t"))
            if t is None or not (t.text or "").startswith("\u200b"):
                continue
            head = t.text
            mm = re.match("\u200b((?:\u00A0)+)·", head)
            if mm:
                stats["lvl2"] += 1
                t.text = head[mm.end():]
                pPr = _ensure_pPr(p)
                pPr.set("marL", str(LEVEL2_MARL)); pPr.set("indent", str(LEVEL2_INDENT))
                if pPr.find(a("buChar")) is None:
                    bf = etree.SubElement(pPr, a("buFont")); bf.set("typeface", "Microsoft YaHei")
                    bc = etree.SubElement(pPr, a("buChar")); bc.set("char", "·")
            else:
                t.text = head.replace("\u200b", "")
        # 3) v3：行首字面圆点标记 → 原生 bullet 段落
        touched_bodies = set()
        for p in root.iter(a("p")):
            lvl, hit = _strip_marker(p)
            if not hit:
                continue
            stats["v3"] += 1
            pPr = _ensure_pPr(p)
            if lvl == 0:
                _inject_bullet(pPr, marL=0, indent=0, char="•")
            elif lvl == 1:
                _inject_bullet(pPr, marL=L1_MARL, lvl=L1_LVL, indent=-342900, char="–")
            else:
                _inject_bullet(pPr, marL=L2_MARL, lvl=L2_LVL, indent=-342900, char="–")
            body = p.getparent()
            if body is not None:
                touched_bodies.add(id(body))
        # 4) 处理过的框补尾空段（txBody 是 presentationml 命名空间，别搜成 a:）
        PML = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
        for body_el in root.iter(f"{PML}txBody"):
            if id(body_el) in touched_bodies:
                _append_tail_empty(body_el)
                stats["tail"] += 1
        # 5) 残余 ZWSP 全清（v2 行为）
        for t in root.iter(a("t")):
            if t.text and "\u200b" in t.text:
                t.text = t.text.replace("\u200b", "")
        xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        data = xml
    zout.writestr(item, data)
zin.close()
zout.close()

# 结构自检（R40：pPr 非首位/嵌套 a:p 会触发 PowerPoint 修复框）
import zipfile as zf2
from lxml import etree as et2
bad = 0
zc = zf2.ZipFile(str(tmp))
for name in zc.namelist():
    if not (name.startswith("ppt/slides/slide") and name.endswith(".xml")):
        continue
    root2 = et2.fromstring(zc.read(name))
    for p in root2.iter(a("p")):
        kids = [c for c in p if isinstance(c.tag, str)]
        for i, c in enumerate(kids):
            if c.tag == a("pPr") and i != 0:
                bad += 1
        if p.find(".//" + a("p")) is not None:
            bad += 1
zc.close()
if bad:
    print(f"✗ 自检失败：{bad} 处结构违规（pPr 非首位/嵌套段落），产物不落盘")
    tmp.unlink()
    sys.exit(3)
shutil.move(str(tmp), str(path))
print(f"postprocess v3: br-split={stats['split']} v2-lvl2={stats['lvl2']} v3-bullets={stats['v3']} tail-empty={stats['tail']}")
