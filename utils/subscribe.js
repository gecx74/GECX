/**
 * 微信订阅消息（服务通知）推送 —— 锁屏/退后台时唯一能触达的通道
 *
 * 为什么必须走云端：
 * - 小程序锁屏或退到后台后 JS 引擎被系统挂起，本地定时器、wx.vibrate、闹钟页都不会执行；
 * - 小程序没有本地通知 / 系统闹钟 API，无法自己唤醒锁屏；
 * - 只有服务端（云函数 sendReminder）在到点时调用 subscribeMessage.send 下发微信服务通知，
 *   这条通知由微信客户端接收，锁屏界面同样能弹出（前提：系统允许微信通知）。
 *
 * 授权策略：
 * - 一次最多申请 3 个模板，把用户同意的都记下来，后续按剩余次数发送；
 * - 一次性订阅每授权一次只能发一条，所以每次保存行程、每次打开小程序都会顺带补授权；
 * - 长期订阅模板（push-config 里 longTerm: true）授权一次即可长期下发。
 */

const config = require('./push-config.js');
const dateUtil = require('./date.js');

const STATE_KEY = 'trip_reminder_push_state_v1';
const SYNC_KEY = 'trip_reminder_push_sync_v1';
const MAX_TEMPLATES = 3;
// 回到前台时最多每 10 分钟补登记一次，避免频繁调用云函数
const SYNC_GAP = 10 * 60000;
// 只补登记 7 天内的行程，避免一次推太多
const SYNC_HORIZON = 7 * 86400000;

let cloudReady = false;

function hasWx() {
    return typeof wx !== 'undefined' && !!wx;
}

function templates() {
    const list = [];
    if (config.templateId) {
        list.push(config.templateId);
    }
    (config.templateIds || []).forEach((id) => {
        if (id && list.indexOf(id) < 0) {
            list.push(id);
        }
    });
    return list.slice(0, MAX_TEMPLATES);
}

function isConfigured() {
    return templates().length > 0 && !!config.cloudEnv;
}

function ensureCloud() {
    if (!isConfigured() || !hasWx() || !wx.cloud) {
        return false;
    }
    if (cloudReady) {
        return true;
    }
    try {
        wx.cloud.init({ env: config.cloudEnv, traceUser: true });
        cloudReady = true;
    } catch (error) {
        cloudReady = false;
    }
    return cloudReady;
}

// 订阅消息 time 类型要求「2026年11月17日 15:00」这样的格式
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return (
        date.getFullYear() +
        '年' +
        (date.getMonth() + 1) +
        '月' +
        date.getDate() +
        '日 ' +
        dateUtil.timeText(timestamp)
    );
}

// thing 类型上限 20 个字符
function clip(text, max) {
    const value = String(text || '').trim();
    if (!value) {
        return '';
    }
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

/**
 * 组装订阅消息内容
 * @param {Object} payload { title, startTime, detail, note }
 * @returns {Object} 形如 { thing1: { value: '总部会议' }, ... }
 */
function buildMessage(payload) {
    const source = payload || {};
    const fields = config.fields;
    const data = {};
    data[fields.title] = { value: clip(source.title || '行程提醒', 20) };
    data[fields.time] = { value: formatTime(source.startTime || Date.now()) };
    data[fields.detail] = { value: clip(source.detail || '行程即将开始', 20) };
    if (fields.note) {
        data[fields.note] = { value: clip(source.note || '点击查看行程详情', 20) };
    }
    return data;
}

function saveState(patch) {
    if (!hasWx() || typeof wx.getStorageSync !== 'function') {
        return;
    }
    try {
        const raw = wx.getStorageSync(STATE_KEY);
        const current = raw && typeof raw === 'object' ? raw : {};
        wx.setStorageSync(STATE_KEY, Object.assign({}, current, patch));
    } catch (error) {
        // 状态记录失败不影响主流程
    }
}

function readState() {
    if (!hasWx() || typeof wx.getStorageSync !== 'function') {
        return {};
    }
    try {
        const raw = wx.getStorageSync(STATE_KEY);
        return raw && typeof raw === 'object' ? raw : {};
    } catch (error) {
        return {};
    }
}

/**
 * 请求订阅授权（必须由用户点击触发，一次最多带 3 个模板）
 * @returns {Promise<Object>} { ok, accepted, reason, errCode }
 */
function request() {
    return new Promise((resolve) => {
        const ids = templates();
        if (!isConfigured()) {
            resolve({ ok: false, accepted: [], reason: 'NOT_CONFIGURED' });
            return;
        }
        if (!hasWx() || typeof wx.requestSubscribeMessage !== 'function') {
            resolve({ ok: false, accepted: [], reason: 'UNSUPPORTED' });
            return;
        }
        wx.requestSubscribeMessage({
            tmplIds: ids,
            success(res) {
                const accepted = ids.filter((id) => res && res[id] === 'accept');
                const state = readState();
                const total = (Number(state.acceptedCount) || 0) + accepted.length;
                saveState({
                    acceptedAt: Date.now(),
                    accepted: accepted.length > 0,
                    acceptedIds: accepted,
                    acceptedCount: total,
                    longTerm: !!config.longTerm,
                });
                resolve({
                    ok: accepted.length > 0,
                    accepted: accepted,
                    reason: accepted.length > 0 ? '' : 'REJECTED',
                });
            },
            fail(err) {
                // 20004：用户在微信设置里关掉了小程序通知主开关，需引导去系统设置
                const code = err && err.errCode;
                saveState({ accepted: false, lastError: code || 'REQUEST_FAILED' });
                resolve({
                    ok: false,
                    accepted: [],
                    reason: code === 20004 ? 'MAIN_SWITCH_OFF' : 'REQUEST_FAILED',
                    errCode: code || 0,
                });
            },
        });
    });
}

function pickTemplate() {
    const ids = templates();
    const state = readState();
    const saved = Array.isArray(state.acceptedIds) ? state.acceptedIds : [];
    for (let i = 0; i < saved.length; i += 1) {
        if (ids.indexOf(saved[i]) >= 0) {
            return saved[i];
        }
    }
    return ids[0] || '';
}

function callCloud(action, payload) {
    return new Promise((resolve) => {
        if (!ensureCloud()) {
            resolve({ ok: false, reason: 'NOT_CONFIGURED' });
            return;
        }
        wx.cloud.callFunction({
            name: config.cloudFunction,
            data: { action: action, payload: payload, templateId: pickTemplate() },
            success(res) {
                const result = (res && res.result) || {};
                resolve({ ok: result.ok !== false, reason: result.reason || '', data: result });
            },
            fail() {
                resolve({ ok: false, reason: 'CLOUD_FAILED' });
            },
        });
    });
}

/**
 * 行程保存后登记云端定时推送（到点由云函数下发订阅消息，锁屏也能收到）
 * @param {Object} trip 行程记录
 * @param {String} detail 提醒文案，如「还有 10 分钟开始」
 */
function schedule(trip, detail) {
    if (!trip || !trip.id) {
        return Promise.resolve({ ok: false, reason: 'INVALID_PAYLOAD' });
    }
    return callCloud('schedule', {
        id: trip.id,
        title: trip.title,
        startTime: trip.startTime,
        remindBefore: trip.remindBefore,
        note: trip.note,
        detail: detail || '',
        message: buildMessage({ title: trip.title, startTime: trip.startTime, detail: detail, note: trip.note }),
        page: config.page,
        miniprogramState: config.miniprogramState,
        openid: 'auto',
        longTerm: !!config.longTerm,
    });
}

/**
 * 闹钟响起的同一时刻立即下发一条订阅消息（前台场景，作为界面内的同步推送）
 */
function pushNow(payload) {
    if (!payload) {
        return Promise.resolve({ ok: false, reason: 'INVALID_PAYLOAD' });
    }
    return callCloud('send', {
        id: payload.id,
        message: buildMessage(payload),
        page: config.page,
        miniprogramState: config.miniprogramState,
        openid: 'auto',
    });
}

function cancel(id) {
    return callCloud('cancel', { id: id });
}

/**
 * 回到前台时补登记：锁屏/断网可能导致上次登记失败，这里把未来 7 天的行程重新登记一遍
 * @param {Array} trips 行程列表
 * @param {Boolean} force 忽略 10 分钟节流
 */
function syncPending(trips, force) {
    if (!isConfigured() || !Array.isArray(trips) || !trips.length) {
        return Promise.resolve({ ok: false, reason: 'SKIPPED', count: 0 });
    }
    const now = Date.now();
    let last = 0;
    try {
        last = Number(wx.getStorageSync(SYNC_KEY)) || 0;
    } catch (error) {
        last = 0;
    }
    if (!force && now - last < SYNC_GAP) {
        return Promise.resolve({ ok: true, reason: 'THROTTLED', count: 0 });
    }
    try {
        wx.setStorageSync(SYNC_KEY, now);
    } catch (error) {
        // 节流记录失败不影响登记
    }

    const targets = trips.filter(
        (trip) => trip && !trip.done && trip.startTime > now && trip.startTime - now <= SYNC_HORIZON
    );
    if (!targets.length) {
        return Promise.resolve({ ok: true, reason: 'NOTHING_TO_SYNC', count: 0 });
    }
    return Promise.all(
        targets.slice(0, 20).map((trip) => {
            const before = Number(trip.remindBefore) || 0;
            const detail = before > 0 ? '还有 ' + before + ' 分钟开始' : '行程现在开始';
            return schedule(trip, detail);
        })
    ).then((list) => ({
        ok: true,
        count: list.filter((item) => item && item.ok).length,
    }));
}

/**
 * 诊断信息：给「提醒可靠性」面板显示用
 */
function diagnose() {
    const state = readState();
    const ids = templates();
    return {
        configured: isConfigured(),
        templateCount: ids.length,
        longTerm: !!config.longTerm,
        cloudReady: ensureCloud(),
        acceptedCount: Number(state.acceptedCount) || 0,
        acceptedAt: Number(state.acceptedAt) || 0,
        lastError: state.lastError || '',
    };
}

/**
 * 打开系统通知设置（无法读取通知权限，只能引导用户）
 */
function openSystemSettings() {
    if (hasWx() && typeof wx.openAppAuthorizeSetting === 'function') {
        wx.openAppAuthorizeSetting({ fail() {} });
        return true;
    }
    return false;
}

module.exports = {
    STATE_KEY: STATE_KEY,
    isConfigured: isConfigured,
    ensureCloud: ensureCloud,
    templates: templates,
    request: request,
    schedule: schedule,
    pushNow: pushNow,
    cancel: cancel,
    syncPending: syncPending,
    diagnose: diagnose,
    openSystemSettings: openSystemSettings,
    buildMessage: buildMessage,
    formatTime: formatTime,
    state: readState,
};
