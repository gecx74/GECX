/**
 * 手机系统日历通道 —— 锁屏时最可靠的本地提醒
 *
 * 为什么需要它：小程序锁屏/切后台后会被系统挂起，JS 定时器与振动全部停止，
 * 无法自己弹出闹钟。把行程写进手机系统日历后，到点由「系统日历」在锁屏界面提醒，
 * 不依赖小程序是否在运行。
 *
 * 依赖 wx.addPhoneCalendar（基础库 2.15.0+），需要 scope.addPhoneCalendar 授权。
 * 授权被拒后微信不再弹窗，必须由用户点按钮 -> wx.openSetting 里重新打开，
 * 所以这里把「查授权 / 申请授权 / 去设置」都抽出来，供设置面板的按钮使用。
 */

const WEEKDAY_NONE = 0;
const SCOPE = 'scope.addPhoneCalendar';

const dateUtil = require('./date.js');
const remind = require('./remind.js');
// 已写入日历的行程 id，避免重复写入（微信没有删除日历事件的接口）
// v2：alarmOffset 曾误用分钟（正确单位为秒）
// v3：事件曾锚定在「提醒时刻」，与 App 显示的行程开始时间对不上，已回退
// v4：事件锚定「开始时间」+ 秒级偏移提前提醒（见 buildEvent），升级 key 让
//     老行程在下次保存时用新规则重写一次
const WRITTEN_KEY = 'trip_reminder_calendar_written_v4';
// 单次同步上限，防止一次点按写上百条把系统日历卡住
const MAX_BATCH = 100;

function hasWx() {
    return typeof wx !== 'undefined' && !!wx;
}

function canUse() {
    return hasWx() && typeof wx.addPhoneCalendar === 'function';
}

/* ---------- 写入登记表 ---------- */

function getWritten() {
    if (!hasWx() || typeof wx.getStorageSync !== 'function') {
        return {};
    }
    try {
        const raw = wx.getStorageSync(WRITTEN_KEY);
        return raw && typeof raw === 'object' ? raw : {};
    } catch (error) {
        return {};
    }
}

function markWritten(id) {
    if (!id || !hasWx() || typeof wx.setStorageSync !== 'function') {
        return;
    }
    const map = getWritten();
    map[id] = Date.now();
    try {
        wx.setStorageSync(WRITTEN_KEY, map);
    } catch (error) {
        // 存不进去只是下次可能重复写入，不影响主流程
    }
}

function forgetWritten(id) {
    const map = getWritten();
    if (!id || !map[id]) {
        return;
    }
    delete map[id];
    try {
        wx.setStorageSync(WRITTEN_KEY, map);
    } catch (error) {
        // 忽略
    }
}

/* ---------- 授权状态 ---------- */

/**
 * 查询当前授权状态
 * @returns {Promise<Object>} { available, state } state: granted | denied | unknown
 */
function getAuthState() {
    return new Promise((resolve) => {
        if (!canUse()) {
            resolve({ available: false, state: 'unavailable' });
            return;
        }
        if (!hasWx() || typeof wx.getSetting !== 'function') {
            resolve({ available: true, state: 'unknown' });
            return;
        }
        wx.getSetting({
            success(res) {
                const auth = (res && res.authSetting) || {};
                const value = auth[SCOPE];
                if (value === true) {
                    resolve({ available: true, state: 'granted' });
                } else if (value === false) {
                    resolve({ available: true, state: 'denied' });
                } else {
                    resolve({ available: true, state: 'unknown' });
                }
            },
            fail() {
                resolve({ available: true, state: 'unknown' });
            },
        });
    });
}

/**
 * 申请写日历授权（必须由用户点击触发）
 * 授权被拒后会返回 needSetting，调用方应引导去 wx.openSetting 重新打开
 * @returns {Promise<Object>} { ok, state, needSetting, reason }
 */
function requestAuth() {
    return new Promise((resolve) => {
        if (!canUse()) {
            resolve({ ok: false, state: 'unavailable', reason: 'UNSUPPORTED' });
            return;
        }
        getAuthState().then((info) => {
            if (info.state === 'granted') {
                resolve({ ok: true, state: 'granted' });
                return;
            }
            if (typeof wx.authorize !== 'function') {
                resolve({ ok: false, state: info.state, needSetting: true, reason: 'NO_AUTH_API' });
                return;
            }
            wx.authorize({
                scope: SCOPE,
                success() {
                    resolve({ ok: true, state: 'granted' });
                },
                fail() {
                    // 再查一次，区分「用户这次点了拒绝」和「以前拒绝过、不再弹窗」
                    getAuthState().then((after) => {
                        if (after.state === 'granted') {
                            resolve({ ok: true, state: 'granted' });
                            return;
                        }
                        resolve({
                            ok: false,
                            state: after.state === 'denied' ? 'denied' : 'unknown',
                            needSetting: after.state === 'denied',
                            reason: after.state === 'denied' ? 'DENIED' : 'CANCELED',
                        });
                    });
                },
            });
        });
    });
}

/**
 * 打开小程序设置页，让用户手动打开「添加到日历」
 * @returns {Promise<Object>} { ok } ok 表示用户回来后已授权
 */
function openSetting() {
    return new Promise((resolve) => {
        if (!hasWx() || typeof wx.openSetting !== 'function') {
            resolve({ ok: false, reason: 'NO_SETTING_API' });
            return;
        }
        wx.openSetting({
            success(res) {
                const auth = (res && res.authSetting) || {};
                resolve({ ok: auth[SCOPE] === true });
            },
            fail() {
                resolve({ ok: false, reason: 'SETTING_FAILED' });
            },
        });
    });
}

/* ---------- 写日历 ---------- */

/**
 * 组装日历事件 —— 两个时间各归其位，与 App 内显示完全对应：
 *
 *   事件时间（日历里看到的）= trip.startTime，与 App 行程列表显示的开始时间一致
 *   提醒触发时刻（锁屏弹出）  = trip.startTime - remindBefore 分钟
 *                             = App 内提醒触发时刻（remind.triggerTime，同一公式同源）
 *
 * 注意官方文档：alarmOffset 单位是「秒」，默认 0 表示开始时提醒——
 * 必须传 remindBefore * 60；传分钟数会导致「提前 10 分钟」变成开始前 10 秒才响。
 *
 * @param {Object} trip 行程记录
 */
function buildEvent(trip) {
    const startMs = Number(trip.startTime);
    const start = Math.round(startMs / 1000);
    const before = Math.min(1440, Math.max(0, Number(trip.remindBefore) || 0));
    // 与 remind.triggerTime 同一公式，App 内提醒与日历提醒同源
    const triggerAt = startMs - before * 60000;
    const remindLine =
        '提醒时间：' +
        dateUtil.fullDateText(new Date(triggerAt)) +
        ' ' +
        dateUtil.timeText(triggerAt) +
        '（' +
        remind.remindLabel(before) +
        '）';
    const lines = [];
    if (trip.note) {
        lines.push(trip.note);
    }
    lines.push(remindLine);
    lines.push('来自「行程提醒」小程序');
    return {
        title: trip.title || '行程提醒',
        startTime: start,
        endTime: start + 3600,
        alarm: true,
        alarmOffset: before * 60,
        allDay: false,
        description: lines.join('\n'),
        repeatInterval: WEEKDAY_NONE,
    };
}

function normalizeReason(msg) {
    const text = String(msg || '');
    if (text.indexOf('auth deny') >= 0 || text.indexOf('authorize') >= 0) {
        return 'DENIED';
    }
    if (text.indexOf('cancel') >= 0) {
        return 'CANCELED';
    }
    // 平台拦截：小程序的《用户隐私保护指引》未声明「日历（仅写入）」
    if (text.indexOf('privacy') >= 0 || text.indexOf('declared') >= 0 || text.indexOf('协议') >= 0) {
        return 'PRIVACY';
    }
    if (text.indexOf('not support') >= 0 || text.indexOf('invalid') >= 0) {
        return 'UNSUPPORTED';
    }
    return 'FAILED';
}

/**
 * 写入一条行程到系统日历
 * @param {Object} trip 行程记录
 * @param {Object} options { force: 忽略已写入记录再写一次 }
 * @returns {Promise<Object>} { ok, reason, event, needSetting }
 */
function addTrip(trip, options) {
    const opts = options || {};
    return new Promise((resolve) => {
        if (!trip || !trip.startTime) {
            resolve({ ok: false, reason: 'INVALID_PAYLOAD' });
            return;
        }
        if (!canUse()) {
            resolve({ ok: false, reason: 'UNSUPPORTED' });
            return;
        }
        const event = buildEvent(trip);
        // 提醒时刻已过的行程没有提醒意义（如「提前 1 天」的行程当天才建），
        // 写进去只会变成一条不会响的日历提醒，静默跳过
        if ((event.startTime - event.alarmOffset) * 1000 <= Date.now()) {
            resolve({ ok: false, reason: 'REMIND_PASSED', event: event });
            return;
        }
        // 已写过且不强制，直接跳过，避免同一条行程在日历里堆成好几份
        if (!opts.force && trip.id && getWritten()[trip.id]) {
            resolve({ ok: true, skipped: true, reason: 'ALREADY_WRITTEN', event: event });
            return;
        }
        const write = () =>
            wx.addPhoneCalendar({
                title: event.title,
                startTime: event.startTime,
                endTime: event.endTime,
                alarm: event.alarm,
                alarmOffset: event.alarmOffset,
                allDay: event.allDay,
                description: event.description,
                success() {
                    if (trip.id) {
                        markWritten(trip.id);
                    }
                    resolve({ ok: true, event: event });
                },
                fail(res) {
                    const msg = String((res && (res.errMsg || res.errmsg)) || '');
                    const reason = normalizeReason(msg);
                    resolve({
                        ok: false,
                        reason: reason,
                        message: msg,
                        event: event,
                        needSetting: reason === 'DENIED',
                    });
                },
            });
        // 不做 authorize 预检：授权弹窗由系统随「写入」动作直接触发（已授权时静默写入）
        write();
    });
}

/**
 * 挑出还没写进日历的行程：未来、未完成、未写过
 * @param {Array} trips 行程列表
 * @param {Object} options { force, now }
 */
function pendingTrips(trips, options) {
    const opts = options || {};
    const now = Number(opts.now) || Date.now();
    const written = opts.force ? {} : getWritten();
    return (trips || []).filter((trip) => {
        if (!trip || !trip.startTime) {
            return false;
        }
        if (trip.done) {
            return false;
        }
        // 已经开始的行程写进日历没有提醒意义
        if (Number(trip.startTime) <= now) {
            return false;
        }
        if (trip.id && written[trip.id]) {
            return false;
        }
        return true;
    });
}

/**
 * 批量写入：一键把全部未写入的行程加进系统日历
 * @param {Array} trips 行程列表
 * @param {Object} options { force, now, limit, onProgress(index, total) }
 * @returns {Promise<Object>} { total, ok, skipped, failed, denied, needSetting, remaining }
 */
function writeAll(trips, options) {
    const opts = options || {};
    const now = Number(opts.now) || Date.now();
    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : MAX_BATCH;
    const list = pendingTrips(trips, { force: opts.force, now: now });
    const pendingTotal = list.length;
    const batch = list.slice(0, limit);
    const result = {
        total: pendingTotal,
        ok: 0,
        skipped: 0,
        failed: 0,
        denied: false,
        blocked: false,
        needSetting: false,
        remaining: pendingTotal - batch.length,
        reason: '',
    };
    if (!batch.length) {
        return Promise.resolve(result);
    }
    return new Promise((resolve) => {
        let index = 0;
        const step = () => {
            if (index >= batch.length) {
                resolve(result);
                return;
            }
            const trip = batch[index];
            index += 1;
            addTrip(trip, { force: opts.force }).then((res) => {
                if (res.ok) {
                    if (res.skipped) {
                        result.skipped += 1;
                    } else {
                        result.ok += 1;
                    }
                } else {
                    result.failed += 1;
                    result.reason = res.reason;
                    if (res.reason === 'DENIED' || res.reason === 'UNSUPPORTED' || res.reason === 'PRIVACY') {
                        // 没授权 / 平台拦截，继续写也是一条条失败
                        result.blocked = true;
                        result.denied = res.reason === 'DENIED';
                        result.privacy = res.reason === 'PRIVACY';
                        result.needSetting = !!res.needSetting;
                        result.remaining += batch.length - index;
                        resolve(result);
                        return;
                    }
                }
                if (typeof opts.onProgress === 'function') {
                    opts.onProgress(index, batch.length);
                }
                step();
            });
        };
        step();
    });
}

module.exports = {
    SCOPE: SCOPE,
    canUse: canUse,
    buildEvent: buildEvent,
    getAuthState: getAuthState,
    requestAuth: requestAuth,
    openSetting: openSetting,
    addTrip: addTrip,
    pendingTrips: pendingTrips,
    writeAll: writeAll,
    getWritten: getWritten,
    markWritten: markWritten,
    forgetWritten: forgetWritten,
};
