# 浅克隆保障方案（SHALLOW-CLONE）

> 目标：新用户 `git clone --depth 1 <url>` 即可获得可用环境；
> 引擎缺失时报错可自解。分层实施，逐级增强。

## 现状与故障面

浅克隆（或未带 `--recurse-submodules`）时 `ppt-master/` 目录为空：

| 环节 | 影响 | 现状 |
|---|---|---|
| 准备链（盘点/收编/截图/抽取/诊断/批量出稿） | 不受影响（纯本地脚本） | ✅ |
| 导出 / 编辑器保存 / 质检门 | 失败 | ✅ 已有守卫：报"引擎未拉取"+ 修复命令，不再裸异常 |
| submodule 拉取 | 依赖 GitHub 连通；raw/api 域名在部分网络被污染 | 守卫兜底，拉取仍靠用户网络 |

## 分层方案

### Tier 0 · 已完成：入口守卫 + 文档

export.py / qc.py / server 保存端点三处守卫，统一提示：

```
git submodule update --init --depth 1 ppt-master
```

README 环境要求已含此命令。

### Tier 1 · 立即执行：浅克隆友好配置（零风险）

1. `.gitmodules` 增 `shallow = true`——普通 clone 后 `submodule update` 也自动浅取
2. README 克隆命令统一为：

```bash
git clone --depth 1 --recurse-submodules --shallow-submodules <url>
```

效果：主仓 + 引擎均为单提交历史（省约 130MB）。

### Tier 2 · 待批：引擎自举脚本（网络救命通道）

`station/setup_engine.py`：绕过 submodule，直接下载 GitHub 归档：

- URL：`https://github.com/hugohe3/ppt-master/archive/<pin-commit>.tar.gz`
  （github.com 主域，与 git push 同源——比 raw/api 域名存活率高）
- 校验：解压后跑引擎 `attribution_guard.py`，通过才落位
- 降级：域名不通时提示代理/稍后重试（不做多镜像黑魔法，保持诚实）
- README 提供"两种初始化路径任选其一"

### Tier 3 · 备选暂缓：subtree 化

引擎以 subtree 并入主仓——浅克隆天然完整，无需任何后续命令。
代价：主仓 +~72MB；上游升级改走 subtree pull；与"上游只读独立克隆"原则冲突。
仅当出现大规模分发/CI 需求时再评估。

## 验证矩阵（每 Tier 落地后执行）

```bash
# 干净目录模拟浅克隆（本地 file:// 协议，不耗网络）
git clone --depth 1 --no-recurse-submodules file:///c:/!Minerva/workspace/20261020_ppt_station tmp/clone_test
# ① 无引擎状态：export 应打印守卫提示（非裸异常）
# ② 按 Tier1/2 修复路径补引擎 → attribution_guard 通过
# ③ export 单页成功 → 清理 tmp/clone_test
```

## 决策记录

- 2026-10-28：Tier 0 已上线；Tier 1 本文档同批落地；Tier 2/3 待用户批准。
