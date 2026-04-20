---
name: zeekr-auto-checkin
description: 极氪汽车 App 每日自动签到并领取碎片和步行奖励。适用于配置、修改、排查“极氪签到 / zeekr 签到 / 极氪自动签到 / 设置极氪签到 / 每天签到极氪 / 更新极氪 token / 极氪签到通知”等场景。优先在 macOS 上使用 launchd（不是 cron）做定时，并可选配置执行后自动发 Telegram 通知成功/失败结果。
---

# 极氪自动签到

零依赖 Node.js 脚本，自动完成极氪汽车 App 每日签到 + 领取碎片奖励 + 领取步行碳积分。

## 必需环境变量（与 Token 一致，由用户提供）

| 变量 | 含义 |
|------|------|
| `ZEEKR_TOKEN` | 请求头 `Authorization` 完整值，形如 `Bearer eyJ...` |
| `ZEEKR_DEVICE_ID` | 请求头 `device_id`（与抓包中极氪 App 请求一致，纯数字字符串） |

命令行等价方式（二选一即可）：

```bash
node <skill_path>/scripts/checkin.mjs --token "Bearer eyJ..." --device-id "你的device_id"
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

- **macOS 优先用 launchd，不要默认用 cron**。
  - 这次实测里，cron 服务虽然在跑，但分钟触发不稳定；launchd 稳定触发。
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

### Step 1: 获取用户 Token 与 device_id

向用户索要：

1. **Bearer Token**：与原先相同。
   > 在极氪 App（iOS/Android）中使用抓包工具（如 Stream、Charles）捕获任意请求，  
   > 从请求头中复制 `Authorization` 的完整值（以 `Bearer eyJ...` 开头）。

2. **device_id**：同一类请求的请求头里的 `device_id`（长数字串），须与 App 实际请求一致。

验证 token 格式：必须以 `Bearer ` 开头，后接 JWT（三段 base64 用 `.` 连接）。

解析 JWT payload 中的 `exp` 字段，告知用户 token 过期时间和剩余天数。若剩余不足 7 天，提醒用户更新 token。

### Step 2: 先手动验一次脚本

先运行一次脚本确认 token 与 device_id 有效：

```bash
ZEEKR_TOKEN="<用户提供的token>" ZEEKR_DEVICE_ID="<用户的device_id>" /绝对路径/node <skill_path>/scripts/checkin.mjs
```

确认输出包含 `✅` 和 `🎉 全部完成` 后再继续。若失败，先解决 token、device_id 或接口问题，不要急着配定时。

### Step 3: macOS 上配置 launchd（默认方案）

创建 `~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist`，使用：

- `ProgramArguments` 指向 `/bin/bash` 和 `scripts/checkin_notify.sh`（若你本地有该包装脚本）
- `EnvironmentVariables` 中同时设置 **`ZEEKR_TOKEN`** 与 **`ZEEKR_DEVICE_ID`**
- `StartCalendarInterval` 设置小时和分钟
- `StandardOutPath` / `StandardErrorPath` 都写到 `~/zeekr-checkin.log`
- `WorkingDirectory` 指向工作目录

加载方式：

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist
launchctl enable gui/$(id -u)/ai.openclaw.zeekr-checkin
```

检查是否生效：

```bash
launchctl print gui/$(id -u)/ai.openclaw.zeekr-checkin
```

关注这些字段：

- `event triggers` 里的 `Hour` / `Minute`
- `environment` 里是否有 `ZEEKR_TOKEN` 与 `ZEEKR_DEVICE_ID`
- `last exit code`
- `runs`

### Step 4: 如已有 cron，迁移时删掉旧 cron

避免 cron 和 launchd 同时跑，造成重复签到或混淆排查结果。

检查：

```bash
crontab -l
```

如果有旧的 `checkin.mjs` 任务，迁移到 launchd 后移除。

### Step 5: 如需自动通知，使用包装脚本

使用 `scripts/checkin_notify.sh` 作为 launchd 的入口，而不是直接跑 `checkin.mjs`（若项目内提供该脚本）。

这个脚本负责：

1. 执行签到
2. 从最新日志里提取摘要
3. 通过 OpenClaw CLI 主动给用户发消息
4. 把发送成功/失败写回日志
5. 失败时自动重试一次

默认支持这些环境变量：

- `ZEEKR_TOKEN`
- `ZEEKR_DEVICE_ID`
- `NOTIFY_CHANNEL`（默认 `telegram`）
- `NOTIFY_TARGET`（默认当前老板 chat id）
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

### Step 7: 修改 token、device_id 或时间

- **改时间**：直接改 plist 里的 `StartCalendarInterval`，然后 `bootout + bootstrap`
- **改 token / device_id**：改 plist 里 `EnvironmentVariables` 中对应项，然后重新加载

改完都要至少验证一次。

## 故障排查清单

### 现象：日志没更新

按顺序查：

1. `launchctl print gui/$(id -u)/ai.openclaw.zeekr-checkin`
2. 看 `runs` 是否增加
3. 看 `last exit code`
4. 看 `event triggers` 时间是否正确
5. 看日志文件修改时间：

```bash
stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' ~/zeekr-checkin.log
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
- 是否配置了成功/失败通知
- token 过期时间
- 已配置 **device_id** 与 token 一并维护
- 如果中间踩坑，明确说“前面哪里失败，后面已经成功修正”

## 技术细节

- **签名算法**：`SHA1([secret, nonce, timestamp].sort().join(""))`，走 H5 通道，零外部依赖，仅需 Node.js >= 18。
- **延迟**：签到后 4–5s；碎片 → 步行 → 极值 三段之间各 2–3s；同类型内连续两次领取接口之间 1–2s。
- **单次执行**：`getUncollected` 仅调用一次，按三类顺序领完即结束，不做重试循环。
