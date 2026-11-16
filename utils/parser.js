// 行程文本解析：从通知/日程文本里提取标题、日期、时间、备注，离线可用
// 日期一律以「基准日」（默认当前时刻）推算并补全年份，避免出现往年日期

// 跨年判定阈值：无年份的「M月D日」若已过去超过该天数，视为明年
const ROLL_YEAR_DAYS = 180;
const DAY_MS = 86400000;

// 周几 -> 距离本周周一的天数（周一 = 0，周日 = 6）
const WEEKDAY_OFFSET = {
    '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6,
    '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6,
};

function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

function toKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function startOfDay(input) {
    const date = input instanceof Date ? input : new Date(input || Date.now());
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, count) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

// 构造并校验年月日：2 月 30 日这类非法日期直接判为无效，不做自动顺延
function makeDate(year, monthIndex, day) {
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
        return null;
    }
    let y = year;
    let m = monthIndex;
    while (m < 0) {
        m += 12;
        y -= 1;
    }
    while (m > 11) {
        m -= 12;
        y += 1;
    }
    if (day < 1 || day > daysInMonth(y, m)) {
        return null;
    }
    return new Date(y, m, day);
}

function dayGap(from, to) {
    return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

// 带年份的完整日期：2026-11-17 / 2026年11月17日
function findFullDate(text) {
    const m = text.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/);
    if (!m) {
        return null;
    }
    return makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 「M月D日」：按当前年份补全；若该日期已过去半年以上，判定为明年
function findMonthDay(text, base) {
    const m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (!m) {
        return null;
    }
    const monthIndex = Number(m[1]) - 1;
    const day = Number(m[2]);
    const today = startOfDay(base);
    let candidate = makeDate(today.getFullYear(), monthIndex, day);
    if (!candidate) {
        return null;
    }
    if (dayGap(candidate, today) > ROLL_YEAR_DAYS) {
        const rolled = makeDate(today.getFullYear() + 1, monthIndex, day);
        if (rolled) {
            candidate = rolled;
        }
    }
    return candidate;
}

// 「下个月 5 号」「本月 20 号」这类带月份指示词的写法
function findRelativeMonthDay(text, base) {
    const m = text.match(/(下个?月|这个?月|本月|这月)\s*(\d{1,2})\s*[日号]/);
    if (!m) {
        return null;
    }
    const today = startOfDay(base);
    const offset = m[1].indexOf('下') >= 0 ? 1 : 0;
    const candidate = makeDate(today.getFullYear(), today.getMonth() + offset, Number(m[2]));
    return candidate;
}

// 周几：支持「周三」「下周二」「这周五」「上周一」「下下周三」「礼拜天」「星期7」
function findWeekday(text, base) {
    const m = text.match(/(上上|下下|上|下|这|本)?\s*个?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (!m) {
        return null;
    }
    const prefix = m[1] || '';
    const target = WEEKDAY_OFFSET[m[2]];
    const today = startOfDay(base);
    const todayOffset = (today.getDay() + 6) % 7; // 今天距本周周一的天数
    const monday = addDays(today, -todayOffset);
    if (prefix === '下下') {
        return addDays(monday, 14 + target);
    }
    if (prefix === '下') {
        return addDays(monday, 7 + target);
    }
    if (prefix === '上上') {
        return addDays(monday, target - 14);
    }
    if (prefix === '上') {
        return addDays(monday, target - 7);
    }
    if (prefix === '这' || prefix === '本') {
        return addDays(monday, target);
    }
    // 不带前缀：取今天及之后最近的一次
    return addDays(today, (target - todayOffset + 7) % 7);
}

// 只有日号：「14号」「17日」（排除「3号线」「11月14号」这类已带月份/线路的写法）
function findDayOnly(text, base) {
    const m = text.match(/(?:^|[^\d月年])(\d{1,2})\s*[日号](?!\s*(?:[线楼栋房厅门口座院馆室]|会议室))/);
    if (!m) {
        return null;
    }
    const day = Number(m[1]);
    const today = startOfDay(base);
    // 从本月开始往后找第一个成立且不早于今天的同号日期（最多找一年）
    for (let offset = 0; offset < 13; offset++) {
        const candidate = makeDate(today.getFullYear(), today.getMonth() + offset, day);
        if (candidate && dayGap(today, candidate) >= 0) {
            return candidate;
        }
    }
    return null;
}

function findDate(text, base) {
    const today = startOfDay(base);
    const full = findFullDate(text);
    if (full) {
        return full;
    }
    const relativeMonthDay = findRelativeMonthDay(text, today);
    if (relativeMonthDay) {
        return relativeMonthDay;
    }
    const monthDay = findMonthDay(text, today);
    if (monthDay) {
        return monthDay;
    }
    if (/大后天/.test(text)) {
        return addDays(today, 3);
    }
    if (/今天|今日|本日/.test(text)) {
        return today;
    }
    if (/明天|明日/.test(text)) {
        return addDays(today, 1);
    }
    if (/后天/.test(text)) {
        return addDays(today, 2);
    }
    const weekday = findWeekday(text, today);
    if (weekday) {
        return weekday;
    }
    return findDayOnly(text, today);
}

function findTime(text) {
    let m = text.match(/(上午|早上|早晨|凌晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})[:：点时]\s*(\d{1,2})?分?(?:钟)?/);
    if (m) {
        let hour = Number(m[2]);
        const minute = m[3] ? Number(m[3]) : 0;
        const period = m[1] || '';
        if (period && hour <= 12) {
            if ((period === '下午' || period === '晚上' || period === '傍晚') && hour < 12) {
                hour += 12;
            } else if (period === '中午' && hour < 12) {
                hour = 12;
            } else if (period === '凌晨' && hour === 12) {
                hour = 0;
            }
        }
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return pad2(hour) + ':' + pad2(minute);
        }
    }
    m = text.match(/(\d{1,2})\s*点半/);
    if (m) {
        let hour = Number(m[1]);
        if (/下午|晚上|傍晚/.test(text) && hour < 12) {
            hour += 12;
        }
        return pad2(hour) + ':30';
    }
    return '';
}

function findTitle(text) {
    let m = text.match(/[【\[《]\s*([^】\]》]{1,30})\s*[】\]》]/);
    if (m && m[1].trim()) {
        return m[1].trim();
    }
    m = text.match(/(?:行程|会议|主题|事项|提醒)[：:]\s*([^\n，。；,;]{1,30})/);
    if (m && m[1].trim()) {
        return m[1].trim();
    }
    // 逐行找第一行去掉日期时间词后的实质内容
    const lines = text.split(/\n|。|；|;/).map((line) => line.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
        const stripped = lines[i]
            .replace(/[【\[《][^】\]》]*[】\]》]/g, '')
            .replace(/\d{4}\s*[-/年.]\s*\d{1,2}\s*[-/月.]\s*\d{1,2}\s*[日号]?/g, '')
            .replace(/(下个?月|这个?月|本月|这月)\s*\d{1,2}\s*[日号]/g, '')
            .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, '')
            .replace(/\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}/g, '')
            .replace(/大后天|今天|今日|本日|明天|明日|后天/g, '')
            .replace(/(上上|下下|上|下|这|本)?\s*个?\s*(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, '')
            .replace(/(?:^|[^\d])\d{1,2}\s*[日号](?!\s*(?:[线楼栋房厅门口座院馆室]|会议室))/g, '')
            .replace(/[上下]午|早上|早晨|凌晨|中午|傍晚|晚上/g, '')
            .replace(/\d{1,2}\s*点半/g, '')
            .replace(/\d{1,2}[:：点时]\s*\d{0,2}分?(?:钟)?/g, '')
            .replace(/(^|\s)半(?=\s|$)/g, '$1')
            .replace(/^[：:，,、\s-]+|[：:，,、\s-]+$/g, '')
            .trim();
        if (stripped.length >= 2) {
            return stripped.slice(0, 30);
        }
    }
    return '';
}

function findNote(text) {
    let m = text.match(/(?:地点|位置|地址)[：:]?\s*([^\n，。；,;]{2,40})/);
    if (m) {
        return ('地点：' + m[1].trim()).slice(0, 200);
    }
    m = text.match(/在\s*([^\n，。；,;]{2,30})(?:召开|举行|见面|开会|集合)/);
    if (m) {
        return ('地点：' + m[1].trim()).slice(0, 200);
    }
    return '';
}

// 返回 { title, date, time, note, matched }；matched 为 false 表示没有识别出任何有效信息
// baseDate 可选，默认当前时间，便于按指定日期推算与测试
function parse(text, baseDate) {
    const clean = String(text || '').trim();
    if (!clean) {
        return { title: '', date: '', time: '', note: '', matched: false };
    }
    const base = startOfDay(baseDate || new Date());
    const date = findDate(clean, base);
    const time = findTime(clean);
    const title = findTitle(clean);
    const note = findNote(clean);
    const matched = Boolean(title) || Boolean(date) || Boolean(time);
    return {
        title: title,
        date: date ? toKey(date) : '',
        time: time,
        note: note,
        matched: matched,
    };
}

module.exports = {
    parse: parse,
};
