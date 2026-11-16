/**
 * 前台活跃时间记录
 * 用于判断「锁屏/切后台期间错过了哪些提醒」：小程序被挂起时无法记时间，
 * 所以每次进前台/在处理逻辑时把时间戳落盘，回来时用它算出错过区间。
 */

const KEY = 'trip_reminder_active_v1';
// 15 秒内只写一次，避免频繁写存储
const TOUCH_GAP = 15000;

let lastWrite = 0;

function hasWx() {
    return typeof wx !== 'undefined' && !!wx;
}

function touch(force) {
    const now = Date.now();
    if (!force && now - lastWrite < TOUCH_GAP) {
        return now;
    }
    if (hasWx() && typeof wx.setStorageSync === 'function') {
        try {
            wx.setStorageSync(KEY, now);
            lastWrite = now;
        } catch (error) {
            // 存储失败不影响提醒调度
        }
    }
    return now;
}

function lastActive() {
    if (!hasWx() || typeof wx.getStorageSync !== 'function') {
        return 0;
    }
    try {
        const value = Number(wx.getStorageSync(KEY));
        return isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
        return 0;
    }
}

function clear() {
    lastWrite = 0;
    if (hasWx() && typeof wx.removeStorageSync === 'function') {
        try {
            wx.removeStorageSync(KEY);
        } catch (error) {
            // 忽略
        }
    }
}

module.exports = {
    KEY: KEY,
    touch: touch,
    lastActive: lastActive,
    clear: clear,
};
