---
id: other-native-pptx-workflow
type: other
name: 原生 PPTX 直出（ch3 式）
category: ""
applies: 文字列表为主的整本 .ppt 翻新（16:9 + 学术·现代模板）；不经 SVG 中间层，python-pptx 直接产出原生段落 PPTX
source: 翻新沉淀
created: 2026-11-23
tags: [原生段落, 内容占位符, ch3, 翻新, 工作流]
supersedes: ""
---

# 原生 PPTX 直出工作流（ch3 式）

> 一句话性格：从源 PPT **代码层**复制段落树，在 PPTX 里重建**原生内容占位符**（一个文本框、
> 原生 lvl 缩进、原生 buChar 圆点），拒绝视觉模拟、拒绝一行一框。
> 2026-11-23 由 chapter3 P2 用户示范验收（对照用户手改的 chapter3_前10页_初审.pptx P2）。

## 1. 适用判断

- **走本工作流**：文字列表为主的整本 .ppt 翻新；用户要求"从代码层面把整段文字复制过来，
  参考原来的分段结构、对应的层级 tab 缩进"。
- **走 SVG 管线**（见 SKILL.md §3 / template-academic-modern.md）：图形页为主、需要工作台
  逐页裁决的翻新。两条路线可按页混合：文字列表页原生直出，图形页单独处理。

## 2. 工作流（每页五步）

1. **代码层提取**：python-pptx 打开 `sources/source.pptx`，遍历目标页每个含文字 shape 的
   段落树：`para.level`（层级）、runs 文本。空段（strip 后空）跳过；shape 名带"标题"的
   进标题框，其余进内容占位符。**禁止看图 OCR、禁止凭视觉模拟布局**。
2. **骨架复用**：从已验收的示范 pptx 复制整本，删除多余页只留结构页。内容占位符
   `<a:lstStyle>`（9 级 marL/indent/buChar 定义）原样保留——圆点符号、缩进量全由它定义。
3. **段落重建**：原版每个非空段落 → 一个 `<a:p>`（规范见 §3）。
4. **交付验证**：python-pptx 回读（页数/段数/每段 lvl/文字与源一致）+
   PowerPoint COM 渲染 PNG 目检（缩进层级、bullet 形态、行距、无折行）。
5. **图形页例外**：流程图/框图/表格无法段落化时保留独立 shape，框内文字仍按 §3 字体字号；
   复杂组图宁贴勿画。

## 3. 段落 XML 规范（每条都是验收示范页的实测值）

内容占位符典型框：x=914400 y=1219200 cx=10515600 cy=5334000（EMU），prst=rect。

每个段落 `<a:p>`：

```
<a:p>
  <a:pPr [marL="742950" lvl="2" indent="-342900"]      ← 二级；三级见下表
    eaLnBrk="0" fontAlgn="base" hangingPunct="0">
    <a:lnSpc><a:spcPct val="150000"/></a:lnSpc>        ← 行距 150%
    <a:spcAft><a:spcPct val="0"/></a:spcAft>
    <a:buClr><a:srgbClr val="1F4E79"/></a:buClr>       ← 圆点色
    <a:buSzPct val="125000"/>                          ← 圆点放大 25%
    <a:defRPr/>
  </a:pPr>
  <a:r>…<a:t>中文段</a:t></a:r>                         ← 中英按脚本拆 run
  …
</a:p>
```

- **层级映射**（对齐验收示范）：
  | 原文层级 | pPr 属性 | bullet（lstStyle 提供） |
  |---|---|---|
  | 一级 | 不设 marL/lvl/indent（用 lvl1pPr 默认） | • |
  | 二级 | `marL="742950" lvl="2" indent="-342900"` | – |
  | 三级 | `marL="1257300" lvl="4" indent="-342900"` | – |
  注意 `lvl` 属性是 0-based（lvl="2" → lvl3pPr）。
- **圆点是原生 buChar**（lstStyle 定义），**文字里绝不写圆点字符**。
- **run 字体**：`<a:latin>`/`<a:ea>` 都是 微软雅黑，
  panose="020B0503020204020204" pitchFamily="34" charset="-122"。
- **中英文按脚本拆 run**：CJK 段 lang="zh-CN" altLang="en-US"；
  Latin 段 lang="en-US" altLang="zh-CN"（PowerPoint 手工编辑的自然产物形态）。
- **字号**：一级 sz=2600，二级及以下 sz=2200。
- **段落末尾补空段**：`<a:p><a:pPr marL="0" indent="0"><a:lnSpc><a:spcPct val="150000"/>
  </a:lnSpc><a:buFontTx/><a:buNone/></a:pPr><a:endParaRPr kumimoji="1" lang="zh-CN"
  altLang="en-US" sz="1800"/></a:p>`。
- 原文的红字/黄底高亮：代码层**有**才做（红字改 rPr 字色、黄底用 `<a:highlight>`）；
  代码层没有的不许无中生有。

## 4. 颜色规范

| 用途 | 值 |
|---|---|
| bullet 圆点/短横 | #1F4E79（模板主蓝），buSzPct 125% |
| 正文 | 默认 tx1 黑 |
| 标题下划线 | #1F4E79，80→240 y=130，线宽 2 |
| 箭头/辅助线 | #5B7DA3 |
| 强调橙（图内标注） | #C25E00 |
| 原文红字/黄底 | 红字 #FF0000；黄底文字后垫 #FFE066（或 a:highlight） |

## 5. 字体字号规范

| 元素 | 字体 | 字号 |
|---|---|---|
| 页标题 | 微软雅黑 bold | 30pt |
| 正文一级 | 微软雅黑 | 26pt |
| 正文二级及以下 | 微软雅黑 | 22pt |
| 代码块 | Consolas | ≥18pt |
| 图注/公式文本 | 微软雅黑 | ≥18pt |

## 6. 铁律

- 段落边界跟着原文走：原文哪里分段/换级，新稿就哪里分段/换级，
  不许拍平层级，不许无中生有加段落。
- 圆点是原生 bullet 属性，不是图形、不是文字字符。
- 非装饰性文字 ≥18pt；塞不下就重排布局，不许缩字号。
- 不画页码（原文有且用户要求保留才画）。
- 每页交付前必须"COM 渲染 + 结构回读"双验证。
- 引擎绕行提示：若仍走 svg_to_pptx，需 `--reflow-text` +
  `<tspan data-paragraph-soft-break="0">` 强制分段 + `data-pptx-frame` 声明框宽，
  否则一行一框/长行折行（chapter3 P1 实测）；原生直出路线无此坑。

## 7. SVG 预览方言（工作台可审的中间层，2026-11-23 ch3 P1 验收）

工作台审核对象是 draft.svg——文字列表页在不走原生直出脚本时（或需要工作台展示时），
用本节方言写 SVG，导出后仍能得到 §3 的原生段落结构。

### 7.1 四层机制（PPT 原生属性 ↔ SVG 等价物）

| PPT 原生属性 | SVG 等价物 | 层 |
|---|---|---|
| sz=2600（字号） | font-size="26"/"22"（px） | 像素常量 |
| lnSpc 150% | dy="52"（固定行高） | 像素常量 |
| marL/indent 悬挂缩进（bullet 位 42/96px） | 行首前导 NBSP×3 / ×7 | 字面字符 |
| 文字起点 marL | bullet 后全角空格×1 | 字面字符 |
| buChar •/–（buClr 1F4E79，125%） | 字面 •/–（着色 tspan，字号×1.25） | 字面字符 |
| 段落独立 a:p | data-paragraph-soft-break="0" | 属性标记 |
| 段落属性本身 | postprocess v3.1 剥标记→注原生属性 | 后处理 |

### 7.2 方言模板（逐要素）

```svg
<text x="95" y="185" font-size="26"
  data-pptx-frame="90 150 1110 420" data-pptx-text-baseline="metrics-v1">
  <tspan font-size="32.5" fill="#1F4E79">• </tspan><tspan font-size="26">一级行</tspan>
  <tspan x="95" data-paragraph-soft-break="0" dy="52" font-size="22"
    fill="#1F4E79">   –　</tspan><tspan font-size="22">二级行</tspan>
  <tspan x="95" data-paragraph-soft-break="0" dy="52" font-size="22"
    fill="#1F4E79">       –　</tspan><tspan font-size="22">三级行</tspan>
</text>
```

- bullet（•/–）与层级缩进（前导 NBSP×3/×7）都是**字面字符**，可见可审；
  一级 bullet 字号 ×1.25（模拟 buSzPct 125%）。
- **每个行首 tspan 必须带 x=父 text 的 x**：只写 dy 会从上一行行尾续排，
  整页阶梯右移（#42；浏览器/工作台必现，PPTX 侧反而看不出）。
- `data-paragraph-soft-break="0"` 强制独立段落：不写时引擎按"行距聚类+同字号+
  非列表符"启发式判定，➢/– 等符号行会被误并进上一段。
- `data-pptx-frame="x y w h"` 显式框宽（w ≥ 最长行估宽+60）：缺失时按估算行宽
  折行竖排。`data-pptx-text-baseline="metrics-v1"` 保持基线一致。
- 行内强调（红字/加粗/Consolas）用**非定位 tspan**（无 x/y/dy）；
  黄底高亮 = 文字前独立 `<rect fill="#FFE066">`（z 序在下）。
- 字面标记在导出时由 postprocess v3.1 剥净转原生——SVG 里它们是文字
  （工作台编辑会选中），导出后是原生 bullet，这是中间形式固有形态。

### 7.3 验证（双道，每页必做）

1. **结构回读**：导出件 `[pa.text for pa in paras] == 源树文字列表` 逐字比对 +
   buChar/marL/lvl 抽查 + 行首标记残留计数（应为 0；原文正文自带连接符不算）。
2. **像素带检查**（无需视觉模型）：COM 导出 PNG → 逐行带找最左墨迹 x
   （应全部对齐文本框 x，无阶梯）；逐行带找最左蓝色像素 x
   （bullet 位应随层级 95→137→191 递增）。

### 7.4 工具链（已入库）

- 生成器：`station/prep/gen_native_list_svg.py <task_dir> --pages 11,12,...`
  （代码层提取→方言 SVG→write_draft mtime 保护写入；强调映射 --emphasis-file JSON）
- 转换+后处理：`station/export/export.py`（已接 --reflow-text + postprocess v3.1）
- 手写图形页的流程图/卡片元素仍按 §5 例外处理（独立 shape + 规范字体字号）。
