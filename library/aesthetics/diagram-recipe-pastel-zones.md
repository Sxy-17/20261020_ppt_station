---
id: diagram-recipe-pastel-zones
type: diagram-recipe
name: 淡彩分层架构图（TorchTurbo 风）
category: 科研
palette:
  background: "#FFFFFF"
  secondary_bg: "#F6F8FB"
  primary: "#1677FF"
  accent: "#0958D9"
  secondary_accent: "#96A3B5"
  body_text: "#334358"
fonts:
  heading: Arial / 思源黑体
  body: Arial / 思源黑体
applies: 系统架构/技术栈/分层模块图；README 与技术文档配图气质
source: 外部迁移（用户投喂：inclusionAI/TorchTurbo architecture-en.svg，2026-10-28）
created: 2026-10-28
tags: [架构图, 淡彩, 分层, 工程风]
supersedes: ""
---

# 淡彩分层架构图（TorchTurbo 风）

一句话性格：**白底上按"色相家族"铺淡彩分层带，一层一色系、层内近白，
只留一处鲜蓝当主角**——工程文档的克制优雅（Stripe/Linear docs 气质）。

## 层带着色规则（本配方灵魂）

每层一个**色相家族**，底色-描边同族不同深（底 ≈ 5-8% 饱和度，边 ≈ 25%）：

| 层示例 | 底色 | 描边 | 副标题字色 |
|---|---|---|---|
| 冷蓝灰 | #F6F8FB | #DFE5ED | #4D5C6F |
| 薰衣草 | #F7F5FC | #E0D9F0 | #6A6083 |
| 浅蓝（主角层） | #EDF5FF | #A9CCF9 | #0958D9 |
| 暖米 | #FCF8F1 | #EADFCB | #83694E |
| 薄荷 | #F3F8F6 | #DEEBE6 | #2D6A60 |

主角层（当前讲解的引擎/核心）用**唯一鲜色 #1677FF**（填充或标题），
全图仅此一处饱和色。层内卡片 = 白底 + 同族描边或无描边。

## 文字阶梯（蓝灰系五级，而非纯灰）

#26354A(heading 28/700) → #334358(item 22/600) → #4D5C6F(body 20/400)
→ #5F6D80(note 18/400) → #68768A(eyebrow 18/600 + 字距 1.2px 大写眉题)。
灰要带蓝相，与淡彩层同温。

## 形状与连线

- 卡片圆角 6-18，外层容器 24（圆角统一族，不混直角）
- 描边一律细线 1.5；连接线 #96A3B5 2px 圆帽 + 小箭头 marker，**全部同色**
- 分隔线 #C2CBD8 1.25px
- **零渐变、零阴影、零虚线**——平面即秩序

## 禁止

- 饱和色超过一处；层带用撞色（色系必须近邻淡彩）
- 纯黑/纯灰文字（一律蓝灰系）
- 连接线上色（线永远是中性灰，颜色属于层）
