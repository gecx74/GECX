const STORAGE_KEY = 'trip_reminder_settings_v1';

const FONT_SCALES = [
    { key: 's', label: '小', fs: 0.9 },
    { key: 'm', label: '标准', fs: 1 },
    { key: 'l', label: '大', fs: 1.15 },
    { key: 'xl', label: '超大', fs: 1.3 },
];

const DEFAULT_FONT_SCALE = 'm';

// 字型：手机系统内置字体。小篆没有系统内置字库，楷体是观感最接近且各机型都有的选择
const FONT_STYLES = [
    { key: 'kai', label: '楷体' },
    { key: 'song', label: '宋体' },
    { key: 'hei', label: '黑体' },
    { key: 'sys', label: '系统默认' },
];

const DEFAULT_FONT_STYLE = 'kai';

function isValidScale(key) {
    for (let i = 0; i < FONT_SCALES.length; i += 1) {
        if (FONT_SCALES[i].key === key) {
            return true;
        }
    }
    return false;
}

function isValidStyle(key) {
    for (let i = 0; i < FONT_STYLES.length; i += 1) {
        if (FONT_STYLES[i].key === key) {
            return true;
        }
    }
    return false;
}

// 闹钟式提醒的默认参数：振动默认开启，稍后提醒 5 分钟
const ALARM_DEFAULTS = {
    vibrate: true,
    vibrateRounds: 3,
    snoozeMinutes: 5,
    push: true,
    // 写入手机系统日历：锁屏时由系统日历提醒，是小程序被挂起后最可靠的本地提醒
    calendar: true,
};

function readSettings() {
    try {
        const raw = wx.getStorageSync(STORAGE_KEY);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return raw;
        }
    } catch (error) {
        return {};
    }
    return {};
}

function getFontScale() {
    const raw = readSettings();
    return isValidScale(raw.fontScale) ? raw.fontScale : DEFAULT_FONT_SCALE;
}

function getFontStyle() {
    const raw = readSettings();
    return isValidStyle(raw.fontStyle) ? raw.fontStyle : DEFAULT_FONT_STYLE;
}

function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!isFinite(num)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, num));
}

function getAlarm() {
    const raw = readSettings().alarm;
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        vibrate: source.vibrate !== false,
        vibrateRounds: clampNumber(source.vibrateRounds, 1, 5, ALARM_DEFAULTS.vibrateRounds),
        snoozeMinutes: clampNumber(source.snoozeMinutes, 1, 60, ALARM_DEFAULTS.snoozeMinutes),
        push: source.push !== false,
        calendar: source.calendar !== false,
    };
}

function setAlarm(patch) {
    const next = Object.assign({}, getAlarm(), patch || {});
    next.vibrateRounds = clampNumber(next.vibrateRounds, 1, 5, ALARM_DEFAULTS.vibrateRounds);
    next.snoozeMinutes = clampNumber(next.snoozeMinutes, 1, 60, ALARM_DEFAULTS.snoozeMinutes);
    next.vibrate = next.vibrate !== false;
    next.push = next.push !== false;
    next.calendar = next.calendar !== false;
    return save({ alarm: next });
}

function save(patch) {
    const next = Object.assign({}, readSettings(), patch);
    try {
        wx.setStorageSync(STORAGE_KEY, next);
        return { data: next, error: null };
    } catch (error) {
        return { data: null, error: 'CLIENT_EXCEPTION' };
    }
}

function setFontScale(key) {
    if (!isValidScale(key)) {
        return { data: null, error: 'INVALID_PAYLOAD' };
    }
    return save({ fontScale: key });
}

function setFontStyle(key) {
    if (!isValidStyle(key)) {
        return { data: null, error: 'INVALID_PAYLOAD' };
    }
    return save({ fontStyle: key });
}

module.exports = {
    FONT_SCALES: FONT_SCALES,
    DEFAULT_FONT_SCALE: DEFAULT_FONT_SCALE,
    FONT_STYLES: FONT_STYLES,
    DEFAULT_FONT_STYLE: DEFAULT_FONT_STYLE,
    ALARM_DEFAULTS: ALARM_DEFAULTS,
    getAlarm: getAlarm,
    setAlarm: setAlarm,
    getFontScale: getFontScale,
    setFontScale: setFontScale,
    getFontStyle: getFontStyle,
    setFontStyle: setFontStyle,
};
