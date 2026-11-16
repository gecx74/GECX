const store = require('./store.js');
const dateUtil = require('./date.js');
const remind = require('./remind.js');
const alarm = require('./alarm.js');
const settings = require('./settings.js');
const subscribe = require('./subscribe.js');
const activity = require('./activity.js');

// 兜底轮询：精确定时器可能被系统冻结，定期再校一次
const CHECK_INTERVAL = 20000;
// 单次精确定时不超过 1 分钟，到点后重新计算下一次，避免长定时器漂移
const MAX_TIMEOUT = 60000;
// 到点后补响窗口：与原逻辑一致，超过 15 分钟不再打扰
const LATE_WINDOW = 15 * 60000;
// 解锁补响上限：锁屏错过的提醒，回到前台 24 小时内仍补响一次（超出的只提示不响）
const CATCH_UP_LIMIT = 24 * 3600000;
// 临近响铃时保持屏幕常亮，避免「屏幕自动熄灭 → 小程序被挂起 → 闹钟错过」
const KEEP_AWAKE_LEAD = 120000;

let intervalTimer = null;
let preciseTimer = null;
let keepAwake = false;
// 已排队待响的闹钟（多个提醒同时错过时依次响）
let pendingQueue = [];
// 超期未响、只做提示的提醒
let missed = [];

function advanceTrigger(trip) {
    return remind.triggerTime(trip);
}

/**
 * 正常到点判定（15 分钟窗口内）
 */
function dueEntries(trips, now) {
    const entries = [];
    trips.forEach((trip) => {
        if (trip.done) {
            return;
        }
        const trigger = advanceTrigger(trip);
        if (trigger < trip.startTime && trigger <= now && now < trip.startTime && !trip.notified) {
            entries.push({ trip: trip, phase: 'advance' });
            return;
        }
        if (trip.startTime <= now && now <= trip.startTime + LATE_WINDOW && !trip.startNotified) {
            entries.push({ trip: trip, phase: 'start' });
        }
    });
    return entries;
}

/**
 * 锁屏/切后台期间错过的提醒：触发时间落在 (since, now - LATE_WINDOW]，
 * 即已经超出 15 分钟补响窗口，但仍在 24 小时补响范围内
 */
function catchUpEntries(trips, since, now) {
    const entries = [];
    if (!since) {
        return entries;
    }
    const deadline = now - LATE_WINDOW;
    trips.forEach((trip) => {
        if (trip.done) {
            return;
        }
        const trigger = advanceTrigger(trip);
        if (!trip.notified && trigger < trip.startTime && trigger > since && trigger <= deadline) {
            entries.push({ trip: trip, phase: 'catchup', missedAt: trigger });
            return;
        }
        if (!trip.startNotified && trip.startTime > since && trip.startTime <= deadline) {
            entries.push({ trip: trip, phase: 'catchup_start', missedAt: trip.startTime });
        }
    });
    return entries;
}

/**
 * 彻底过期（早于上次前台时间，或超出 24 小时补响范围）：只记录，不再响
 */
function staleIds(trips, now, since) {
    return trips
        .filter((trip) => {
            if (trip.done) {
                return false;
            }
            const trigger = advanceTrigger(trip);
            // since 已经按 24 小时补响范围裁剪过：早于 since 就是「彻底过期」
            const advanceStale =
                !trip.notified && trigger < trip.startTime && trigger + LATE_WINDOW < now && (!since || trigger <= since);
            const startStale =
                !trip.startNotified && trip.startTime + LATE_WINDOW < now && (!since || trip.startTime <= since);
            return advanceStale || startStale;
        })
        .map((trip) => trip.id);
}

/**
 * 下一次闹钟应该在哪一刻响：取所有未处理行程里最近的触发时间
 */
function nextTriggerAt(trips, now) {
    let next = 0;
    trips.forEach((trip) => {
        if (trip.done || !trip.startTime) {
            return;
        }
        const trigger = advanceTrigger(trip);
        const candidates = [
            !trip.notified && trigger < trip.startTime && trigger > now ? trigger : 0,
            !trip.startNotified && trip.startTime > now ? trip.startTime : 0,
        ];
        candidates.forEach((value) => {
            if (value > now && (!next || value < next)) {
                next = value;
            }
        });
    });
    return next;
}

function buildContent(entry, now) {
    const trip = entry.trip;
    const head = dateUtil.timeText(trip.startTime) + ' · ' + trip.title;
    if (entry.phase === 'start') {
        const late = Math.round((now - trip.startTime) / 60000);
        return head + (late >= 1 ? '\n行程已开始 ' + dateUtil.minuteText(late) : '\n行程现在开始');
    }
    const remain = Math.round((trip.startTime - now) / 60000);
    return head + '\n还有 ' + dateUtil.minuteText(remain) + '开始';
}

function detailText(entry, now) {
    const trip = entry.trip;
    if (entry.phase === 'snooze') {
        return '稍后提醒 · ' + dateUtil.timeText(trip.startTime) + ' 的行程';
    }
    if (entry.phase === 'catchup' || entry.phase === 'catchup_start') {
        const late = Math.max(1, Math.round((now - (entry.missedAt || trip.startTime)) / 60000));
        return '锁屏期间错过 · 迟到 ' + dateUtil.minuteText(late);
    }
    if (entry.phase === 'start') {
        const late = Math.round((now - trip.startTime) / 60000);
        return late >= 1 ? '行程已开始 ' + dateUtil.minuteText(late) : '行程现在开始';
    }
    const remain = Math.round((trip.startTime - now) / 60000);
    return '还有 ' + dateUtil.minuteText(remain) + '开始';
}

function buildAlarmPayload(entry, entries, now) {
    const trip = entry.trip;
    const isCatchUp = entry.phase === 'catchup' || entry.phase === 'catchup_start';
    const lateMinutes =
        entry.phase === 'start'
            ? Math.max(0, Math.round((now - trip.startTime) / 60000))
            : isCatchUp
            ? Math.max(1, Math.round((now - (entry.missedAt || trip.startTime)) / 60000))
            : 0;
    return {
        id: trip.id,
        phase: isCatchUp ? 'catchup' : entry.phase,
        title: trip.title,
        note: trip.note || '',
        startTime: trip.startTime,
        timeText: dateUtil.timeText(trip.startTime),
        dateText: dateUtil.monthDayText(new Date(trip.startTime)),
        detail: detailText(entry, now),
        lateMinutes: lateMinutes,
        extra: Math.max(0, entries.length - 1),
        at: now,
    };
}

// 闹钟响起的同一时刻，尝试向微信服务通知推送一条订阅消息（未配置时静默跳过）
function pushSilently(payload) {
    if (!settings.getAlarm().push || !subscribe.isConfigured()) {
        return;
    }
    subscribe.pushNow(payload).then(() => {}).catch(() => {});
}

function flagIds(entries, phases) {
    return entries.filter((item) => phases.indexOf(item.phase) >= 0).map((item) => item.trip.id);
}

/**
 * 触发闹钟：先写标记避免重复响，再交给闹钟引擎开响
 * 已有闹钟在响时，其余提醒进入队列，用户处理完当前这条后依次响
 */
function fire(entries, now) {
    if (!entries.length) {
        return;
    }
    store.markNotifiedMany(flagIds(entries, ['advance', 'catchup']));
    store.markStartedMany(flagIds(entries, ['start', 'catchup_start']));

    const payloads = entries.map((entry, index) => buildAlarmPayload(entry, entries, now));
    alarm.clearSnooze(payloads[0].id);

    if (alarm.isRinging() || !alarm.ring(payloads[0])) {
        pendingQueue = pendingQueue.concat(payloads);
        return;
    }
    pendingQueue = pendingQueue.concat(payloads.slice(1));
    // 只对真正响出来的第一条做即时推送
    pushSilently(payloads[0]);
}

/**
 * 响完一条后接着响下一条（由闹钟页在关闭时调用）
 */
function nextAlarm() {
    if (!pendingQueue.length || alarm.isRinging()) {
        return false;
    }
    const payload = pendingQueue.shift();
    alarm.ring(payload);
    return true;
}

function hasPending() {
    return pendingQueue.length > 0;
}

/**
 * 临近响铃时保持屏幕常亮：屏幕自动熄灭会让小程序被挂起，闹钟就错过了
 */
function applyKeepAwake(next, now) {
    const should = !!next && next - now <= KEEP_AWAKE_LEAD;
    if (should === keepAwake) {
        return;
    }
    keepAwake = should;
    if (typeof wx !== 'undefined' && wx && typeof wx.setKeepScreenOn === 'function') {
        try {
            wx.setKeepScreenOn({ keepScreenOn: should });
        } catch (error) {
            // 个别环境不支持，忽略
        }
    }
}

function armPrecise(now) {
    if (preciseTimer) {
        clearTimeout(preciseTimer);
        preciseTimer = null;
    }
    const result = store.list();
    if (result.error) {
        return;
    }
    const next = nextTriggerAt(result.data, now);
    applyKeepAwake(next, now);
    if (!next) {
        return;
    }
    const delay = Math.max(0, Math.min(MAX_TIMEOUT, next - now));
    preciseTimer = setTimeout(() => {
        preciseTimer = null;
        check();
    }, delay);
}

function recordMissed(trips, ids) {
    ids.forEach((id) => {
        for (let i = 0; i < trips.length; i += 1) {
            if (trips[i].id === id) {
                missed.push({ id: id, title: trips[i].title, startTime: trips[i].startTime });
                break;
            }
        }
    });
    if (missed.length > 5) {
        missed = missed.slice(missed.length - 5);
    }
}

function runCheck(isResume) {
    const result = store.list();
    if (result.error) {
        return;
    }
    const now = Date.now();
    const lastActive = isResume ? activity.lastActive() : 0;
    const since = lastActive ? Math.max(lastActive, now - CATCH_UP_LIMIT) : 0;

    // 1) 锁屏期间错过、超出 15 分钟窗口但仍在 24 小时内的，解锁后立刻补响
    const catchUps = catchUpEntries(result.data, since, now);

    // 2) 彻底过期的只记录
    const stale = staleIds(result.data, now, since);
    if (stale.length) {
        recordMissed(result.data, stale);
        store.markAllNotifiedMany(stale);
    }

    // 3) 正常到点（15 分钟窗口内）
    const entries = dueEntries(result.data, now);
    if (entries.length) {
        fire(entries, now);
    }

    // 4) 补响：排在正常提醒之后，避免打断刚刚响起的闹钟
    if (catchUps.length && !alarm.isRinging()) {
        fire(catchUps, now);
    } else if (catchUps.length) {
        catchUps.forEach((entry) => pendingQueue.push(buildAlarmPayload(entry, catchUps, now)));
        store.markNotifiedMany(flagIds(catchUps, ['catchup']));
        store.markStartedMany(flagIds(catchUps, ['catchup_start']));
    }

    // 5) 稍后提醒（贪睡）到期
    const snoozed = alarm.dueSnoozes(now);
    if (snoozed.length && !alarm.isRinging()) {
        alarm.ring(
            Object.assign({}, snoozed[0], {
                phase: 'snooze',
                detail: '稍后提醒 · ' + dateUtil.timeText(snoozed[0].startTime) + ' 的行程',
                extra: Math.max(0, snoozed.length - 1),
                at: now,
            })
        );
    }

    armPrecise(now);
    activity.touch();
}

function check() {
    runCheck(false);
}

/**
 * 回到前台：先用上一次前台时间算出锁屏期间错过的提醒并补响，再恢复轮询
 */
function resume() {
    runCheck(true);
    activity.touch(true);
    if (!intervalTimer) {
        intervalTimer = setInterval(check, CHECK_INTERVAL);
    }
}

function start() {
    if (intervalTimer) {
        return;
    }
    check();
    intervalTimer = setInterval(check, CHECK_INTERVAL);
}

function stop() {
    if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
    }
    if (preciseTimer) {
        clearTimeout(preciseTimer);
        preciseTimer = null;
    }
    applyKeepAwake(0, 0);
    // 记住离开前台的时刻，回来后据此补响
    activity.touch(true);
}

function takeMissed() {
    const list = missed;
    missed = [];
    return list;
}

function init() {
    alarm.setRinging(false);
    pendingQueue = [];
    missed = [];
}

module.exports = {
    init: init,
    start: start,
    stop: stop,
    check: check,
    resume: resume,
    nextAlarm: nextAlarm,
    hasPending: hasPending,
    takeMissed: takeMissed,
    CHECK_INTERVAL: CHECK_INTERVAL,
    LATE_WINDOW: LATE_WINDOW,
    CATCH_UP_LIMIT: CATCH_UP_LIMIT,
    dueEntries: dueEntries,
    catchUpEntries: catchUpEntries,
    staleIds: staleIds,
    nextTriggerAt: nextTriggerAt,
    buildContent: buildContent,
};
