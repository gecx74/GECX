/**
 * 闹钟提醒回归测试（Node 环境，用内存桩替代 wx API）
 * 运行：node .workbuddy/tests/alarm.test.js
 */

const memory = {};
const calls = { navigate: [], modal: [], vibrateLong: 0, vibrateShort: 0, toast: [], keepScreenOn: null };

global.wx = {
    getStorageSync(key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : '';
    },
    setStorageSync(key, value) {
        memory[key] = value;
    },
    navigateTo(options) {
        calls.navigate.push(options.url);
    },
    reLaunch() {},
    showModal(options) {
        calls.modal.push(options);
    },
    showToast(options) {
        calls.toast.push(options.title);
    },
    vibrateLong() {
        calls.vibrateLong += 1;
    },
    vibrateShort() {
        calls.vibrateShort += 1;
    },
    setKeepScreenOn(options) {
        calls.keepScreenOn = options.keepScreenOn;
    },
};

const appStub = { globalData: { pendingAlarm: null } };
global.getApp = () => appStub;

const store = require('../../utils/store.js');
const settings = require('../../utils/settings.js');
const alarm = require('../../utils/alarm.js');
const reminder = require('../../utils/reminder.js');
const subscribe = require('../../utils/subscribe.js');

let pass = 0;
let fail = 0;

function check(name, condition, extra) {
    if (condition) {
        pass += 1;
        console.log('PASS | ' + name);
    } else {
        fail += 1;
        console.log('FAIL | ' + name + (extra ? ' | ' + JSON.stringify(extra) : ''));
    }
}

function resetRing() {
    alarm.setRinging(false);
    calls.navigate.length = 0;
}

/* ---------- 1. 默认参数 ---------- */
const defaults = settings.getAlarm();
check('默认开启振动', defaults.vibrate === true, defaults);
check('默认稍后提醒 5 分钟', defaults.snoozeMinutes === 5, defaults);
check('默认开启微信推送开关', defaults.push === true, defaults);
check('振动节拍默认 3 次一组', defaults.vibrateRounds === 3, defaults);

/* ---------- 2. 提前提醒：到点开响 ---------- */
const now = Date.now();
const advanceTrip = store.create({
    title: '总部会议',
    startTime: now + 10 * 60000 - 1000,
    remindBefore: 10,
    category: 'work',
});
check('行程创建成功', !advanceTrip.error, advanceTrip.error);

reminder.check();
check('提前提醒触发闹钟页', calls.navigate[0] === '/pages/alarm/alarm', calls.navigate);
let saved = store.getById(advanceTrip.data.id).data;
check('提前提醒标记已写回', saved.notified === true && saved.startNotified === false, saved);
check('闹钟数据带标题与时间', (getApp().globalData.pendingAlarm || {}).title === '总部会议', getApp().globalData.pendingAlarm);

resetRing();
reminder.check();
check('同一阶段不重复响铃', calls.navigate.length === 0, calls.navigate);

/* ---------- 3. 到点提醒 ---------- */
const startTrip = store.create({
    title: '出发去机场',
    startTime: Date.now() - 1000,
    remindBefore: 0,
    category: 'life',
});
reminder.check();
check('到点提醒触发闹钟页', calls.navigate[0] === '/pages/alarm/alarm', calls.navigate);
const payload = getApp().globalData.pendingAlarm || {};
check('到点文案为「行程现在开始」', payload.detail === '行程现在开始', payload.detail);
saved = store.getById(startTrip.data.id).data;
check('到点标记已写回', saved.startNotified === true, saved);

/* ---------- 4. 过期不再打扰 ---------- */
const staleTrip = store.create({
    title: '已结束的行程',
    startTime: Date.now() - 20 * 60000,
    remindBefore: 10,
    category: 'work',
});
resetRing();
reminder.check();
saved = store.getById(staleTrip.data.id).data;
check('超过 15 分钟直接标记为已处理', saved.notified === true && saved.startNotified === true, saved);
check('过期行程不响铃', calls.navigate.length === 0, calls.navigate);

/* ---------- 5. 稍后提醒（贪睡） ---------- */
const snoozePayload = {
    id: 't_snooze_demo',
    title: '客户拜访',
    startTime: Date.now() + 30 * 60000,
    timeText: '15:00',
    dateText: '11月17日',
    phase: 'advance',
    detail: '还有 10 分钟开始',
    at: Date.now(),
};
alarm.snooze(snoozePayload, 5);
check('贪睡 4 分钟内不响', alarm.dueSnoozes(Date.now() + 4 * 60000).length === 0, alarm.dueSnoozes(Date.now() + 4 * 60000));
const dueList = alarm.dueSnoozes(Date.now() + 5 * 60000);
check('贪睡 5 分钟到期', dueList.length === 1, dueList);
check('贪睡记录保留原行程信息', dueList[0].phase === 'snooze' && dueList[0].title === '客户拜访', dueList[0]);

/* ---------- 6. 下一次触发时间 ---------- */
const future = Date.now() + 3600000;
const trips = [
    { id: 'a', startTime: future, remindBefore: 10, done: false, notified: false, startNotified: false },
    { id: 'b', startTime: future + 60000, remindBefore: 0, done: false, notified: false, startNotified: false },
];
check('下次触发取最近的提前提醒时刻', reminder.nextTriggerAt(trips, Date.now()) === future - 10 * 60000, reminder.nextTriggerAt(trips, Date.now()));

/* ---------- 7. 订阅消息内容格式 ---------- */
check('未配置模板时推送不可用', subscribe.isConfigured() === false, subscribe.isConfigured());
const message = subscribe.buildMessage({
    title: '总部会议',
    startTime: new Date(2026, 10, 17, 15, 0).getTime(),
    detail: '还有 10 分钟开始',
    note: 'A栋201',
});
check('时间格式为「2026年11月17日 15:00」', message.time2.value === '2026年11月17日 15:00', message.time2);
check('标题字段映射 thing1', message.thing1.value === '总部会议', message.thing1);
check('说明字段映射 thing3', message.thing3.value === '还有 10 分钟开始', message.thing3);
check('备注字段映射 thing4', message.thing4.value === 'A栋201', message.thing4);
const longTitle = subscribe.buildMessage({ title: '一二三四五六七八九十一二三四五六七八九十超出', startTime: Date.now() });
check('超长标题截断到 20 字', longTitle.thing1.value.length <= 20, longTitle.thing1.value);

/* ---------- 8. 关闭振动后不再振动 ---------- */
settings.setAlarm({ vibrate: false });
check('关闭振动后设置生效', settings.getAlarm().vibrate === false, settings.getAlarm());
const loop = alarm.startVibrateLoop();
loop.stop();
check('关闭振动时启动循环不报错', true);

/* ---------- 9. 锁屏期间错过：解锁后补响 ---------- */
const THREE_HOURS = 3 * 3600000;
// 模拟：用户 3 小时前离开小程序（锁屏），期间有 1 个提醒应该在 2 小时前响
memory['trip_reminder_active_v1'] = Date.now() - THREE_HOURS;
const missedTrip = store.create({
    title: '锁屏时错过的评审',
    startTime: Date.now() - 2 * 3600000,
    remindBefore: 10,
    category: 'work',
});
alarm.setRinging(false);
calls.navigate.length = 0;
reminder.resume();
const catchPayload = getApp().globalData.pendingAlarm || {};
check('解锁后立刻补响锁屏错过的提醒', calls.navigate[0] === '/pages/alarm/alarm', calls.navigate);
check('补响标记为 catchup 阶段', catchPayload.phase === 'catchup', catchPayload.phase);
check('补响文案含迟到分钟数', /迟到 \d+/.test(String(catchPayload.detail)), catchPayload.detail);
saved = store.getById(missedTrip.data.id).data;
check('补响后标记已处理', saved.notified === true, saved);

/* ---------- 10. 多个错过依次响 ---------- */
memory['trip_reminder_active_v1'] = Date.now() - THREE_HOURS;
alarm.setRinging(false);
const second = store.create({
    title: '锁屏时错过的第二个会',
    startTime: Date.now() - 100 * 60000,
    remindBefore: 0,
    category: 'work',
});
calls.navigate.length = 0;
reminder.resume();
check('先响第一条', calls.navigate.length === 1, calls.navigate);
check('其余提醒进入队列', reminder.hasPending() === true);
alarm.setRinging(false);
reminder.nextAlarm();
check('处理完第一条后自动响下一条', calls.navigate.length === 2, calls.navigate);

/* ---------- 11. 超过 24 小时只提示不再响 ---------- */
memory['trip_reminder_active_v1'] = Date.now() - 3 * 86400000;
alarm.setRinging(false);
const ancient = store.create({
    title: '两天前的会',
    startTime: Date.now() - 2 * 86400000,
    remindBefore: 0,
    category: 'work',
});
calls.navigate.length = 0;
reminder.takeMissed();
reminder.resume();
check('超过 24 小时不再补响', calls.navigate.length === 0, calls.navigate);
check('超期提醒进入错过清单', reminder.takeMissed().some((item) => item.title === '两天前的会'));
check('超期提醒标记为已处理', store.getById(ancient.data.id).data.startNotified === true);

/* ---------- 12. 临近响铃保持屏幕常亮 ---------- */
alarm.setRinging(false);
store.create({
    title: '两分钟后开会',
    startTime: Date.now() + 60000,
    remindBefore: 0,
    category: 'work',
});
calls.keepScreenOn = null;
reminder.check();
check('临近响铃会自动保持屏幕常亮', calls.keepScreenOn === true, calls.keepScreenOn);

reminder.stop();
check('停止轮询后释放常亮', calls.keepScreenOn === false, calls.keepScreenOn);

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
