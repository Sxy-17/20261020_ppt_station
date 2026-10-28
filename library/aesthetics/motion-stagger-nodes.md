---
id: motion-stagger-nodes
type: motion
name: 逐节点入场（stagger 节奏）
applies: 流程图/架构图页；讲解顺序=页面信息顺序时（拓扑序入场）
source: 起步撰写
created: 2026-10-28
tags: [入场, 节奏, 拓扑]
supersedes: ""
---

# 逐节点入场（stagger 节奏）

一句话性格：**图按讲解顺序长出来**——节点逐个入场，连线随后跟上，
观众视线被牵着走；默认关，用户点名才开（反 AI 味纪律）。

## 配方

1. **分组即锚**：draft.svg 里每个节点（含标签）独立 `<g id>`（拓扑图单组
   契约 R19 的内部子组正好做锚点）
2. **拓扑序**：入场 order 按数据流方向（源→汇），不是阅读 Z 序
3. **节奏**：每节点 0.3s `entrance_fade`（或 wipe），间隔 0.15-0.2s；
   连线在两端节点之后入场（`entrance_wipe` 从源端扫向汇端）
4. 结论/标题条最后入场（`order` 最大），全图完成→落点句出现
5. 一页节点 >8 时分组入场（每 3-4 个一批同 order），别碎成雨点

## 禁止

- 全元素同 order 齐刷刷（等于没有入场）
- exit/emphasis 混在入场页（信息页保持单一动作词汇）
- 默认全局开——每页要有"为什么需要动"的理由，否则保持静态

## animations.json 片段

```json
{"pages": {"2": [
  {"group": "node-expert",   "effect": "entrance_fade", "order": 1, "duration": 0.3},
  {"group": "edge-expert-compiler", "effect": "entrance_wipe", "order": 2, "duration": 0.3},
  {"group": "node-compiler", "effect": "entrance_fade", "order": 3, "duration": 0.3},
  {"group": "bar-common",    "effect": "entrance_wipe", "order": 9, "duration": 0.5}
]}}
```
