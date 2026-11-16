
# -*- coding: utf-8 -*-
"""段落化后处理器 v2（lxml 元素级操作，替代脆弱的正则手术）

1. <a:br> 处把所在 <a:p> 拆成多个 <a:p>（pPr 复制继承）
2. 段首 \\u200b+NBSP{1,}+· 剥前缀 → 注入 buChar="·" + marL 层级缩进（真段落标识）
3. 残余 ZWSP 全清
用法：postprocess_pptx.py <pptx路径>
"""
import shutil, sys, zipfile
from pathlib import Path
from lxml import etree
sys.stdout.reconfigure(encoding="utf-8")

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
def a(tag): return f"{{{A}}}{tag}"
LEVEL2_MARL, LEVEL2_INDENT = 342900, -342900

path = Path(sys.argv[1])
tmp = path.with_suffix(".tmp.pptx")
stats = {"split": 0, "lvl2": 0, "zwsp": 0}
zin = zipfile.ZipFile(str(path))
zout = zipfile.ZipFile(str(tmp), "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename.startswith("ppt/slides/slide") and item.filename.endswith(".xml"):
        root = etree.fromstring(data)
        # 1) br 拆段
        for p in root.iter(a("p")):
            brs = p.findall(a("r") + "/" + a("br")) + [b for b in p if b.tag == a("br")]
            if not p.findall(".//" + a("br")):
                continue
            groups, cur = [], []
            for child in list(p):
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
        # 2) 段首二级标识 → 原生符号 + 缩进
        for p in root.iter(a("p")):
            first_r = p.find(a("r"))
            if first_r is None:
                continue
            t = first_r.find(a("t"))
            if t is None or not (t.text or "").startswith("\u200b"):
                continue
            head = t.text
            mm = re_import = __import__("re").match("\u200b((?:\u00A0)+)·", head)
            if mm:
                stats["lvl2"] += 1
                t.text = head[mm.end():]
                old = p.find(a("pPr"))
                if old is not None:
                    # 保留引擎 pPr（lnSpc 行距等），只覆写缩进与符号
                    old.set("marL", str(LEVEL2_MARL)); old.set("indent", str(LEVEL2_INDENT))
                    if old.find(a("buChar")) is None:
                        bf = etree.SubElement(old, a("buFont")); bf.set("typeface", "Microsoft YaHei")
                        bc = etree.SubElement(old, a("buChar")); bc.set("char", "·")
                    ppr = old
                else:
                    ppr = etree.Element(a("pPr"))
                    ppr.set("marL", str(LEVEL2_MARL)); ppr.set("indent", str(LEVEL2_INDENT))
                    bf = etree.SubElement(ppr, a("buFont")); bf.set("typeface", "Microsoft YaHei")
                    bc = etree.SubElement(ppr, a("buChar")); bc.set("char", "·")
                    p.insert(0, ppr)
            else:
                t.text = head.replace("\u200b", "")
        xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        data = xml
    zout.writestr(item, data)
zin.close(); zout.close()
shutil.move(str(tmp), str(path))
print(f"postprocess v2: br-split={stats['split']} lvl2-native={stats['lvl2']}")
