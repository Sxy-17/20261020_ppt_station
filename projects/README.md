# projects/ · 任务工作区

每个翻新/生成任务一个子目录（ASCII 名，中文交付名最后再改——ref 实践教训）。

## 单任务结构（M1 起生效）

```
projects/<任务名>/
├── sources/source.pptx      # 原件（拷贝入内，动原文件是大忌）
├── project.json             # 画幅/模板/状态/断点
├── diagnosis.json           # 准备链体检结果
├── selection.json           # 选择页确认收据
├── outline.json             # B 路线大纲（双入口：卡片 UI / 聊天）
├── pages/001/
│   ├── original.png         # 旧页截图（左栏 + 保底贴图）
│   ├── text.md              # 抽出的文字
│   ├── meta.json            # 页面角色/图形元素计数/推荐裁决
│   ├── draft.svg            # 当前稿（唯一中间形式）
│   └── verdict.json         # 裁决 + 意见
├── pending_requests.jsonl   # 意见队列（双入口单队列）
├── batch_log.jsonl          # 批量操作审计
└── exports/                 # 最终 pptx
```

**状态皆文件**：网页、聊天、任何接手的 AI，读写同一批文件——这是"审核中断随时回来"和"换会话接手"的全部秘密。
