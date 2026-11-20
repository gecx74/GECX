/**
 * 系统日历通道测试（锁屏可靠提醒 + 一键授权写入）
 * 运行：node .workbuddy/tests/calendar.test.js
 */

const memory = {};
let calendarReply = null;
let authorizeReply = 'ok';
const authSetting = {};

global.wx = {
    getStorageSync(key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : '';
    },
    setStorageSync(key, value) {
        memory[key] = value;
    },
    getSetting(options) {
        options.success({ authSetting: Object.assign({}, authSetting) });
    },
    authorize(options) {
        if (authorizeReply === 'ok') {
            authSetting[options.scope] = true;
            options.success();
            return;
        }
        if (authorizeReply === 'deny') {
            authSetting[options.scope] = false;
        }
        options.fail({ errMsg: 'authorize:fail auth deny' });
    },
    openSetting(options) {
        options.success({ authSetting: Object.assign({}, authSetting) });
    },
    addPhoneCalendar(options) {
        if (calendarReply === 'deny') {
            options.fail({ errMsg: 'addPhoneCalendar:fail auth deny' });
            return;
        }
        if (calendarReply === 'cancel') {
            options.fail({ errMsg: 'addPhoneCalendar:fail cancel' });
            return;
        }
        if (calendarReply === 'privacy') {
            options.fail({ errMsg: 'addPhoneCalendar:fail api scope is not declared in the privacy agreement' });
            return;
        }
        options.success({ errMsg: 'addPhoneCalendar:ok' });
    },
};

const calendar = require('../../utils/calendar.js');
const settings = require('../../utils/settings.js');

let pass = 0;
let fail = 0;

function check(name, condition, extra) {
    if (condition) {
        pass += 1;
        console.log('PASS | ' + name);
    } else {
        fail += 1;
        console.log('FAIL | ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
    }
}

function resetWritten() {
    Object.keys(memory).forEach((key) => {
        if (key.indexOf('trip_reminder_calendar_written_') === 0) {
            delete memory[key];
        }
    });
}

async function main() {
    // 夹具必须相对当前时间：写死日期会随系统时间过期，提醒时刻已过的行程会被守卫拦下
    const futureAt15 = (daysAhead) => {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        d.setHours(15, 0, 0, 0);
        return d.getTime();
    };
    const startTime = futureAt15(2);
    const event = calendar.buildEvent({
        title: '总部会议',
        startTime: startTime,
        remindBefore: 10,
        note: 'A栋201',
    });

    check('事件时间 = 行程开始时间（与 App 显示一致）', event.startTime === Math.round(startTime / 1000), event.startTime);
    check('结束时间默认 1 小时', event.endTime === event.startTime + 3600, event.endTime);
    check('默认开启系统闹钟', event.alarm === true);
    check('提前量转成秒作闹钟偏移（官方单位为秒）', event.alarmOffset === 600, event.alarmOffset);
    check('标题保持行程原名', event.title === '总部会议', event.title);
    check('描述带备注与提醒时间', event.description.indexOf('A栋201') === 0 && event.description.indexOf('提醒时间：') > 0 && event.description.indexOf('提前 10 分钟') > 0, event.description);

    const noRemind = calendar.buildEvent({ title: '准时', startTime: startTime, remindBefore: 0 });
    check('准时提醒偏移为 0', noRemind.alarmOffset === 0, noRemind.alarmOffset);

    // 同源性：日历闹钟触发时刻（startTime - alarmOffset 秒）必须等于 App 内提醒触发时刻
    const remind = require('../../utils/remind.js');
    const calFireAt = (event.startTime - event.alarmOffset) * 1000;
    const appFireAt = remind.triggerTime({ startTime: startTime, remindBefore: 10 });
    check('日历触发时刻与 App 内提醒完全一致', calFireAt === appFireAt, calFireAt + ' vs ' + appFireAt);
    check('描述中写明提醒时刻供核对', event.description.indexOf('提醒时间：') > 0 && event.description.indexOf('提前 10 分钟') > 0, event.description);
    const dayRemind = calendar.buildEvent({ title: '一天', startTime: startTime, remindBefore: 1440 });
    const dayFireAt = (dayRemind.startTime - dayRemind.alarmOffset) * 1000;
    check('提前 1 天同样同源', dayFireAt === remind.triggerTime({ startTime: startTime, remindBefore: 1440 }), dayFireAt);

    check('可判断能力可用', calendar.canUse() === true);

    let result = await calendar.addTrip({ title: '总部会议', startTime: startTime, remindBefore: 10 });
    check('写入成功返回 ok', result.ok === true, result);

    calendarReply = 'deny';
    result = await calendar.addTrip({ title: '总部会议', startTime: startTime, remindBefore: 10 });
    check('拒绝授权返回 DENIED', result.ok === false && result.reason === 'DENIED', result);
    check('拒绝授权时提示去设置页', result.needSetting === true, result);

    calendarReply = 'cancel';
    result = await calendar.addTrip({ title: '总部会议', startTime: startTime, remindBefore: 10 });
    check('用户取消返回 CANCELED', result.ok === false && result.reason === 'CANCELED', result);

    result = await calendar.addTrip(null);
    check('缺参数返回 INVALID_PAYLOAD', result.ok === false && result.reason === 'INVALID_PAYLOAD', result);

    // 提醒时刻已过的行程不写入（如「提前 1 天」但行程就在 1 小时内）
    resetWritten();
    result = await calendar.addTrip({ title: '过期提醒', startTime: Date.now() + 3600000, remindBefore: 1440 });
    check('提醒时刻已过返回 REMIND_PASSED', result.ok === false && result.reason === 'REMIND_PASSED', result);

    calendarReply = 'privacy';
    result = await calendar.addTrip({ title: '总部会议', startTime: startTime, remindBefore: 10 });
    check('隐私协议未声明返回 PRIVACY', result.ok === false && result.reason === 'PRIVACY', result);
    calendarReply = null;

    // 不支持的环境
    const savedApi = wx.addPhoneCalendar;
    delete wx.addPhoneCalendar;
    check('无 API 时判定不可用', calendar.canUse() === false);
    result = await calendar.addTrip({ title: 'x', startTime: startTime });
    check('无 API 时返回 UNSUPPORTED', result.ok === false && result.reason === 'UNSUPPORTED', result);
    let unsupportedAuth = await calendar.requestAuth();
    check('无 API 时申请授权直接失败', unsupportedAuth.ok === false && unsupportedAuth.reason === 'UNSUPPORTED', unsupportedAuth);
    wx.addPhoneCalendar = savedApi;
    calendarReply = null;

    /* ---------- 授权状态机 ---------- */
    delete authSetting[calendar.SCOPE];
    let state = await calendar.getAuthState();
    check('未申请过时状态为 unknown', state.state === 'unknown', state);

    authorizeReply = 'ok';
    let auth = await calendar.requestAuth();
    check('首次授权成功', auth.ok === true && auth.state === 'granted', auth);
    state = await calendar.getAuthState();
    check('授权后状态为 granted', state.state === 'granted', state);
    auth = await calendar.requestAuth();
    check('已授权时再次调用直接通过', auth.ok === true, auth);

    // 以前拒绝过：微信不再弹窗，只能去设置页
    delete authSetting[calendar.SCOPE];
    authorizeReply = 'deny';
    auth = await calendar.requestAuth();
    check('拒绝后状态为 denied', auth.ok === false && auth.state === 'denied', auth);
    check('拒绝后提示去设置页', auth.needSetting === true, auth);

    // 设置页里手动打开开关
    authSetting[calendar.SCOPE] = true;
    const opened = await calendar.openSetting();
    check('设置页打开后可识别为已授权', opened.ok === true, opened);
    state = await calendar.getAuthState();
    check('设置页返回后状态为 granted', state.state === 'granted', state);
    delete authSetting[calendar.SCOPE];
    delete authSetting[calendar.SCOPE];

    /* ---------- 批量写入 ---------- */
    const now = Date.now();
    const trips = [
        { id: 'a', title: '明天的会', startTime: now + 3600000, remindBefore: 10 },
        { id: 'b', title: '后天的会', startTime: now + 2 * 3600000, remindBefore: 0 },
        { id: 'c', title: '已完成的', startTime: now + 3600000, done: true },
        { id: 'd', title: '已经开始的', startTime: now - 3600000 },
        { id: 'e', title: '没有时间' },
    ];

    resetWritten();
    let pending = calendar.pendingTrips(trips, { now: now });
    check('只挑未来、未完成、有时间的行程', pending.length === 2 && pending[0].id === 'a' && pending[1].id === 'b', pending.map((t) => t.id));

    calendarReply = null;
    let batch = await calendar.writeAll(trips, { now: now });
    check('批量写入全部成功', batch.ok === 2 && batch.failed === 0, batch);
    check('写入后登记到本地记录', !!calendar.getWritten().a && !!calendar.getWritten().b, calendar.getWritten());

    // 再点一次不应重复写入
    const before = Object.keys(calendar.getWritten()).length;
    batch = await calendar.writeAll(trips, { now: now });
    check('再点一次不会重复写入', batch.total === 0 && batch.ok === 0, batch);
    check('登记表数量不变', Object.keys(calendar.getWritten()).length === before, Object.keys(calendar.getWritten()));

    // 强制重写（改过时间）
    batch = await calendar.writeAll(trips, { now: now, force: true });
    check('强制模式可重写全部', batch.ok === 2, batch);

    // 授权被拒时批量写入立即停止，并提示去设置
    resetWritten();
    calendarReply = 'deny';
    batch = await calendar.writeAll(trips, { now: now });
    check('授权被拒时标记 denied', batch.denied === true, batch);
    check('授权被拒时提示去设置', batch.needSetting === true, batch);
    check('授权被拒时不继续逐条失败', batch.failed === 1, batch);
    calendarReply = null;

    resetWritten();
    calendarReply = 'privacy';
    batch = await calendar.writeAll(trips, { now: now });
    check('隐私拦截时标记 blocked', batch.blocked === true && batch.failed >= 1, batch);
    calendarReply = null;

    // 空列表不报错
    batch = await calendar.writeAll([], { now: now });
    check('没有待写行程时返回全 0', batch.total === 0 && batch.ok === 0 && batch.failed === 0, batch);

    /* ---------- 默认设置 ---------- */
    check('系统日历同步默认开启', settings.getAlarm().calendar === true, settings.getAlarm());
    settings.setAlarm({ calendar: false });
    check('可关闭系统日历同步', settings.getAlarm().calendar === false, settings.getAlarm());
    check('关闭后其他设置不受影响', settings.getAlarm().vibrate === true && settings.getAlarm().snoozeMinutes === 5);

    console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
}

main();
