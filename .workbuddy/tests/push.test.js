/**
 * 锁屏提醒（订阅消息）回归测试
 * 运行：node .workbuddy/tests/push.test.js
 */

const memory = {};
const cloudCalls = [];
const nav = [];
let subscribeReply = {};

global.wx = {
    getStorageSync(key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : '';
    },
    setStorageSync(key, value) {
        memory[key] = value;
    },
    removeStorageSync(key) {
        delete memory[key];
    },
    navigateTo(options) {
        nav.push(options.url);
    },
    reLaunch() {},
    showModal() {},
    showToast() {},
    vibrateLong() {},
    vibrateShort() {},
    requestSubscribeMessage(options) {
        options.success(subscribeReply);
    },
    cloud: {
        init() {},
        callFunction(options) {
            cloudCalls.push({ name: options.name, data: options.data });
            options.success({ result: { ok: true } });
        },
    },
};

const appStub = { globalData: { pendingAlarm: null } };
global.getApp = () => appStub;

// 先注入配置，再加载依赖它的模块
const config = require('../../utils/push-config.js');
config.templateIds = ['tmplA', 'tmplB', 'tmplC', 'tmplD'];
config.cloudEnv = 'env-test';

const pushConfigCheck = require('../../utils/push-config.js');

const subscribe = require('../../utils/subscribe.js');
const settings = require('../../utils/settings.js');
const store = require('../../utils/store.js');
const reminder = require('../../utils/reminder.js');

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

function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
    /* ---------- 配置 ---------- */
    check('模板列表最多取 3 个', subscribe.templates().length === 3, subscribe.templates());
    check('重复模板去重', subscribe.templates().indexOf('tmplA') === 0, subscribe.templates());
    check('已配置可判定', subscribe.isConfigured() === true);
    check('同一配置对象可复用', pushConfigCheck.templateIds.length === 4);

    /* ---------- 授权 ---------- */
    subscribeReply = { tmplA: 'accept', tmplB: 'reject', tmplC: 'reject' };
    let result = await subscribe.request();
    check('部分授权也算成功', result.ok === true, result);
    check('只记录被同意的模板', result.accepted.length === 1 && result.accepted[0] === 'tmplA', result.accepted);
    check('授权次数累加为 1', subscribe.diagnose().acceptedCount === 1, subscribe.diagnose());

    subscribeReply = { tmplA: 'accept', tmplB: 'accept', tmplC: 'accept' };
    result = await subscribe.request();
    check('全部同意时累计 4 次', subscribe.diagnose().acceptedCount === 4, subscribe.diagnose());

    subscribeReply = { tmplA: 'reject', tmplB: 'reject', tmplC: 'reject' };
    result = await subscribe.request();
    check('全部拒绝返回失败', result.ok === false && result.reason === 'REJECTED', result);

    /* ---------- 消息内容 ---------- */
    const msg = subscribe.buildMessage({
        title: '总部会议',
        startTime: new Date(2026, 10, 17, 15, 0).getTime(),
        detail: '还有 10 分钟开始',
        note: 'A栋201',
    });
    check('时间字段格式正确', msg.time2.value === '2026年11月17日 15:00', msg.time2);
    check('标题字段正确', msg.thing1.value === '总部会议', msg.thing1);
    check('说明字段正确', msg.thing3.value === '还有 10 分钟开始', msg.thing3);

    /* ---------- 登记与补登记 ---------- */
    const now = Date.now();
    settings.setAlarm({ push: true });
    const trip = store.create({ title: '客户拜访', startTime: now + 2 * 3600000, remindBefore: 10, category: 'work' });
    cloudCalls.length = 0;
    await subscribe.schedule(trip.data, '还有 10 分钟开始');
    check('登记动作发到云函数 schedule', cloudCalls[0] && cloudCalls[0].data.action === 'schedule', cloudCalls[0]);

    memory['trip_reminder_push_sync_v1'] = 0;
    const sync1 = await subscribe.syncPending(store.list().data);
    check('首次补登记会执行', sync1.ok === true && sync1.count >= 1, sync1);
    const sync2 = await subscribe.syncPending(store.list().data);
    check('10 分钟内第二次补登记被节流', sync2.reason === 'THROTTLED', sync2);
    const sync3 = await subscribe.syncPending(store.list().data, true);
    check('force 可跳过节流', sync3.ok === true && sync3.reason !== 'THROTTLED', sync3);

    /* ---------- 锁屏错过提醒的记账 ---------- */
    const oldTrip = store.create({ title: '锁屏时错过的会', startTime: Date.now() - 40 * 60000, remindBefore: 10, category: 'work' });
    reminder.check();
    const missed = reminder.takeMissed();
    check('超过补响窗口的提醒进入错过清单', missed.length >= 1, missed);
    check('错过清单带标题', missed.some((item) => item.title === '锁屏时错过的会'), missed);
    check('错过清单取走后清空', reminder.takeMissed().length === 0);
    const savedOld = store.getById(oldTrip.data.id).data;
    check('错过提醒被标记为已处理', savedOld.notified === true && savedOld.startNotified === true, savedOld);

    /* ---------- 诊断 ---------- */
    const info = subscribe.diagnose();
    check('诊断显示已配置', info.configured === true, info);
    check('诊断显示模板数量', info.templateCount === 3, info);
    check('诊断显示云环境可用', info.cloudReady === true, info);

    reminder.stop();
    console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
}

main();
