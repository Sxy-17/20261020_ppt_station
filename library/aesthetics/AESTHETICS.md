# 审美库契约（AESTHETICS.md）

> 一篇 .md = 一条审美。**只增不删**。库是增益不是前提：库空时 agent 用自身设计能力。
> 本契约的任何变更需与用户协商后生效（这是纪律，不是流程建议）。

## 1. 文件与命名

- 位置：`library/aesthetics/*.md`，平铺不建子目录（某类型超 ~10 篇再议分目录）
- 命名：`<type>-<slug>.md`，slug 用 kebab-case 英文，如 `template-academic-modern.md`
- 一篇一个 id，id 与文件名一致，全局唯一，永不复用

## 2. Frontmatter 契约

```yaml
---
id: template-academic-modern        # 唯一 id，同文件名
type: template                       # 枚举见 §3
name: 学术·现代                       # 展示名（界面 3 卡片用）
category: 学术                       # 仅 template 类需要：自由个性/科研/学术/…（可扩，扩前协商）
palette:                             # 仅 template/palette 类：六角色色板 tokens
  background: "#FFFFFF"
  secondary_bg: "#F5F7FA"
  primary: "#1F4E79"
  accent: "#C25E00"
  secondary_accent: "#5B7DA3"
  body_text: "#1D2430"
fonts:                               # 用本机已装字体名
  heading: 思源黑体
  body: 思源黑体
  mono: Consolas
applies: 科研汇报、组会、项目进展；内容密度中高   # 何时用/不用
source: 起步撰写                     # 起步撰写/翻新沉淀/美化沉淀/opus迁移/用户投喂
created: 2026-10-27
tags: [学术, 现代, 稳重]
supersedes: ""                       # 替代哪篇的 id（只增不删的替代机制）
---
```

## 3. type 枚举（起步六类 + other，分类体系未来与用户重新约定）

| type | 内容 | 被谁消费 |
|---|---|---|
| `template` | 色板 tokens + 字体 + 版式纪律（必须/禁止/构图配方） | 选择页卡片 + 全部页面生成 |
| `palette` | 独立配色积累（不带版式立场） | template 组装参考 |
| `motion` | 动效配方：Morph 配对页配方 / animations.json 片段 + 适用场景 | 动效场景、B 路线生成 |
| `diagram-recipe` | 图形配方：节点样式/箭头语言/布局网格/着色规则 | 图形页初稿、重绘、✦美化选中 |
| `page-role` | 某类页面（封面/目录/数据页…）的成熟版式 | 初稿生成的版式库 |
| `narrative-flow` | 整份 PPT 的故事脉络骨架 | B 路线大纲生成 |
| `other` | 未分类（先入库，类型将来协商） | —— |

## 4. 正文写法

自然语言法则，写给 agent 当纪律读。参考文体：`ppt-master/skills/ppt-master/references/visual-styles/*.md`（仿其"纪律文档"风格，中文化、更紧凑）。建议小节：

- **一句话性格**：这个审美一句话说清
- **形状与装饰**：形状语言、装饰的允许/禁止
- **排版层级**：字号阶梯、字重对比、对齐纪律
- **用色纪律**：六个色各自什么角色、强调色的克制规则
- **图形配方倾向**（diagram-recipe 必有）：节点/箭头/布局/着色
- **禁止清单**：一眼排除的"AI 味"特征

## 5. 进料渠道（库最重要的四条水管）

1. **起步撰写**：agent 仿 visual-styles 写（本库头四篇即此）
2. **翻新沉淀**：用户裁决"通过"的页面设计 → agent 主动提议沉淀（必执行钩子）
3. **美化沉淀**：用户认可的 ✦美化结果 → 同上，diagram-recipe 的最佳进料
4. **opus/外部迁移**：用户截图或 python 代码 → agent 翻译成本库方言 → 用户审 → 入库

## 6. 修改规矩

- **只增不删**：写错了/过时了 → 写新篇，`supersedes: 旧id`，旧篇保留（历史即资产）
- 消费方读库时按 id 取最新有效篇（被 supersede 的跳过）
- 色板 tokens 是硬数据（生成器直接读），正文的纪律是软约束（agent 遵守但可向用户申诉）
