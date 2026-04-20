/**
 * ARKNIGHTS: ENDFIELD DAILY ATTENDANCE (Google Apps Script)
 * With Discord / Telegram Notification & Auto-Scheduler
 */

// ==========================================
// 1. SETUP & CONFIGURATION
// ==========================================

// Log into SKPORT then go to https://web-api.skport.com/cookie_store/account_token and copy the code here
const ACCOUNT_TOKEN = "";

// Server region: "2" = Asia, "3" = Americas / Europe (EU)
const SERVER_REGION = "3";

// Daily trigger time (hour in 24h format, e.g. 9 = 9 AM)
const TRIGGER_HOUR = 9;

// Timezone for the trigger (e.g. "Europe/Berlin", "Asia/Jakarta", "America/New_York")
const TRIGGER_TIMEZONE = "Europe/Berlin";

// (Optional) Paste Discord Webhook URL. Leave empty "" to disable.
const DISCORD_WEBHOOK_URL = "";

// (Optional) Telegram Bot Token and Chat ID. Leave empty "" to disable.
// Create a bot via @BotFather, then get your chat ID via @userinfobot or the getUpdates API.
const TELEGRAM_BOT_TOKEN = "";
const TELEGRAM_CHAT_ID = "";

// ==========================================
// 2. TRIGGER SETUP (Run this function once)
// ==========================================

/**
 * Run this function ONCE to set up the daily automated schedule.
 * Adjust TRIGGER_HOUR and TRIGGER_TIMEZONE at the top of the script to change the schedule.
 */
function setupDailyTrigger() {
  const functionName = "main";

  // Delete existing triggers for 'main' to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(TRIGGER_HOUR)
    .inTimezone(TRIGGER_TIMEZONE)
    .create();

  Logger.log(
    `✅ Trigger set! '${functionName}' will run daily at ${TRIGGER_HOUR}:00 (${TRIGGER_TIMEZONE}).`,
  );
}

// ==========================================
// 3. MAIN LOGIC
// ==========================================

const CONSTANTS = {
  APP_CODE: "6eb76d4e13aa36e6",
  PLATFORM: "3",
  VNAME: "1.0.0",
  ENDFIELD_GAME_ID: "3",
  URLS: {
    GRANT: "https://as.gryphline.com/user/oauth2/v2/grant",
    GENERATE_CRED:
      "https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code",
    REFRESH_TOKEN: "https://zonai.skport.com/web/v1/auth/refresh",
    BINDING: "https://zonai.skport.com/api/v1/game/player/binding",
    ATTENDANCE: "https://zonai.skport.com/web/v1/game/endfield/attendance",
  },
};

function main() {
  try {
    performCheckIn();
  } catch (e) {
    Logger.log("CRITICAL ERROR: " + e.toString());
    sendNotification(
      "Script Error",
      e.toString(),
      "Endfield Assistant",
      15548997,
    ); // Red
  }
}

function performCheckIn() {
  Logger.log("Starting Endfield Check-in...");

  const props = PropertiesService.getScriptProperties();
  let cred = props.getProperty("CACHED_CRED");
  let signToken = null;

  // Try to use cached cred first; if it fails, fall back to full auth
  if (cred) {
    signToken = getSignToken(cred);
  }

  if (!signToken) {
    Logger.log("Authenticating with ACCOUNT_TOKEN...");
    const oauthCode = getOAuthCode(decodeURIComponent(ACCOUNT_TOKEN));
    if (!oauthCode)
      throw new Error("Failed to get OAuth Code (Check ACCOUNT_TOKEN)");
    cred = getCred(oauthCode);
    if (!cred) throw new Error("Failed to get Credential");
    props.setProperty("CACHED_CRED", cred);
    signToken = getSignToken(cred);
    if (!signToken) throw new Error("Failed to get Sign Token");
  }

  const gameRoles = getPlayerBinding(cred, signToken);

  // Attendance Request
  for (const gameRole of gameRoles) {
    const response = sendAttendanceRequest(cred, signToken, gameRole);
    Logger.log("API Response: " + JSON.stringify(response));
    handleResponse(gameRole, response);
  }
}

// --- RESULT HANDLER ---

function handleResponse(gameRole, json) {
  const code = json.code;
  const msg = json.message || "";

  // Success (Code 0)
  if (code === 0) {
    const rewards = parseRewards(json.data);
    const desc = `Status: Signed in successfully!\nRewards: ${rewards}`;
    Logger.log("Success: " + rewards);
    sendNotification("Endfield Attendance Success", desc, gameRole, 5763719); // Green
  }
  // Already Signed In
  else if (
    code === 1001 ||
    code === 10001 ||
    msg.toLowerCase().includes("already")
  ) {
    Logger.log("Already signed in today.");
    sendNotification(
      "Endfield Attendance Info",
      "You have already signed in today.",
      gameRole,
      16776960,
    ); // Yellow
  }
  // Token Expired / Error
  else if (code === 10002) {
    Logger.log("Token Expired.");
    sendNotification(
      "Endfield Login Failed",
      "Account Token is expired. Please update the script.",
      gameRole,
      15548997,
    ); // Red
  }
  // Unknown Error
  else {
    Logger.log("Unknown API Error: " + msg);
    sendNotification(
      "Endfield Attendance Error",
      `API Code: ${code}\nMessage: ${msg}`,
      gameRole,
      15548997,
    ); // Red
  }
}

// --- NOTIFICATION DISPATCHER ---

function sendNotification(title, description, footer, color) {
  sendDiscordWebhook(title, description, footer, color);
  sendTelegramMessage(title, description, footer);
}

// --- DISCORD WEBHOOK ---

function sendDiscordWebhook(title, description, footer, color) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.trim() === "") return;

  const payload = {
    username: "Endfield Assistant",
    avatar_url:
      "https://static.skport.com/asset/game/endfield_740c9ea5dd44bf4a3e6932c595e30a26.png",
    embeds: [
      {
        title: title,
        description: description,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: String(footer) },
      },
    ],
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
  } catch (e) {
    Logger.log("Failed to send Discord webhook: " + e.toString());
  }
}

// --- TELEGRAM MESSAGE ---

function sendTelegramMessage(title, description, footer) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.trim() === "") return;
  if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID.trim() === "") return;

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const text = `<b>${escapeHtml(title)}</b>\n${escapeHtml(description)}\n\n<i>${escapeHtml(footer)}</i>`;

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: "HTML",
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    UrlFetchApp.fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      options,
    );
  } catch (e) {
    Logger.log("Failed to send Telegram message: " + e.toString());
  }
}

// --- HELPERS ---

function parseRewards(data) {
  if (!data) return "Unknown";
  if (data.reward) return `${data.reward.name} x${data.reward.count}`;
  if (data.awardIds && data.resourceInfoMap) {
    let list = [];
    for (let i = 0; i < data.awardIds.length; i++) {
      const id = data.awardIds[i].id;
      if (data.resourceInfoMap[id]) {
        const item = data.resourceInfoMap[id];
        list.push(`${item.name} x${item.count}`);
      }
    }
    return list.join(", ");
  }
  return "No rewards data found";
}

// --- API STEPS ---

function getOAuthCode(token) {
  const payload = { token: token, appCode: CONSTANTS.APP_CODE, type: 0 };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(CONSTANTS.URLS.GRANT, options);
  const json = JSON.parse(response.getContentText());
  return json.status === 0 && json.data && json.data.code
    ? json.data.code
    : null;
}

function getCred(oauthCode) {
  const payload = { kind: 1, code: oauthCode };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(CONSTANTS.URLS.GENERATE_CRED, options);
  const json = JSON.parse(response.getContentText());
  return json.code === 0 && json.data && json.data.cred ? json.data.cred : null;
}

function getSignToken(cred) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers = {
    cred: cred,
    platform: CONSTANTS.PLATFORM,
    vname: CONSTANTS.VNAME,
    timestamp: timestamp,
    "sk-language": "en",
  };
  const options = { method: "get", headers: headers, muteHttpExceptions: true };
  const response = UrlFetchApp.fetch(CONSTANTS.URLS.REFRESH_TOKEN, options);
  const json = JSON.parse(response.getContentText());
  return json.code === 0 && json.data && json.data.token
    ? json.data.token
    : null;
}

function getPlayerBinding(cred, signToken) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = "/api/v1/game/player/binding";
  const signature = computeSign(path, "", timestamp, signToken);
  const headers = {
    cred: cred,
    platform: CONSTANTS.PLATFORM,
    vname: CONSTANTS.VNAME,
    timestamp: timestamp,
    "sk-language": "en",
    sign: signature,
  };
  const options = { method: "get", headers: headers, muteHttpExceptions: true };
  const response = UrlFetchApp.fetch(CONSTANTS.URLS.BINDING, options);
  const json = JSON.parse(response.getContentText());
  let roles = [];

  if (json.code === 0 && json.data && json.data.list) {
    const apps = json.data.list;
    for (let i = 0; i < apps.length; i++) {
      if (apps[i].appCode === "endfield" && apps[i].bindingList) {
        const binding = apps[i].bindingList[0];
        for (const role of binding.roles) {
          roles.push(
            `${CONSTANTS.ENDFIELD_GAME_ID}_${role.roleId}_${role.serverId || SERVER_REGION}`,
          );
        }
      }
    }
  }
  return roles;
}

function sendAttendanceRequest(cred, signToken, gameRole) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = "/web/v1/game/endfield/attendance";
  const signature = computeSign(path, "", timestamp, signToken);
  const headers = {
    cred: cred,
    platform: CONSTANTS.PLATFORM,
    vname: CONSTANTS.VNAME,
    timestamp: timestamp,
    "sk-language": "en",
    sign: signature,
    "Content-Type": "application/json",
  };
  if (gameRole) headers["sk-game-role"] = gameRole;
  const options = {
    method: "post",
    headers: headers,
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(CONSTANTS.URLS.ATTENDANCE, options);
  return JSON.parse(response.getContentText());
}

// --- CRYPTO LOGIC ---

function computeSign(path, body, timestamp, signToken) {
  const headerObj = {
    platform: CONSTANTS.PLATFORM,
    timestamp: timestamp,
    dId: "",
    vName: CONSTANTS.VNAME,
  };
  const headersJson = JSON.stringify(headerObj);
  const signString = path + body + timestamp + headersJson;
  Logger.log("computeSign — signToken: " + signToken);
  Logger.log("computeSign — signString: " + signString);
  const hmacBytes = Utilities.computeHmacSha256Signature(
    signString,
    signToken,
    Utilities.Charset.UTF_8,
  );
  Logger.log("computeSign — hmacBytes: " + JSON.stringify(hmacBytes));
  const hmacHex = bytesToHex(hmacBytes);
  const md5Bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    hmacHex,
    Utilities.Charset.UTF_8,
  );
  Logger.log("computeSign — md5Bytes: " + JSON.stringify(md5Bytes));
  return bytesToHex(md5Bytes);
}

function bytesToHex(bytes) {
  return bytes
    .map(function (byte) {
      return ("0" + (byte & 0xff).toString(16)).slice(-2);
    })
    .join("");
}
