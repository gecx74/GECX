const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

function pad2(value) {
    return value < 10 ? '0' + value : String(value);
}

function toKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function parseKey(key) {
    const parts = String(key || '').split('-');
    if (parts.length !== 3) {
        return new Date();
    }
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function addDays(date, count) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function addMonths(date, count) {
    return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function startOfDay(input) {
    const date = input instanceof Date ? input : new Date(input);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDiff(date, base) {
    return Math.round((startOfDay(date).getTime() - startOfDay(base).getTime()) / 86400000);
}

function mondayIndex(date) {
    return (date.getDay() + 6) % 7;
}

function timeText(timestamp) {
    const date = new Date(timestamp);
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function monthDayText(date) {
    return date.getMonth() + 1 + '月' + date.getDate() + '日';
}

function fullDateText(date) {
    return date.getFullYear() + '年' + monthDayText(date) + ' ' + WEEKDAY_CN[date.getDay()];
}

function dayTitle(date, base) {
    const diff = dayDiff(date, base || new Date());
    const weekday = WEEKDAY_CN[date.getDay()];
    const monthDay = monthDayText(date);
    let label = monthDay;
    if (diff === 0) {
        label = '今天';
    } else if (diff === 1) {
        label = '明天';
    } else if (diff === 2) {
        label = '后天';
    } else if (diff === -1) {
        label = '昨天';
    }
    return {
        label: label,
        sub: label === monthDay ? weekday : monthDay + ' ' + weekday,
    };
}

function minuteText(minutes) {
    const total = Math.max(0, Math.round(minutes));
    if (total < 60) {
        return total + ' 分钟';
    }
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (!rest) {
        return hours + ' 小时';
    }
    return hours + ' 小时 ' + rest + ' 分钟';
}

module.exports = {
    WEEKDAY_CN: WEEKDAY_CN,
    WEEKDAY_SHORT: WEEKDAY_SHORT,
    pad2: pad2,
    toKey: toKey,
    parseKey: parseKey,
    addDays: addDays,
    addMonths: addMonths,
    startOfDay: startOfDay,
    dayDiff: dayDiff,
    mondayIndex: mondayIndex,
    timeText: timeText,
    monthDayText: monthDayText,
    fullDateText: fullDateText,
    dayTitle: dayTitle,
    minuteText: minuteText,
};
