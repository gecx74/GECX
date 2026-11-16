/**
 * 闹钟引擎
 * - 负责「到点开响」：导航到全屏闹钟页，页面负责界面与振动
 * - 负责振动：默认长振动，3 次一组，组间间歇，最长 5 分钟自动停振（界面保留）
 * - 负责贪睡：稍后提醒记录落本地存储，App 重启也不丢
 * - 全局同时只响一个闹钟，避免多个页面叠加
 */

const settings = require('./settings.js');

const SNOOZE_KEY = 'trip_reminder_snoozes_v1';
const MAX_SNOOZE = 20;

// 振动节拍：wx.vibrateLong 单次约 400ms
const VIBRATE = {
    type: 'long',
    rounds: 3,
    roundGapMs: 900,
    groupGapMs: 4000,
    maxRingMs: 5 * 60000,
};

let ringing = false;

function hasWx() {
    return typeof wx !== 'undefined' && !!wx;
}

function hasStorage() {
    return hasWx() && typeof wx.getStorageSync === 'function';
}

function getOptions() {
    const alarm = settings.getAlarm();
    return {
        vibrate: alarm.vibrate !== false,
        rounds: Math.min(5, Math.max(1, Number(alarm.vibrateRounds) || VIBRATE.rounds)),
        roundGapMs: VIBRATE.roundGapMs,
        groupGapMs: VIBRATE.groupGapMs,
        maxRingMs: VIBRATE.maxRingMs,
        snoozeMinutes: Math.min(60, Math.max(1, Number(alarm.snoozeMinutes) || 5)),
        type: VIBRATE.type,
    };
}

function vibrateOnce(type) {
    if (!hasWx() || typeof wx.vibrateLong !== 'function') {
        return;
    }
    try {
        if (type === 'short') {
            if (typeof wx.vibrateShort === 'function') {
                wx.vibrateShort({ type: 'heavy' });
            }
        } else {
            wx.vibrateLong();
        }
    } catch (error) {
        // 少数设备/开发者工具不支持振动，静默忽略，不影响闹钟界面
    }
}

/**
 * 启动振动循环，返回 { stop }。
 * 时间轴：3 次长振（每次间隔 0.9s）→ 停 4s → 再来一组，直到 maxRingMs（默认 5 分钟）
 */
function startVibrateLoop(custom) {
    const opts = Object.assign(getOptions(), custom || {});
    const deadline = Date.now() + opts.maxRingMs;
    let timer = null;
    let stopped = false;

    function stop() {
        stopped = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function group() {
        if (stopped || Date.now() >= deadline) {
            stop();
            return;
        }
        let beat = 0;
        function pulse() {
            if (stopped) {
                return;
            }
            vibrateOnce(opts.type);
            beat += 1;
            timer = setTimeout(beat < opts.rounds ? pulse : group, beat < opts.rounds ? opts.roundGapMs : opts.groupGapMs);
        }
        pulse();
    }

    if (opts.vibrate) {
        group();
    }

    return { stop: stop };
}

function isRinging() {
    return ringing;
}

function setRinging(value) {
    ringing = !!value;
}

/**
 * 触发闹钟：写入待展示数据 → 打开全屏闹钟页
 * 打开失败（页面栈已满等）时降级为原来的模态弹窗，保证不漏提醒
 */
function ring(payload) {
    if (!payload || ringing) {
        return false;
    }
    const app = hasWx() && typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) {
        app.globalData.pendingAlarm = payload;
    }
    ringing = true;
    if (!hasWx() || typeof wx.navigateTo !== 'function') {
        return true;
    }
    wx.navigateTo({
        url: '/pages/alarm/alarm',
        fail() {
            ringing = false;
            fallbackModal(payload);
        },
    });
    return true;
}

function fallbackModal(payload) {
    if (!hasWx() || typeof wx.showModal !== 'function') {
        return;
    }
    vibrateOnce('long');
    wx.showModal({
        title: '行程提醒',
        content: payload.title + '\n' + (payload.detail || ''),
        confirmText: '知道了',
        showCancel: false,
        confirmColor: '#2B5CE6',
    });
}

/* ---------------- 稍后提醒（贪睡） ---------------- */

function readSnoozes() {
    if (!hasStorage()) {
        return [];
    }
    try {
        const raw = wx.getStorageSync(SNOOZE_KEY);
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.filter((item) => item && typeof item.id === 'string' && isFinite(item.at));
    } catch (error) {
        return [];
    }
}

function writeSnoozes(list) {
    if (!hasStorage()) {
        return;
    }
    try {
        wx.setStorageSync(SNOOZE_KEY, list.slice(0, MAX_SNOOZE));
    } catch (error) {
        // 存储失败不影响本次响铃
    }
}

function snooze(payload, minutes) {
    if (!payload || !payload.id) {
        return { data: null, error: 'INVALID_PAYLOAD' };
    }
    const wait = Math.min(60, Math.max(1, Number(minutes) || getOptions().snoozeMinutes));
    const at = Date.now() + wait * 60000;
    const record = Object.assign({}, payload, {
        phase: 'snooze',
        at: at,
        snoozedFrom: payload.at || Date.now(),
    });
    const list = readSnoozes().filter((item) => item.id !== record.id);
    list.push(record);
    writeSnoozes(list);
    return { data: record, error: null };
}

function dueSnoozes(now) {
    const time = Number(now) || Date.now();
    const list = readSnoozes();
    const due = list.filter((item) => item.at <= time);
    if (due.length) {
        writeSnoozes(list.filter((item) => item.at > time));
    }
    return due;
}

function clearSnooze(id) {
    const list = readSnoozes();
    const next = list.filter((item) => item.id !== id);
    if (next.length !== list.length) {
        writeSnoozes(next);
    }
}

module.exports = {
    SNOOZE_KEY: SNOOZE_KEY,
    VIBRATE: VIBRATE,
    getOptions: getOptions,
    startVibrateLoop: startVibrateLoop,
    vibrateOnce: vibrateOnce,
    isRinging: isRinging,
    setRinging: setRinging,
    ring: ring,
    snooze: snooze,
    dueSnoozes: dueSnoozes,
    clearSnooze: clearSnooze,
};
