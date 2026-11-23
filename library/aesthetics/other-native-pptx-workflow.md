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
