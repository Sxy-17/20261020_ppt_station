---
id: template-chalkboard
type: template
name: 板书
category: 科研
palette:
  background: "#2A3B3F"
  secondary_bg: "#35474C"
  primary: "#E8EDE6"
  accent: "#F2C94C"
  secondary_accent: "#9FC2BC"
  body_text: "#E8EDE6"
fonts:
  heading: 楷体 / 霞鹜文楷
  body: 楷体 / 思源黑体
  mono: Consolas
applies: 课堂讲授、推导讲解、算法课；想保留"上课感"的翻新
source: 起步撰写（仿 ppt-master chalkboard 精神）
created: 2026-10-28
tags: [板书, 教学, 深底]
supersedes: ""
---

# 板书

一句话性格：**深绿黑板 + 粉笔白 + 黄粉笔强调**——把"讲课"两个字写在版面上。

## 形状与装饰

- 手绘感线条（2-3px，端点圆）；分隔线略斜或波浪
- 重点"粉笔框"：黄色 2.5px 徒手框（矩形允许微倾斜 1-2°）
- 不用卡片底色；分区靠留白与手绘线

## 排版层级

- 楷体大标题（36-44）像板书课题；正文楷体 18-20 保持"写"感
- 推导竖排逐步写，箭头引出结论；结论框黄粉笔描出

## 用色纪律

- 白/米粉笔色承担全部正文；黄粉笔只给结论、关键变量、重点框（每页 ≤3 处）
- 允许蓝粉笔（secondary_accent）做辅助标注

## 图形配方倾向

- 树/图结构用圆圈+手绘线；CFG 类用椭圆节点+弯箭头
- 与 diagram-recipe-whiteboard-arrows 搭配

## 禁止清单

- 渐变、阴影、真照片、图标库图形
- 大段正文（板书是写的不是贴的，每页 ≤80 字）
- 纯白底（那就不是板书）
