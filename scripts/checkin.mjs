#!/usr/bin/env node
/**
 * 极氪汽车每日自动签到 + 领碎片 + 领步行奖励
 * 零依赖，仅需 Node.js >= 18
 *
 * 用法:
 *   ZEEKR_TOKEN="Bearer eyJ..." ZEEKR_DEVICE_ID="你的设备ID" node checkin.mjs
 *   node checkin.mjs --token "Bearer eyJ..." --device-id "你的设备ID"
 */

import { createHash } from "crypto";

export const SECRET =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCz09z6e9WOcNq+nUMX8Vq1Xe2EmJxuR3XbturefioF)E(Fl";
export const BASE_URL = "https://api-gw-toc.zeekrlife.com";
export const API = {
  signIn: "/zeekrlife-mp-val/toc/v1/zgreen/center",
  uncollected: "/zeekrlife-mp-val/v1/carEnergy/getUncollectedBallsPageNew",
  claimDebris: "/zeekrlife-mp-mkt/toc/v1/apply/batchApply",
  claimWalk: "/zeekrlife-mp-val/v1/carEnergy/collectedAllEnergy",
  claimIntegral: "/zeekrlife-mp-val/v1/carEnergy/collectIntegralZeekrBalls",
};

/** getUncollected 列表项：碎片 / 步行碳积分 / 极值 以 valDefineCode 区分（见接口返回） */
export const VAL_DEFINE_DEBRIS = "DEBRIS";
export const VAL_DEFINE_WALK = "CARBON_VALUE";
export const VAL_DEFINE_INTEGRAL = "ZEEKR_VALUE";

// ==================== 工具函数 ====================

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const log = (msg) => console.log(`[极氪签到] ${msg}`);

export function randomString(len = 15) {
  const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz1234567890";
  return Array.from({ length: len }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

export function makeSign(nonce, timestamp) {
  return createHash("sha1")
    .update([SECRET, nonce, String(timestamp)].sort().join(""))
    .digest("hex");
}

export function parseToken(token) {
  const payload = JSON.parse(
    Buffer.from(token.replace("Bearer ", "").split(".")[1], "base64").toString()
  );
  const sub = JSON.parse(payload.sub);
  const accountId = String(sub.accountInfoDTO.accountId);
  const expDate = new Date(payload.exp * 1000);
  const daysLeft = Math.floor((expDate - Date.now()) / 86400000);
  return { accountId, expDate, daysLeft };
}

export async function getLatestVersion() {
  try {
    const res = await fetch("https://itunes.apple.com/cn/lookup?id=1570277888");
    return (await res.json())?.results?.[0]?.version || "4.9.33";
  } catch {
    return "4.9.33";
  }
}

export function generateDeviceId(token) {
  return createHash("md5").update(token).digest("hex").replace(/[a-f]/g, "").slice(0, 20);
}

export function buildHeaders(token, appVersion, deviceId) {
  const timestamp = Date.now();
  const nonce = randomString(15);
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    Authorization: token,
    x_ca_key: "H5-SIGN-SECRET-KEY",
    x_ca_nonce: nonce,
    x_ca_timestamp: String(timestamp),
    x_ca_sign: makeSign(nonce, timestamp),
    WorkspaceId: "prod",
    Version: "2",
    app_type: "h5",
    app_code: "toc_h5_green_zeekrapp",
    platform: "",
    platform_h5: "IOS",
    risk_platform: "h5",
    riskTimeStamp: String(timestamp),
    riskVersion: "1",
    device_id: deviceId,
    x_gray_code: "gray45",
    AppId: "ONEX97FB91F061405",
    "X-CORS-ONEX97FB91F061405-prod": "1",
    "Eagleeye-Sessionid": "",
    "Eagleeye-Traceid": "",
    Origin: "https://activity-h5.zeekrlife.com",
    Referer: "https://activity-h5.zeekrlife.com/",
    "User-Agent": `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) zeekr_iOS_v${appVersion}`,
  };
}

export async function post(path, token, appVersion, deviceId, body) {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: buildHeaders(token, appVersion, deviceId),
    body: JSON.stringify(body),
  });
  return res.json();
}

// ==================== 业务逻辑 ====================

export async function signIn(token, appVersion, deviceId) {
  const data = await post(API.signIn, token, appVersion, deviceId, {});
  if (data.code === "000000") {
    const msg = data?.data?.first
      ? "签到成功（首次）"
      : data?.data?.signInZgreenInfo?.[1]?.taskName || "签到成功";
    log(`✅ ${msg}`);
    return true;
  }
  log(`❌ 签到失败: ${data.msg || JSON.stringify(data)}`);
  return false;
}

export async function getUncollected(token, appVersion, deviceId, accountId) {
  const data = await post(API.uncollected, token, appVersion, deviceId, { accountId });
  if (data.code !== "000000") {
    log(`❌ 查询可领取奖品失败: ${data.msg || JSON.stringify(data)}`);
    return { debrisList: [], walkList: [] };
  }
  const items = data?.data?.uncollectedVal || [];
  const debrisList = items.filter((i) => i.valDefineCode === VAL_DEFINE_DEBRIS);
  const walkList = items.filter((i) => i.valDefineCode === VAL_DEFINE_WALK);
  const integralList = items.filter((i) => i.valDefineCode === VAL_DEFINE_INTEGRAL);
  log(
    `📦 可领取: ${debrisList.length} 个碎片, ${walkList.length} 个步行奖励, ${integralList.length} 个极值`
  );
  return { debrisList, walkList, integralList };
}

export async function claimDebris(token, appVersion, deviceId, debrisList) {
  if (!debrisList.length) {
    log("🔹 无碎片可领取");
    return null;
  }
  const allResults = [];
  for (let i = 0; i < debrisList.length; i++) {
    if (i > 0) {
      const ms = rand(1000, 2000);
      log(`⏳ 领取间隔 ${ms}ms...`);
      await sleep(ms);
    }
    const item = debrisList[i];
    const applyCmdList = [
      {
        record: item.eventCode,
        payContent: { bubbleAssetsId: item.id },
        applyExt: { origin: item.sourceId },
      },
    ];
    const data = await post(API.claimDebris, token, appVersion, deviceId, { applyCmdList });
    if (data.code === "000000" && Array.isArray(data.data)) {
      const results = data.data
        .filter((r) => r.success)
        .map((r) => {
          const name = r.invoice?.materialSnapshot?.name || "未知";
          const fragment =
            r.invoice?.materialSnapshot?.medalTemplateSnapshot?.name || "碎片";
          return `${name}(${fragment})`;
        });
      if (results.length) {
        log(`🧩 碎片奖励 [${i + 1}/${debrisList.length}]: ${results.join(", ")}`);
        allResults.push(...results);
      }
    } else {
      log(`❌ 领取碎片失败 [${i + 1}/${debrisList.length}]: ${data.msg || JSON.stringify(data)}`);
    }
  }
  return allResults.length ? allResults : null;
}

export async function claimWalk(token, appVersion, deviceId, walkList) {
  if (!walkList.length) {
    log("🔹 无步行奖励可领取");
    return null;
  }
  let totalVal = 0;
  for (let i = 0; i < walkList.length; i++) {
    if (i > 0) {
      const ms = rand(1000, 2000);
      log(`⏳ 领取间隔 ${ms}ms...`);
      await sleep(ms);
    }
    const item = walkList[i];
    const val = item.val || 0;
    const data = await post(API.claimWalk, token, appVersion, deviceId, {
      energyIds: [item.id],
    });
    if (data.code === "000000") {
      totalVal += val;
      log(`🚶 步行奖励 [${i + 1}/${walkList.length}]: +${val} 碳积分`);
    } else {
      log(`❌ 领取步行奖励失败 [${i + 1}/${walkList.length}]: ${data.msg || JSON.stringify(data)}`);
    }
  }
  return totalVal;
}

export async function claimIntegral(token, appVersion, deviceId, integralList) {
  if (!integralList.length) {
    log("🔹 无极值奖励可领取");
    return null;
  }
  let totalVal = 0;
  for (let i = 0; i < integralList.length; i++) {
    if (i > 0) {
      const ms = rand(1000, 2000);
      log(`⏳ 领取间隔 ${ms}ms...`);
      await sleep(ms);
    }
    const item = integralList[i];
    const val = item.val || 0;
    const data = await post(API.claimIntegral, token, appVersion, deviceId, {
      energyIds: [item.id],
    });
    if (data.code === "000000") {
      totalVal += val;
      log(`🏆 极值 [${i + 1}/${integralList.length}]: +${val}`);
    } else {
      log(
        `❌ 领取极值失败 [${i + 1}/${integralList.length}]: ${data.msg || JSON.stringify(data)}`
      );
    }
  }
  return totalVal;
}

// ==================== CLI ====================

function parseCliArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token" || a === "-t") out.token = argv[++i];
    else if (a === "--device-id" || a === "-d") out.deviceId = argv[++i];
  }
  return out;
}

// ==================== 主流程 ====================

export async function main() {
  const cli = parseCliArgs(process.argv);
  const token = cli.token || process.env.ZEEKR_TOKEN;
  const deviceId = cli.deviceId || process.env.ZEEKR_DEVICE_ID;

  if (!token) {
    console.error("[极氪签到] ❌ 缺少 Token");
    console.error(
      '用法: ZEEKR_TOKEN="Bearer eyJ..." ZEEKR_DEVICE_ID="设备ID" node checkin.mjs'
    );
    console.error('  或: node checkin.mjs --token "Bearer eyJ..." --device-id "设备ID"');
    process.exit(1);
  }
  if (!deviceId) {
    console.error("[极氪签到] ❌ 缺少设备 ID");
    console.error(
      '用法: ZEEKR_TOKEN="Bearer eyJ..." ZEEKR_DEVICE_ID="设备ID" node checkin.mjs'
    );
    console.error('  或: node checkin.mjs --token "Bearer eyJ..." --device-id "设备ID"');
    process.exit(1);
  }

  const { accountId, expDate, daysLeft } = parseToken(token);
  log(`${new Date().toLocaleString("zh-CN")} | 账号: ${accountId}`);
  log(`Token 过期: ${expDate.toLocaleDateString("zh-CN")} (剩余 ${daysLeft} 天)`);

  if (daysLeft <= 0) {
    log("❌ Token 已过期，请提供新的 Token！");
    process.exit(2);
  }
  if (daysLeft < 7) {
    log("⚠️ Token 即将过期，请尽快更新！");
  }

  const appVersion = await getLatestVersion();
  log(`App 版本: v${appVersion} | 设备: ${deviceId}`);

  const signOk = await signIn(token, appVersion, deviceId);
  if (!signOk) return;

  const delay1 = rand(4000, 5000);
  log(`⏳ 等待 ${delay1}ms...`);
  await sleep(delay1);

  const { debrisList, walkList, integralList } = await getUncollected(
    token,
    appVersion,
    deviceId,
    accountId
  );

  if (!debrisList.length && !walkList.length && !integralList.length) {
    log("🔹 暂无可领取奖励");
    log("🎉 全部完成！");
    return;
  }

  await claimDebris(token, appVersion, deviceId, debrisList);

  const delay2 = rand(2000, 3000);
  log(`⏳ 等待 ${delay2}ms...`);
  await sleep(delay2);

  await claimWalk(token, appVersion, deviceId, walkList);

  const delay3 = rand(2000, 3000);
  log(`⏳ 等待 ${delay3}ms...`);
  await sleep(delay3);

  await claimIntegral(token, appVersion, deviceId, integralList);

  log("🎉 全部完成！");
}

const isMain = process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  main().catch((err) => {
    console.error("[极氪签到] 执行失败:", err.message);
    process.exit(1);
  });
}
