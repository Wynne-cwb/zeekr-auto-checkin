<div align="center">

# 极氪.skill

> *「把每天打开极氪 App 签到的三分钟，还给你自己」*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Openclaw Skill](https://img.shields.io/badge/Openclaw-Skill-blueviolet)](https://openclaw.ai)
[![Hermes Agent Skill](https://img.shields.io/badge/Hermes%20Agent-Skill-orange)](https://hermes-agent.ai)
[![skills.sh Compatible](https://img.shields.io/badge/skills.sh-Compatible-green)](https://skills.sh)
[![GitHub Stars](https://img.shields.io/github/stars/simmzl/zeekr-auto-checkin?style=social)](https://github.com/simmzl/zeekr-auto-checkin)

<br>

**让 openclaw 接管极氪汽车 App 的每日签到。**

<br>

签到 · 领碎片 · 领步行碳积分 · 领极值能量球，<br>
全流程自动化，成功或失败都发回你当前这个对话，不用改发送目标。<br>
你只需要交出一次 token，剩下的交给 openclaw。

[效果示例](#效果示例) · [安装](#安装) · [故障排查](#故障排查)

</div>

---

## 效果示例

每天早上 8:30，launchd 自动触发这个脚本。你手机上收到通知的时候，本日碎片、步行、极值已经全部躺进账号：

```
$ ZEEKR_TOKEN="Bearer eyJ..." ZEEKR_DEVICE_ID="12345..." \
    node scripts/checkin.mjs

✅ 签到成功                 +10 成长值
⏳ 等待 4.2s 后查询可领取奖励 ...

📦 发现可领取
   碎片 ×3 · 步行 ×1 · 极值 ×2

✅ 领取碎片 1/3             +50 能量
✅ 领取碎片 2/3             +50 能量
✅ 领取碎片 3/3             +50 能量
✅ 领取步行奖励             +120 碳积分
✅ 领取极值 1/2             +1 能量球
✅ 领取极值 2/2             +1 能量球

🎉 全部完成 · 耗时 23s
📨 通知已发回你配置时所在的对话
```


## 安装

```bash
npx skills add simmzl/zeekr-auto-checkin
```

然后在 openclaw 里说：

```
> 帮我配置每天8点极氪自动签到
> 极氪签到改到晚上 10 点
> 极氪 token 换了，新的是 Bearer eyJ...
> 今天的极氪签到有没有成功
```

openclaw 会自动走完：索要 token → 手动验证 → 写 launchd → 近时点联调 → 给你最终交付口径：


```
用户     ❯ 安装 npx skills add simmzl/zeekr-auto-checkin

openclaw ❯ 好。我需要两个东西 ——
           1. 极氪 App 请求头里的 Authorization（Bearer eyJ... 整串）
           2. 同一条请求的 device_id（纯数字）
           在 App 里用 Stream / Charles 抓一条请求，两个字段复制过来。

用户     ❯ Bearer eyJhbGc...  /  1234567890...

openclaw ❯ 解析 JWT：token 于 2026-06-15 过期，剩余 55 天，充足。
           先手动跑一次验证 ...
           ✅ 签到成功，领了 3 碎片 + 1 步行 + 0 极值。

           当前环境识别：
             platform = macOS                     → 用 launchd
             channel  = <你当前所在会话>           → 通知回发目标
             target   = <当前对话的 chat_id>

           现在写 launchd plist：
             ~/Library/LaunchAgents/ai.openclaw.zeekr-checkin.plist
             每日 08:30 触发 · 日志写到 ~/zeekr-checkin.log
             NOTIFY_CHANNEL / NOTIFY_TARGET 写进 EnvironmentVariables
             每次执行通过 OpenClaw CLI 把结果回发到当前对话

           已加载并启用。下一次执行时间：明天 08:30。
```

这不是一个静态脚本在跑。**openclaw 负责理解你的需求、生成 launchd 配置、规避之前踩过的坑、验证整条链路通不通、token 快过期时提醒你换**。脚本只是执行层。

---

## 这个 Skill 做什么

| 能力 | 说明 |
|------|------|
| **每日签到** | 调用签到接口，+10 成长值 |
| **领碎片** | 枚举 `valDefineCode=DEBRIS`，每个单独请求 |
| **领步行碳积分** | 枚举 `valDefineCode=CARBON_VALUE` |
| **领极值能量球** | 枚举 `valDefineCode=ZEEKR_VALUE`，走 `collectIntegralZeekrBalls` 接口 |
| **定时触发** | macOS 上优先 launchd，Linux 上优先 systemd timer、cron 兜底（见下文） |
| **自动通知** | 把 agent 配置时所在的 openclaw 会话（比如 telegram、lark、wechat 或其它 —— 你当前在哪就用哪）写进定时任务的环境变量，之后每次执行把摘要回发到那个对话；失败至少重试一次 |
| **Token 过期提醒** | 解析 JWT `exp`，剩余 <7 天时提醒换 token |
| **单次执行** | 一轮走完三类奖励就结束，不做重试循环 |

---

## 签到脚本本身

`scripts/checkin.mjs` 是一个零依赖 Node.js 脚本，Node >= 18 即可跑：

```bash
ZEEKR_TOKEN="Bearer eyJ..." \
ZEEKR_DEVICE_ID="1234567890" \
node scripts/checkin.mjs
```

或者命令行参数：

```bash
node scripts/checkin.mjs --token "Bearer eyJ..." --device-id "1234567890"
```

**节奏设计**：

- 签到后随机 **4–5s** 再查可领取列表（模拟真实用户）
- 三类奖励按顺序领：`碎片 → 步行 → 极值`
- 同类型内相邻两次领取之间随机 **1–2s**
- 不同类型之间随机 **2–3s**
- `getUncollected` 只调用一次，不做重试循环

**分类规则**：用接口返回的 `valDefineCode` 区分类型（不用 `sceneCode`）：

| code | 类型 | 领取接口 |
|------|------|---------|
| `DEBRIS` | 碎片 | `claimDebris` |
| `CARBON_VALUE` | 步行碳积分 | `claimWalk` |
| `ZEEKR_VALUE` | 极值能量球 | `collectIntegralZeekrBalls`，body: `{"energyIds":[id]}` |

**签名算法**：`SHA1([secret, nonce, timestamp].sort().join(""))`，走 H5 通道。

---

## 定时方案的几条约束

在这个 skill 早期版本上踩过的坑，沉淀成了几条跨平台都适用的原则：

- **调度器按平台选** —— macOS 上优先 launchd（cron 分钟级触发实测不稳定）；Linux 上优先 systemd timer（日志完整），cron 作兜底；不要跨平台硬套同一个方案
- **`openclaw` 启动器依赖 `#!/usr/bin/env node`** —— launchd / cron / systemd 环境 PATH 都可能不完整，直接调启动器会 `env: node: No such file or directory`，必须写绝对路径：`/绝对路径/node /绝对路径/openclaw.mjs`
- **定时任务里一律用绝对路径** —— node、脚本、日志路径都写死，不依赖 PATH
- **通知失败必须记日志 + 至少重试一次** —— 不然会出现"签到成功但用户没收到消息、也不知道为什么"的黑盒
- **改完时间必须近时点验证** —— 把时间改到 2 分钟后，亲眼看整条链路走一遍，别"改完就收工"

这些约束写在 `SKILL.md` 里，openclaw 每次执行都会遵守。

---

## 仓库结构

```
zeekr-auto-checkin/
├── SKILL.md            # 给 openclaw 读的完整 runbook（7 步工作流 + 原则 + 排查清单）
├── agents/
│   └── openai.yaml     # Agent 定义
├── scripts/
│   └── checkin.mjs     # 签到 + 领取脚本（零依赖，Node >= 18）
└── package.json
```

`SKILL.md` 是这个 skill 的"灵魂"—— 它不是给人读的文档，是给 openclaw 读的作业手册。你不需要读它，但如果想改它的行为（比如换通知渠道、调节奏），就改它。

---

## 故障排查

### token 失效了？

极氪的 token 默认 1 年有效。重新登录极氪 App 会刷新 token —— 重新抓一条请求，把新的 `Authorization` 丢给 openclaw，让它帮你更新定时任务里的环境变量就行。

### 签到没成功？

跟你当前在用的 openclaw 说「帮我看下今天极氪签到为什么没成功」—— 它会读日志、定位问题、给你修好。这就是这东西是个 skill、不是一个裸脚本的理由。

### 还能干啥？

[欢迎提 PR](https://github.com/simmzl/zeekr-auto-checkin/pulls) —— 加接口、换通知渠道、适配别的 OS、优化节奏，任何你觉得能让它更好的都欢迎。

---

## 免责声明

- 本项目仅供 **学习和个人使用**，**不得用于任何商业用途**
- 通过模拟客户端请求与极氪 API 交互，使用本项目可能违反极氪汽车 App 的服务条款，**风险自负**
- 本项目不会存储、上传或转发你的 Token 和 device_id，这些凭据只存在于你本地的 launchd plist 和脚本环境变量里
- 不对因使用本项目导致的任何账号异常负责
- 如果极氪官方调整接口或反作弊策略，本项目不保证持续可用

---

## 如果这个 skill 帮到你

配一次，之后每天省 3 分钟打开极氪 App 签到的时间。一年就是 18 小时。

觉得值的话，[到 GitHub 点个 ⭐](https://github.com/simmzl/zeekr-auto-checkin) 就是对维护者唯一的回报 —— 也顺便让更多极氪车主看到。

也欢迎提 issue / PR 告诉我你踩到的坑。

---

## License

[MIT](LICENSE) — 随便用，随便改。
