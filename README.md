# dsh-prompt-refiner（增强版）

> 本仓库是 [kee0012/dsh-prompt-optimizer](https://github.com/kee0012/dsh-prompt-optimizer) 的增强分支，遵循原项目 MIT 许可。增强内容：可核查标准展开、`{{变量}}` 占位符保护、受众/背景显式落地、【placeholder】规范、上下文使用纪律、输出契约修复——只改服务端提示词措辞，UI 与交互保持原样。

DSH 提示词优化插件：在输入框工具栏放一个 ✨ 按钮，用当前会话所选模型优化草稿并直接写回。

## 简介

插件在输入框底部工具栏（模型选择左侧）注册一个紧凑的 **✨ 图标按钮**。写好一段提示词草稿后点一下 ✨，插件会调用**当前对话所选的大模型**完成一次提示词优化，并把结果**直接写回输入框**——日常使用一键完成，无需先展开任何设置。

## 功能特性

- **一键优化**：点 ✨ 即可，自动读取当前草稿与当前模型，按生效设置优化并直接写回输入框。
- **使用当前模型**：跟随当前会话的模型选择（provider / model / reasoningEffort），无需单独配置。
- **深度理解**：系统提示词要求模型先分析字面意思、真实意图、角色、任务、上下文、受众、输入、约束、输出格式与歧义点，再动手改写。
- **优化风格**：`精简` / `标准` / `详细` 三选，在 ▾ 弹出层切换并跨会话记忆。
- **还原原文**：应用前会把原文备份到 localStorage，随时可一键还原（有备份时 ✨ 组右缘出现一个小圆点提示）。
- **预览确认**：可切到「预览确认」，先对照原文与优化结果，确认后再写入。
- **防覆盖**：直接应用时若请求期间草稿已被改动，自动降级为预览弹窗，不覆盖你正在输入的新内容。
- **上下文感知**：可开启「上下文」，让优化模型参考当前会话最近几条消息。
- **稳定输出**：服务端固定 `temperature = 0.4`，减少随机放飞。
- **失败提示**：请求失败或模型无返回时，按钮旁弹出错误 toast（数秒后自动消失），按钮 title 也会保留错误信息。
- **紧凑常驻**：只有一个 ✨ 图标 + 右侧小三角 ▾（合计约 50px），风格、上下文、还原等设置全部收进 ▾ 弹出层。

## 安装

插件托管在 GitHub（`kylinmoddev/dsh-prompt-refiner`，未发布到 npm），DSH 支持以 git 依赖方式直接安装：

```sh
# 从 GitHub 安装（推荐，日常使用；拉取默认分支最新提交）
dsh plugin --profile desktop add github:kylinmoddev/dsh-prompt-refiner
```

> 安装后需要**重启 DSH**，新的服务端代码与 client bundle 才会生效。

## 使用

1. 在输入框输入或粘贴一段提示词草稿。
2. 直接点击模型选择左侧的 **✨ 图标**。
3. 等待当前模型返回，优化结果自动写入输入框（原文已备份）。
4. 想还原原文：点 ✨ 旁的小三角 ▾ → 「↩ 还原原文」。
5. （可选）进阶：点 ▾ 展开设置，可切换优化风格（精简 / 标准 / 详细）、开启「上下文」、把应用方式改为「预览确认」，或恢复默认设置；这些选择会跨会话记忆。

## 兼容性

- **前端**：桌面版与 `dsh web` 均可用（服务端路由对桌面 `dsh-app://app` 的 Origin 缺失场景做了显式放行）。
- **DSH 版本**：`>= 0.1.7-0`（依赖 `ctx.llm.resolveModelInfo` 做 reasoningEffort 能力先验，该 API 自 dsh-llm 0.1.7-0 起可用；更早版本上 effort 先验会静默跳过，不影响其余功能）。
- **Node**：`>= 18`（仅构建/测试脚本需要；运行时随 DSH 进程）。
- **与原版并存**：本插件包名、插件 id、路由前缀（`/dsh-prompt-refiner/*`）、样式 id 与设置存储键均独立，可与 `kee0012/dsh-prompt-optimizer` 同时安装，靠启用开关切换；服务端路由与快捷设置互不干扰。
- **不支持**：图片输入（附件字节取不到，遇到会明确报错而不是静默丢弃）。

## 实现方式

- **客户端**：注册到 `conversation.input.right` 插槽，读取并写回输入框草稿，设置保存在 localStorage。
- **服务端**：注册同源 HTTP 路由 `POST /dsh-prompt-refiner/optimize`，按风格拼接系统提示词，以 `temperature = 0.4` 调用 DSH 的 LLM 适配器并回传优化文本。
- 该路由只接受本机 UI 发起的请求（同源校验，其它来源一律 403），请求体上限 1 MiB。
- 插件只传递 `provider`、`model`、`text`、`style` 等必要字段，**不接触凭据文件**。

## 目录结构

```
dsh-prompt-refiner/
├── package.json          # DSH bundle 清单 + client 注入声明
├── cordis.patch.yml      # 把插件插入 DSH 组合层
├── LICENSE               # MIT
├── README.md
├── src/index.js          # 服务端源码：HTTP 路由 + 调用 ctx.llm.stream()
├── client/client.js      # 客户端源码：✨ 按钮 + ▾ 设置弹出层 + 一键写回草稿
└── lib/                  # 构建产物（随仓库发布，安装时直接加载）
    ├── index.js
    └── client.js
```

`src/` 与 `client/` 是源码；`lib/` 是构建产物，使用者无需自行构建。

## 调试与日志（fork 补丁，0.5.1）

0.5.0 引入的「失败熔断」把异常伪装成成功（`ok:true` + 原文 + `fallback`），而前端从未读取 `fallback`，
于是「模型没改写」被当成「已应用」：输入框纹丝不动，却提示成功。0.5.1 起失败可诊断：

**前端（浏览器 DevTools 控制台）**

```
[dsh-prompt-refiner] optimize request  {...}
[dsh-prompt-refiner] optimize response {ok, fallback, optimizedChars, identicalToDraft}
[dsh-prompt-refiner] optimize produced no change; original kept {fallback: 'empty-result'}
[dsh-prompt-refiner] draft written via inputActions.setDraft {chars}
[dsh-prompt-refiner] draft write confirmed {chars}
```

最近 50 条事件也在内存里：`window.__dshPromptRefinerDebug.events`。

当 `optimized` 与草稿相同（或带 `fallback`）时，插件**不再写草稿、不写备份**，而是弹红色提示说明原因
（`llm-error` 模型调用失败 / `empty-result` 返回为空 / `intent-check` 改写丢失 `【】`、`{{变量}}`、链接）。

**服务端（走 journald，不落在插件目录）**

```sh
journalctl -u deepseek-harness -f | grep dsh-prompt-refiner
```

每个请求、每次降级、每次异常都会记录 provider / model / style / 字数 / 失败原因与错误码。

**版本自检**

```sh
curl -s http://127.0.0.1:3080/dsh-prompt-refiner/ping   # {"version":"0.5.1",...}
```

## 已知限制

- 优化结果的质量取决于当前所选模型，不同模型的表现差异明显。
- 「还原原文」依赖 localStorage 备份，只在同一浏览器、同一会话内有效；清理站点数据或更换设备后无法还原。
- 优化是一次完整的全文重写，草稿越长耗时越久；请求体上限为 1 MiB。
- 本 fork 以 `file:` 依赖装入 profile，`dsh plugin update` 不会自动跟进上游；需要时可重新从上游安装回退。

## 反馈与贡献

- 本增强分支问题反馈：<https://github.com/kylinmoddev/dsh-prompt-refiner/issues>
- 原版插件与上游问题：<https://github.com/kee0012/dsh-prompt-optimizer/issues>
- 欢迎提交 Issue 与 Pull Request。

### 从源码构建

```sh
npm run build    # src/ 与 client/ → lib/（仅用 Node 内置模块，无构建工具链依赖）
npm run gates    # 产物一致性门禁
npm run check    # build + 语法检查 + gates，一条命令跑全链路
```

`src/` 与 `client/` 是唯一的手写来源，`lib/` 由构建脚本生成，请不要手改 `lib/`。

## 许可证

MIT
