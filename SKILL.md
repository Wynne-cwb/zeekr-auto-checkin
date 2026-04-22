---
name: zeekr-auto-checkin
description: 极氪汽车 App 每日自动签到并领取碎片和步行奖励。适用于配置、修改、排查“极氪签到 / zeekr 签到 / 极氪自动签到 / 设置极氪签到 / 每天签到极氪 / 更新极氪 token / 极氪签到通知”等场景。优先在 macOS 上使用 launchd（不是 cron）做定时，并可选配置执行后自动发 Telegram 通知成功/失败结果。
---

# 极氪自动签到

零依赖 Node.js 脚本，自动完成极氪汽车 App 每日签到 + 领取碎片奖励 + 领取步行碳积分。

## 必需环境变量（由用户提供）

| 变量 | 含义 |
|------|------|
| `ZEEKR_TOKEN` | 请求头 `Authorization` 完整值，形如 `Bearer eyJ...` |

命令行等价方式（二选一即可）：

```bash
node <skill_path>/scripts/checkin.mjs --token "Bearer eyJ..."
```

## 脚本行为摘要

1. **签到** → 随机等待 **4–5s** → 进入领取循环。
2. **领取**：单次执行（无重试循环）。
   - 调用 `getUncollected` 查询可领列表；
   - 若碎片、步行、极值均为 **0 条**，打「暂无可领取奖励」后结束；
   - 否则：`claimDebris`（每个碎片 **单独请求**）→ 随机 **2–3s** → `claimWalk`（每个步行奖励 **单独请求**）→ 随机 **2–3s** → `claimIntegral`（每个极值 **单独请求**）；
   - 同类型内，相邻两次领取接口之间随机 **1–2s**。
3. **分类规则**：接口返回的 `uncollectedVal` 中，用 **`valDefineCode`** 区分类型（不用 `sceneCode`）：
   - 碎片：`DEBRIS`
   - 步行碳积分：`CARBON_VALUE`
   - 极值：`ZEEKR_VALUE`（走 `collectIntegralZeekrBalls` 领取，body 形如 `{"energyIds":[id]}`）

## 核心原则

- **定时机制按平台选**：macOS 上优先 launchd；Linux 上优先 systemd timer，cron 作兜底；WSL 按 Linux 处理。
  - macOS 上 cron 实测分钟级触发不稳定，launchd 稳定。Linux 上 systemd 日志最完整，cron 配置最简单。
  - 不要跨平台硬套同一个方案 —— 先识别当前 OS 再选。
- **定时任务里一律使用绝对路径**。
  - 包括 `node`、脚本路径、日志路径。
- **如果要自动通知，不要直接调用 `openclaw` 启动器**。
  - `openclaw` 是 `#!/usr/bin/env node`，在 launchd 环境里可能因为 PATH 不完整而失败。
  - 应直接使用：`<node绝对路径> <openclaw.mjs绝对路径> message send ...`
- **通知失败必须记日志，并至少重试一次**。
  - 否则会出现“签到成功但用户没收到消息，也不知道失败原因”的黑盒问题。
- **修改后一定做一次近时点验证**。
  - 最好把时间改成 2 分钟后，验证“定时触发 + 签到执行 + 通知送达”整条链路。

## 工作流程

### Step 1: 获取用户 Token

只向用户索要一个东西 —— **Bearer Token**：

> 在极氪 App（iOS / Android）里用抓包工具（Reqable / Stream / Charles / Proxyman / HttpCanary 等）抓请求，**按域名 `api-gw-toc.zeekrlife.com` 过滤**，从任意一条请求的请求头里复制 `Authorization` 的完整值（以 `Bearer eyJ...` 开头）。


如果用户不会抓包，按平台推荐工具：
- **全平台首选** [Reqable](https://reqable.com/zh-CN/)：Win / macOS / Linux / iOS / Android 都能装，中文界面，学习成本低
- iOS 备选 Stream（免费、免越狱）
- PC（Windows / macOS / Linux）备选 Charles / Proxyman
- Android 备选 HttpCanary / Packet Capture

流程：装好工具和 HTTPS 证书 → 打开极氪 App 随便点一下 → 过滤域名 `api-gw-toc.zeekrlife.com` → 从任意一条请求的请求头里复制 `Authorization`。

验证 token 格式：必须以 `Bearer ` 开头，后接 JWT（三段 base64 用 `.` 连接）。

解析 JWT payload 中的 `exp` 字段，告知用户 token 过期时间和剩余天数。若剩余不足 7 天，提醒用户更新 token。

### Step 2: 先手动验一次脚本

先运行一次脚本确认 token 有效：

```bash
ZEEKR_TOKEN="<用户提供的token>" /绝对路径/node <skill_path>/scripts/checkin.mjs
```

确认输出包含 `✅` 和 `🎉 全部完成` 后再继续。若失败，先解决 token 或接口问题，不要急着配定时。

### Step 3: 配置定时触发

先识别当前 OS，再选方案。**不要跨平台硬套。**

#### macOS —— 用 launchd（优先方案）

创建 `~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist`，使用：

- `ProgramArguments` 指向 `/bin/bash` 和 `scripts/checkin_notify.sh`（若你本地有该包装脚本）
- `EnvironmentVariables` 同时设置 **`ZEEKR_TOKEN`** / **`NOTIFY_CHANNEL`** / **`NOTIFY_TARGET`**
- `StartCalendarInterval` 设置小时和分钟
- `StandardOutPath` / `StandardErrorPath` 都写到 `~/zeekr-checkin.log`
- `WorkingDirectory` 指向工作目录

加载：

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist
launchctl enable gui/$(id -u)/ai.openclaw.zeekr-checkin
```

检查：

```bash
launchctl print gui/$(id -u)/ai.openclaw.zeekr-checkin
```

关注 `event triggers` 的 `Hour` / `Minute`、`environment` 里是否有 `ZEEKR_TOKEN` / `NOTIFY_CHANNEL` / `NOTIFY_TARGET`、`last exit code`、`runs`。

#### Linux —— 用 systemd timer（优先）或 cron（兜底）

**systemd timer**：分别写 `~/.config/systemd/user/zeekr-checkin.service`（执行）和 `~/.config/systemd/user/zeekr-checkin.timer`（触发）。环境变量写进 service `[Service]` 段的 `Environment=` 或 `EnvironmentFile=`，路径全部绝对。加载：

```bash
systemctl --user daemon-reload
systemctl --user enable --now zeekr-checkin.timer
systemctl --user list-timers zeekr-checkin.timer
journalctl --user -u zeekr-checkin.service -n 50
```

**cron**（简单场景兜底）：`crontab -e` 加一行 `30 8 * * * /绝对路径/bash /绝对路径/scripts/checkin_notify.sh`。cron 不继承 shell 环境，所有路径写死，环境变量在 crontab 顶部 `KEY=VAL` 声明。

### Step 4: 迁移时避免多个调度器并存

避免多个调度器（launchd + cron / systemd + cron / ...）同时跑同一个签到任务，造成重复签到或排查时找错现场。

检查：

```bash
crontab -l                                          # cron 任务
launchctl list | grep zeekr                         # macOS launchd
systemctl --user list-timers | grep zeekr           # Linux systemd timer
```

迁移完成后，把旧的任务删掉或禁用。

### Step 5: 如需自动通知，使用包装脚本

使用 `scripts/checkin_notify.sh` 作为 launchd 的入口，而不是直接跑 `checkin.mjs`（若项目内提供该脚本）。

**通知 channel 绝不要写死**。agent 在配置这个 skill 时已经跑在某个 openclaw 会话里 —— 这个会话所在的 channel（`lark` / `telegram` / `wechat` / ...）和 target（当前 chat_id / user_id）就是要写进 plist 的 `NOTIFY_CHANNEL` / `NOTIFY_TARGET`。用户之后每天的签到结果会自动发回他当初配置这件事时所在的那个对话，不需要再问第二遍。

Agent 如果不能从当前会话上下文直接读出，按顺序尝试：

1. 环境变量 `OPENCLAW_CHANNEL` / `OPENCLAW_CHAT_ID`
2. `openclaw session current` / `openclaw whoami` 之类的 CLI 命令
3. 兜底：明确问用户「通知发到这个对话吗？」，让用户确认后再记

这个脚本负责：

1. 执行签到
2. 从最新日志里提取摘要
3. 通过 OpenClaw CLI 发回配置时记录的 channel + target
4. 把发送成功/失败写回日志
5. 失败时自动重试一次

默认支持这些环境变量：

- `ZEEKR_TOKEN`
- `NOTIFY_CHANNEL`（配置时所在的 openclaw 会话 channel，例如 `lark` / `telegram`；**不要硬编码**）
- `NOTIFY_TARGET`（配置时所在的 openclaw 会话 chat_id / user_id；**不要硬编码**）
- `NODE_BIN`
- `OPENCLAW_MJS`
- `CHECKIN_SCRIPT`
- `LOG_FILE`

### Step 6: 改时间后立即做近时点验证

不要改完就结束。把时间临时调到 2 分钟后验证一遍：

1. 是否准时触发
2. 日志是否更新
3. `last exit code` 是否为 0
4. 用户是否真的收到通知

如果用户没收到通知，优先检查：

- 日志里有没有 `[极氪通知]` 相关记录
- 是否出现 `env: node: No such file or directory`
- 是否仍在调用 `openclaw` 启动器而非 `node openclaw.mjs`

### Step 7: 修改 token 或时间

- **改时间**：直接改 plist 里的 `StartCalendarInterval`，然后 `bootout + bootstrap`
- **改 token**：改 plist 里 `EnvironmentVariables` 中的 `ZEEKR_TOKEN`，然后重新加载

改完都要至少验证一次。

## 故障排查清单

### 现象：日志没更新

按调度器分别查：

**macOS / launchd**：

```bash
launchctl print gui/$(id -u)/ai.openclaw.zeekr-checkin
# 关注 runs / last exit code / event triggers
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' ~/zeekr-checkin.log
```

**Linux / systemd**：

```bash
systemctl --user list-timers zeekr-checkin.timer    # 下次触发、上次执行
journalctl --user -u zeekr-checkin.service -n 100   # 日志
systemctl --user status zeekr-checkin.service       # 最近一次退出码
```

**Linux / cron**：

```bash
grep CRON /var/log/syslog | grep zeekr              # Ubuntu/Debian
tail -f /var/log/cron                                # CentOS/Fedora
```

### 现象：签到成功，但没收到通知

先看日志里是否有：

- `[极氪通知] ✅ ... 发送成功`
- `[极氪通知] ⚠️ 第一次 ... 发送失败`
- `[极氪通知] ❌ ... 重试后仍失败`

如果报：

```text
env: node: No such file or directory
```

说明消息发送链路还在依赖 `#!/usr/bin/env node`，必须改成绝对路径调用：

```bash
/绝对路径/node /绝对路径/openclaw.mjs message send ...
```

### 现象：第一次失败，后面成功

必须主动同步给用户：

- 第一次哪里失败
- 后面已经成功修复
- 当前最终状态是什么

不要只留系统报错让用户自己猜。

## 推荐交付口径

完成后给用户同步：

- 当前执行时间（自然语言）
- 使用的是 **launchd** 还是 cron
- 日志路径：`~/zeekr-checkin.log`
- 通知配置：channel 和 target（例如 `lark / chat_id=xxxxx`），说明结果会发回当前这个对话
- token 过期时间
- 如果中间踩坑，明确说”前面哪里失败，后面已经成功修正”

## 技术细节

- **签名算法**：`SHA1([secret, nonce, timestamp].sort().join(""))`，走 H5 通道，零外部依赖，仅需 Node.js >= 18。
- **延迟**：签到后 4–5s；碎片 → 步行 → 极值 三段之间各 2–3s；同类型内连续两次领取接口之间 1–2s。
- **单次执行**：`getUncollected` 仅调用一次，按三类顺序领完即结束，不做重试循环。
