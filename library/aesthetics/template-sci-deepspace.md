---
id: template-sci-deepspace
type: template
name: 科研·深空
category: 科研
palette:
  background: "#0B1220"
  secondary_bg: "#151F33"
  primary: "#4C8DFF"
  accent: "#22D3EE"
  secondary_accent: "#8B5CF6"
  body_text: "#E6EDF7"
fonts:
  heading: 思源黑体
  body: 思源黑体
  mono: JetBrains Mono
applies: AI/计算类科研汇报、技术分享、demo 日；含代码、模型架构图
source: 起步撰写
created: 2026-10-27
tags: [科研, 深色, 科技]
supersedes: ""
---

# 科研·深空

一句话性格：**深空底色上的高对比数据美学**——像观测台，内容是星，界面隐去。

## 形状与装饰

- 深底浅字，层次靠亮度不靠阴影；卡片 = secondary_bg 底色块 + 1px 亮边（primary 30%）
- "发光"只给关键数据：accent 青色数值可加轻微 glow（半径 ≤4px），每页最多一处
- 网格/坐标线允许作为背景纹理（primary 8% 透明度），营造仪器感

## 排版层级

- 标题 32-36 加粗白字；正文 16-18 body_text（勿用纯白，#E6EDF7 更柔）
- 代码/公式页：mono 字体面板（secondary_bg 底、左上角三个窗口点可选）
- 数字大而冷静：关键指标做成"仪表读数"——大号 accent 数字 + 小灰标签

## 用色纪律

- background 深空蓝黑打底；primary 亮蓝承担结构与图表主系列
- accent 青是信号色：最新结果、活跃状态、重点数字
- secondary_accent 紫只出现在图表第三系列，勿用于文字

## 图形配方倾向

- 架构图：分层横带（数据层/模型层/输出层），层间箭头用 primary，模块内连线用灰
- 流程图：圆角节点 + 单向箭头，当前步骤 accent 描边（"电路通电"感）

## 禁止清单

- 深底放低对比灰字（可读性红线）
- 多处 glow（星海变灯海）
- 用暖色系（橙红黄）——与深空冷调打架，除用户明确要求
