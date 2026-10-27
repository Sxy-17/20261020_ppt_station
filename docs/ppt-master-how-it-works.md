# ppt-master 机制导览（给建设/接手 agent 的地图）

> 路径约定：`${PM}` = `<工作区>/ppt-master/skills/ppt-master`。引擎只读，一字不改。
> 本导览只画地图；细节以引擎自带文档为准。

## 1. 三层结构

```
SKILL.md            入口：加载顺序 + 全局纪律（不装具体流程）
workflows/
  routing.md        路由权威：三条顶层路线 + stage 触发条件表
  generate-pptx.md  Generate 路线权威：Step 1–7（定义"Step"）
  edit-native-pptx.md / create-template.md  另两条路线
  profiles/         同路线变体（quick-generate 等，自带裁剪步骤）
  stages/           可插拔子流程（定义"Stage"：live-preview/refine-spec/…）
references/         能力文档：visual-styles(19 风格)/executor 族/semantic-svg/…
scripts/            全部工具（python）
templates/          版式库/styles 库/图标/音效
```

**Step vs Stage**：Step 是路线权威文档里的串行主干（含 ⛔BLOCKING 闸）；Stage 是
`stages/` 里的条件子流程，由 routing.md §3 的条件表决定何时挂载。

## 2. 完整性门（每次会话先跑）

```bash
.venv/Scripts/python "${PM}/scripts/attribution_guard.py"
```
校验 LICENSE 哈希 + 关键 gate 脚本 + SKILL.md 元数据。非零即停，不修不绕。
**推论**：引擎目录删任何文件都有风险，升级用 `git -C ppt-master pull`。

## 3. 我们复用的核心机制（按重要度）

| 机制 | 位置 | 我们怎么用 |
|---|---|---|
| **SVG→PPTX 编译器** | `scripts/svg_to_pptx/` | 导出的命脉：SVG→原生 DrawingML（python-pptx 骨架+直写 slide XML+重打包）。M2 做薄封装 |
| 源抽取一族 | `scripts/source_to_md/`（ppt_to_md 等） | 准备链参考实现：抽文字/表格/SmartArt/图片清单 |
| 编辑器服务器 | `scripts/svg_editor/server.py` + `scripts/docs/svg_editor.md` | 工作台服务器模式蓝本：锁文件/端口发现/draft 防丢/直改 vs 批注双轨 |
| 确认页服务器 | `scripts/confirm_ui/server.py` + `scripts/docs/confirm_ui.md` | 选择页蓝本：daemon+健康检查/--wait-only 收据等待/SHA 内容绑定/聊天回退 |
| 视觉风格文体 | `references/visual-styles/*.md` | 审美库 template 类的文体参考（"纪律文档"写法） |
| 动效体系 | `references/animations.md` + `scripts/pptx_animations.py` + 预设注册表 | 100+ 原生效果 + Morph 配对页；导出后 PPT 动画窗格可改时长。M5 封装 |
| 语义 SVG 方言 | `references/semantic-svg.md` + preset 词汇表 | 中间形式的方言规范：187 预设轮廓标记、真 text、组合纪律 |
| 动画之外的后处理 | `scripts/pptx_transitions.py` 等 | 以后按需 |

**不直接复用**的：confirm_ui 的 result.json 契约（绑其项目结构，我们抄思想不抄实现）；
create-template 路线整体（M7 再评估直接跑还是薄封装）。

## 4. 值得偷的工程细节

- **收据模式**：agent 写推荐 json → 网页写收据 json → SHA-256 绑定，改推荐即作废旧收据（防陈旧确认）
- **单实例锁**：`live_preview/lock.json` 记 pid+端口；URL 永远从锁文件读，不猜默认端口
- **draft 防丢**：未应用的网页编辑先落 `draft.json`，重开服务恢复
- **等待三态**：阻塞等（confirm_ui `--wait-only`）/ 从不等（spec_review，用户回聊天喊人）/ 常驻不等（svg_editor）
- **渲染一致性**：visual_review.py 用 Playwright 无头 Chromium 渲 SVG（非 cairosvg——中文字体链会出豆腐块）；"审核所见=导出所得"的基石之一

## 5. 版式库速查（templates/，可作生成参考）

- `layouts/`：6 套版式包（presentation_core 16:9/4:3、report_core 等），每套 10-20 个 SVG 模板 + design_spec
- `styles/`：14 套风格 spec（academic-research、technical-deepdive…）
- `icons/tabler-outline/`：5000+ 线形图标，生成时经 `icon_sync.py` 取用
- `charts/` `tables/`：图表/表格词汇表

## 6. 文档地图（需要深挖时按此顺序读）

1. `workflows/routing.md`（路由总纲）
2. 对应路线权威（如 `generate-pptx.md`）
3. `references/semantic-svg.md` + `scripts/docs/svg-contract.md`（中间形式契约）
4. `scripts/docs/svg_editor.md` / `confirm_ui.md`（服务器模式）
5. `docs/technical-design.md`（引擎自述架构）
