# PPT 工作台（ppt-station）

> 把这个文件夹交给任何 AI，跟它对话，就能翻新旧课件 / 从零做 PPT。
> 翻新过程中所有审美决策由**人拍板**，AI 只干执行；过程中不断**沉淀审美 .md**。

## 三分钟上手

1. **丢文件**：把要翻新的 .ppt/.pptx（或论文 PDF、素材）丢进 `inbox/`
2. **对话**：对任意 AI 入口（Claude Code / pi / …）说："读 <本工作区路径>/SKILL.md，翻新 inbox 里的老课件"
3. **按引导走**：AI 盘点 → 诊断 → 弹选择页（或聊天里快答）→ 出初稿 → 弹审核工作台 → 你逐页裁决/微调 → 聊天里说"导出"

## 当前能力状态（诚实声明）

**M0 刚完成：全部设计文档就绪，尚无代码。** 能力按里程碑渐进（见 `SKILL.md` §8 建设状态表）：
M1 收件箱盘点+准备链 → M2 初稿+导出 → M3 审核网页 → M4 编辑器 → M5 动效 → M6 从零做 → M7 模板复用。

## 目录导览

| 路径 | 是什么 | 谁能改 |
|---|---|---|
| `AGENTS.md` | 建设协作规矩（最高优先级） | 用户与 agent 协商 |
| `SKILL.md` | 运行手册（给任何接手的 AI） | 同上 |
| `docs/PLAN.md` | 建设方案 v1（冻结基线） | 改前必协商 |
| `docs/ppt-master-how-it-works.md` | 引擎机制导览 | 随引擎升级更新 |
| `ppt-master/` | 上游引擎（MIT，只读，带完整性校验） | **谁都不改** |
| `library/aesthetics/` | 审美库（核心资产，只增不删） | agent 提议+用户认可 |
| `station/` | 工作台代码（渐进生长） | 建设 agent |
| `projects/` | 任务工作区（状态皆文件） | 网页/聊天/AI 共享读写 |
| `inbox/` | 投料区（agent 只读盘点） | 用户随手丢 |
| `ref/` | 参考材料（旧流程样本等） | 只读 |

## 环境准备（M1 起需要）

- Windows + 本机 Office（老 .ppt 转换与截图走 COM）
- 换机克隆时带 submodule：`git clone --recurse-submodules <url>`；升级引擎：`git -C ppt-master pull` 后提交新指针
- 虚拟环境（AGENTS.md 规矩，绝不污染系统 Python）：

```bash
python -m venv .venv
.venv/Scripts/pip install flask python-pptx
```

- 运行任何项目脚本统一：`.venv/Scripts/python <脚本路径>`

## 更多文档

- 需求原文：`功能与界面说明.md`
- 设计详案（UX/工程决策全记录）：`docs/PLAN.md`
- 审美库契约：`library/aesthetics/AESTHETICS.md`
