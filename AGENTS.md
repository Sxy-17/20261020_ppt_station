# 本项目协作规则（最高优先级，每次会话先读）

## 开发节奏

- **每次只完成一个最小功能**，不要一次实现整个项目
- 修改前必须先解释：
  1. 要改什么
  2. 为什么改
  3. 会涉及哪些文件
- 修改后必须告诉我：
  1. 运行什么命令验证
  2. 应该看到什么结果
  3. **如果有错误，先解决错误，不要继续开发新功能**

## 代码风格

- 代码尽量简单，优先用容易理解的写法
- **不要为了"工程最佳实践"过度抽象**
- 关键代码必须添加中文注释，解释**"为什么这么写"**，而不仅仅是"这行代码做什么"
- 宁可重复，不要提前抽象；等第二个用例出现再考虑封装

## 环境规矩

- **装任何 Python 包必须在虚拟环境里**（工作区根的 `.venv`），不污染系统 Python
- 运行项目脚本统一用：`.venv/Scripts/python <脚本路径>`

## 工作区结构（可迁移架构）

```
20261020_ppt_station/
├── AGENTS.md / README.md / SKILL.md   ← 三份入口文档（协作规矩/人看/运行手册）
├── 功能与界面说明.md                    ← 原始需求书
├── docs/
│   ├── PLAN.md                        ← 建设方案 v1（冻结，改前必与用户协商）
│   └── ppt-master-how-it-works.md      ← 引擎机制导览
├── ppt-master/                        ← 上游引擎，【只读，一字不改】
├── library/aesthetics/                ← 审美库【核心资产，只增不删】
│   └── AESTHETICS.md                  ← 契约（先读它再写库文件）
├── station/                           ← 我们的代码（见 station/README）
├── projects/                          ← 任务工作区（状态皆文件，见 projects/README）
├── inbox/                             ← 用户投料区（agent 只读盘点，见 inbox/README）
└── ref/                               ← 用户参考材料（含 workbuddy 旧流程，只读）
```

修改规矩：
- `ppt-master/` 绝不修改；调用走绝对路径；每会话先用其 `attribution_guard.py` 验完整性
- `library/aesthetics/` 只增不删；写前先读 `AESTHETICS.md` 契约；契约变更需用户协商
- 新代码只进 `station/`；运行状态只进 `projects/`；用户文件只在 `inbox/`/`ref/` 里被读
- 中间形式唯一：规范化 SVG（ppt-master 方言）；任何新功能不得引入第二中间形式
