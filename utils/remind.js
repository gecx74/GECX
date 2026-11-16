const REMIND_OPTIONS = [
    { value: 0, label: '准时提醒' },
    { value: 5, label: '提前 5 分钟' },
    { value: 10, label: '提前 10 分钟' },
    { value: 15, label: '提前 15 分钟' },
    { value: 30, label: '提前 30 分钟' },
    { value: 60, label: '提前 1 小时' },
    { value: 120, label: '提前 2 小时' },
    { value: 1440, label: '提前 1 天' },
];

const DEFAULT_REMIND = 10;

function remindLabel(minutes) {
    const value = Number(minutes) || 0;
    for (let i = 0; i < REMIND_OPTIONS.length; i += 1) {
        if (REMIND_OPTIONS[i].value === value) {
            return REMIND_OPTIONS[i].label;
        }
    }
    return '提前 ' + value + ' 分钟';
}

function triggerTime(trip) {
    const before = Number(trip.remindBefore) || 0;
    return trip.startTime - before * 60000;
}

function indexOfValue(value) {
    for (let i = 0; i < REMIND_OPTIONS.length; i += 1) {
        if (REMIND_OPTIONS[i].value === Number(value)) {
            return i;
        }
    }
    return 0;
}

module.exports = {
    REMIND_OPTIONS: REMIND_OPTIONS,
    DEFAULT_REMIND: DEFAULT_REMIND,
    remindLabel: remindLabel,
    triggerTime: triggerTime,
    indexOfValue: indexOfValue,
};
