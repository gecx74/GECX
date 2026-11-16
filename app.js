const store = require('./utils/store.js');
const reminder = require('./utils/reminder.js');
const subscribe = require('./utils/subscribe.js');

App({
    globalData: {
        appName: '行程提醒',
        // 当前待展示的闹钟数据，由 utils/alarm.js 写入、闹钟页读取
        pendingAlarm: null,
    },

    onLaunch() {
        store.removeSeedTrips();
        reminder.init();
    },

    onShow() {
        // resume 会先按「上次在前台的时刻」补响锁屏期间错过的提醒，再恢复轮询
        reminder.resume();
        // 锁屏/断网可能导致上次云端登记失败，回到前台顺手补登记一次（有 10 分钟节流）
        const result = store.list();
        if (!result.error) {
            subscribe.syncPending(result.data).then(() => {}).catch(() => {});
        }
    },

    onHide() {
        reminder.stop();
    },

    onError(error) {
        console.error('[app error]', error);
    },
});
