---
id: motion-timeline-reveal
type: motion
name: 渐开时间轴（Morph 双页配对）
applies: 时间轴/流程推进类页面；同一张图逐页变一步的渐进讲解序列（如 P7-15 型）
source: 起步撰写
created: 2026-10-28
tags: [时间轴, morph, 渐进序列]
supersedes: ""
---

# 渐开时间轴（Morph 双页配对）

一句话性格：**差异即动画**——不做关键帧，把时间轴的两个状态做成相邻两页，
PowerPoint Morph 自动插值出"逐渐展开"。

## 配方

1. **状态页成对**：第 N 页=时间轴到节点 k；第 N+1 页=同一画布+节点 k+1（及连线）
   新增。**所有已有元素坐标逐字不变**（序列保位，sequence.py 检测的组尤其如此）
2. **对象身份**：延续元素保持相同 `id`；Morph 按 id 强配对（不确定时在
   animations.json 声明 morph.pairs）
3. 页 N+1 根元素转场 `transition: {effect: morph, duration: 0.6}`
4. 新节点可叠 `entrance_wipe 0.4`（Morph 之外的强调）

## 禁止

- 元素"跳位"（上一页在某处、下一页挪走——会变成整块滑动而非生长）
- 一页塞满全部节点然后靠出现动画（那是旧思维，丢失 Morph 的生长感）

## animations.json 片段（任务级，页号寻址）

```json
{"pages": {"13": [{"group": "page-title", "effect": "entrance_fade", "order": 1, "duration": 0.3}],
           "14": [{"group": "transition", "transition": {"effect": "morph", "duration": 0.6}}]}}
```
