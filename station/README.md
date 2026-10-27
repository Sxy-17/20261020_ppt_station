# station/ · 工作台代码

我们写的全部代码，按里程碑渐进生长（当前 **M0：空骨架，尚无代码**）：

| 目录/文件 | 内容 | 里程碑 |
|---|---|---|
| `server.py` | Flask 常驻服务：选择页 + 审核工作台（模式抄 ppt-master confirm_ui/svg_editor：localhost + 锁文件 + JSON 传话） | M3 |
| `prep/` | 收件箱盘点（轻体检）/ 准备链（COM 转换、逐页截图、抽文字、诊断） | M1 |
| `export/` | svg_to_pptx 薄封装（ppt-master 绝不深改，只包一层） | M2 |
| `static/` | 前端（无构建链，原生 ES Modules + CSS tokens，UX 基准见 docs/PLAN.md §2.3A） | M3/M4 |

## 代码规矩（继承 AGENTS.md，此处细化）

- 运行一律 `.venv/Scripts/python <脚本>`；装包进 `.venv`
- 关键代码中文注释解释**为什么**
- 不为未来抽象；宁可重复
- ppt-master 只以绝对路径调用，一字不改
