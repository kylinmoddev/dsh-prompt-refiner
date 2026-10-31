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
- **还原原文**：应用前会把原文备份到 localStorage，随时可一键还原（有备份时 ✨ 组右缘出现一个小圆点提示）。若当前草稿已与备份的优化结果不一致，还原会被阻止并提示，避免覆盖新输入。
- **预览确认**：可切到「预览确认」，先对照原文与优化结果，确认后再写入。
- **防覆盖**：直接应用时若请求期间草稿已被改动，本次结果直接丢弃并提示（0.5.2 起不再弹预览），不覆盖你正在输入的新内容。
- **超时保护**：客户端 90 秒中止请求、服务端单次模型调用 75 秒降级；超时只提示失败，不写草稿、不丢原文（见下文「超时与失败降级」）。
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

## 调试与日志（fork 补丁，0.5.1 起）

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
curl -s http://127.0.0.1:3080/dsh-prompt-refiner/ping   # {"version":"0.5.6",...}
```

## 超时与失败降级（0.5.5 起）

0.5.2 最初给客户端设了 **90 秒硬上限**，实测证明太紧：12k 字草稿 + 多候选需要 100 秒以上，
90 秒一到客户端就 abort，而服务端还在算——等于白烧一次调用。0.5.5 起改成"预算 + 提示"两段式：

| 位置 | 常量（文件） | 默认值 | 到达时的行为 |
| --- | --- | --- | --- |
| 客户端·单候选 | `REQUEST_TIMEOUT_MS`（`client/client.js`） | **180 秒** | `AbortController` 中止 fetch，toast 提示实际上限；不写草稿、不写备份 |
| 客户端·多候选 | `MULTI_CANDIDATE_TIMEOUT_MS`（`client/client.js`） | **300 秒** | 同上（2 次生成 + 1 次裁判，是单候选的 2~3 倍） |
| 客户端·慢请求提示 | `SLOW_REQUEST_NOTICE_MS`（`client/client.js`） | **90 秒** | **只弹提示「生成较慢，仍在等待（最长 N 秒）」，绝不中断** |
| 服务端·单次 LLM 调用 | `OPTIMIZE_TIMEOUT_MS`（`src/index.js`） | **75 秒**（可用 `DSH_PROMPT_REFINER_TIMEOUT_MS` 覆盖） | 抛 `LLM_TIMEOUT`，走 fallback 契约返回 200 + 原文 + `fallback:'llm-error'` |
| 服务端·客户端断开 | — | — | 响应未完成即关闭时 abort 底层调用，日志 `code:'CLIENT_CLOSED'` |

多候选的最坏情况是 3 次调用，所以客户端预算必须大于 `3 × 75s`；`fallback-contract.test.mjs`
里有一条断言专门守这个关系（单候选 ≥120s、多候选 ≥240s 且大于单候选、提示线早于死线），
防止有人再把 90s 改回来。无论哪一侧超时，草稿都保持原样。

## 重启与健康检查（运维）

> 以下结论来自 2026-10-31 的实测环境（`dsh web`，端口 3080）。

### `~/.dsh/restart-web.sh` 的真实机制

该脚本**不是**服务真正的启动者。它实际做的是：

1. `kill -TERM` 旧的 `dsh ... bin.js web --no-open --host 127.0.0.1 --port 3080` 进程（等待 60 × 0.5s 仍存活则 `kill -9`）；
2. 等端口 3080 释放；
3. 之后才用 `nohup bash ~/.dsh/start-web.sh` 尝试自行拉起（对应日志里的 `attempt N -> pid …` / `UP: …` 分支）。

实测第 3 步从未成功执行：`~/.dsh/web-restart.log` 累计 23 条 `restart requested`，`attempt` 出现 **0 次**，
`UP:` 只有 2026-10-28 的 3 条（脚本演进早期）。旧进程被 kill 后，服务是**由 systemd 单元
`deepseek-harness.service`（`Restart=always`、`RestartSec=5`）拉起的**：

- `/proc/<dsh web pid>/cgroup` → `0::/system.slice/deepseek-harness.service`；
- `systemctl show deepseek-harness.service -p Restart -p NRestarts` → `Restart=always`，且 `NRestarts` 随每次 kill 递增。

因此日志停在 `old pid: …` 并不代表重启失败，systemd 通常会在约 5 秒后接管；**不要依赖脚本回显的 URL**。

### 推荐的重启方式

```sh
# 方式一（推荐，同步等待服务拉起）
sudo systemctl restart deepseek-harness.service

# 方式二：只杀旧进程，交给 systemd 的 Restart=always
PID=$(pgrep -f 'dsh/lib/bin.js web --no-open --host 127.0.0.1 --port 3080' | head -1)
[ -n "$PID" ] && kill -TERM "$PID"
```

### 健康检查：kill 后轮询 ping 直到 200

不要 kill 完立刻验证，按下面方式轮询插件自检端点，拿到 200 再继续：

```sh
for i in $(seq 1 60); do
  code=$(curl -s -o /tmp/refiner-ping.json -w '%{http_code}' --max-time 2 \
    http://127.0.0.1:3080/dsh-prompt-refiner/ping)
  if [ "$code" = "200" ]; then
    cat /tmp/refiner-ping.json; echo; break
  fi
  sleep 1
done
```

返回的 `{"ok":true,"plugin":"dsh-prompt-refiner","version":"…","revision":"…"}` 中，`version` 就是当前加载的插件版本，
可用来确认重启后加载的是新构建。服务端日志继续用 `journalctl -u deepseek-harness -f | grep dsh-prompt-refiner` 观察。

## 上游跟进（rebase 流程）

本仓库以 `v0.5.0` 为基线叠加 fork 补丁；上游（`kee0012/dsh-prompt-optimizer`）发布新版本后按下面流程跟进。

### 基线与补丁文件

- **基线 tag**：`v0.5.0`（commit `ad60434`）——fork 从这里分叉。
- **补丁文件**：`dsh-prompt-refiner-0.5.1-fix.patch`（与仓库同级存放；本机路径 `/home/agentuser/DEEPSEEK/KAI/dsh-prompt-refiner-0.5.1-fix.patch`）——0.5.1-fix 全部改动的单文件记录，
  可用 `git apply --check` 校验、`git apply --3way` 在干净的 v0.5.0 上重放（已用 v0.5.0 归档验证可干净应用）。
- 当前分支 = `v0.5.0` + fork 提交；`git diff v0.5.0..HEAD` 应与补丁文件内容对应。

### 跟进步骤

```sh
git fetch --tags                 # 拉取上游新 tag（v0.5.x）
git rebase v0.5.x                # 把 v0.5.x 换成实际新 tag，如 v0.5.1 / v0.5.2
# 冲突逐个解决后：git add <file> && git rebase --continue
# 需要放弃时：git rebase --abort
```

若 fork 提交历史被重排过，用 `git rebase --onto v0.5.x v0.5.0` 只把基线之后的 fork 提交搬到新 tag 上。

### 预期冲突点

- `client/client.js` 的 `optimize()`：请求超时/中止、预览与写回分支——90s `AbortController`、写回确认、备份守卫都集中在这里。
- `src/index.js` 的 `catch`：错误日志、fallback 契约（200 + 原文 + `fallback:'llm-error'`）与 75s 超时降级。

上游只要动过这两处，冲突几乎必然出现；按「保留本 fork 的行为契约」解决（契约见上文「超时与失败降级」）。

### rebase 之后必须验证

```sh
npm run check           # build + 语法检查 + gates + 单测
npm run test:fallback   # fallback 行为回归（服务端 4 条 + 客户端静态断言）
```

两条都通过再提交；随后按「重启与健康检查」重启，并 `curl` ping 确认 `version` 已是新构建。

## 踩坑记录（fork 本地，rebase 时不要丢）

这些都是真机上踩出来的，每条都配了会变红的回归测试；rebase 上游时如果冲突，优先保这里的行为。

### 1. `request.on('close')` 不是"浏览器断开"信号（0.5.5 事故）

- **现象**：升级后每次优化请求 **87ms** 就返回 `fallback:"llm-error"` + 原文，UI 提示「模型未产生改动（模型调用失败）」。
- **根因**：0.5.5 为实现"客户端断开就取消"，在 handler 里写了 `request.on('close', () => abort())`。
  Node 对 `IncomingMessage` 的 `close` 语义是**请求体读完后即触发**（不是对端断开），于是服务端刚读完 body 就取消了自己的 LLM 调用。
- **正确写法**（0.5.6）：

  ```js
  const requestAbort = new AbortController();
  request.on('aborted', () => requestAbort.abort());          // 客户端真中断
  response.on('close', () => {                                 // 响应没写完就关闭 = 断开
    if (response.writableFinished !== true) requestAbort.abort();
  });
  ```

- **回归测试**：`a completed response never aborts the provider call`（断言正常完成时 `ok:true`、无 `fallback`、`signal.aborted === false`），
  以及 `a client disconnect cancels the provider call (code CLIENT_CLOSED)`。
- **教训**：加"取消"逻辑时，必须同时写"不该取消"的对照用例，否则一刀切取消会被误当成正常降级。

### 2. React 闭包快照 ≠ 实时草稿（0.5.3 事故）

- **现象**：请求发出后用户在等待期间打字，结果返回时**用户的输入被整段覆盖**，还提示"已应用"。
- **根因**：守卫写成 `getComposerDraft(input)`，而 `input` 是点击那一刻的 React 快照；在 `.then` 里比较的是旧值和旧值自己，永远相等。
- **正确做法**：`liveComposerDraft()` 读编辑器 DOM，并用 `normalizeDraft()` 归一化后比较（Lexical 的换行会被渲染成额外空行）。
- **回归测试**：`client freshness guards read the live draft, not the click-time snapshot`。

### 3. 客户端超时必须大于服务端最坏情况（0.5.4 事故）

- **现象**：12k 字草稿 + 多候选，90 秒客户端中止，但服务端仍在跑 2 次生成 + 1 次裁判，结果永远拿不回来。
- **根因**：客户端 90s < 服务端 `3 × 75s` 的最坏情况，且中止后服务端不知道客户端已经走了。
- **修复**：客户端 180s / 300s 两档预算 + 90s 仅提示；服务端监听断开并 `abort()`。
- **回归测试**：`client timeout budget is generous and mode-aware`。

### 4. `file:` 目录依赖会硬链接穿透到生产

- **现象**：profile 里 `node_modules/.../lib/client.js` 与仓库文件同 inode；改仓库即改线上，删仓库则插件加载失败。
- **修复**：`npm pack` 出 tgz 再用 `dsh plugin --profile web add file:...tgz` 安装，文件被复制而不是硬链。
- **验证**：`stat -c '%h %i'` 两侧 inode 不同、链接数为 1。

### 5. 网关/代理类错误要能区分（0.5.6）

- 非法 JSON 曾被 `errorPayload()` 统一兜底成 `LLM_ERROR`；现在 `readJsonBody` 的解析错误带 `code:'INVALID_JSON'`。
- 排查时先看 `code`：`INVALID_JSON` / `INVALID_REQUEST` / `BODY_TOO_LARGE` 是请求问题，`NO_ADAPTER` / `LLM_TIMEOUT` / `CLIENT_CLOSED` 才是链路问题。

## 已知限制

- 优化结果的质量取决于当前所选模型，不同模型的表现差异明显。
- 「还原原文」依赖 localStorage 备份，只在同一浏览器、同一会话内有效；清理站点数据或更换设备后无法还原。
- 优化是一次完整的全文重写，草稿越长耗时越久；请求体上限为 1 MiB。
- 本 fork 以 tgz（`file:` 指向打包产物）装入 profile，`dsh plugin update` 不会自动跟进上游；需要时可重新从上游安装回退。
- 多候选模式下 12k 字级别的草稿约需 85~105 秒，属正常耗时；超过 300 秒才会被客户端中止。

## 反馈与贡献

- 本增强分支问题反馈：<https://github.com/kylinmoddev/dsh-prompt-refiner/issues>
- 原版插件与上游问题：<https://github.com/kee0012/dsh-prompt-optimizer/issues>
- 欢迎提交 Issue 与 Pull Request。

### 从源码构建

```sh
npm run build        # src/ 与 client/ → lib/（仅用 Node 内置模块，无构建工具链依赖）
npm run gates        # 产物一致性门禁（含 fallback 契约静态断言）
npm run test:fallback # fallback/取消/超时预算回归（11 条：服务端行为 8 条 + 客户端静态守卫 3 条）
npm run check        # build + 语法检查 + gates + 单测，一条命令跑全链路
```

`src/` 与 `client/` 是唯一的手写来源，`lib/` 由构建脚本生成，请不要手改 `lib/`。

## 许可证

MIT
