const alarm = require('../../utils/alarm.js');
const dateUtil = require('../../utils/date.js');
const settings = require('../../utils/settings.js');
const reminder = require('../../utils/reminder.js');

Page({
    data: {
        ready: false,
        payload: null,
        clock: '',
        clockDate: '',
        phaseLabel: '行程提醒',
        detail: '',
        extraText: '',
        vibrateOn: true,
        snoozeMinutes: 5,
        snoozeText: '稍后 5 分钟',
        ringing: true,
        fontScale: settings.DEFAULT_FONT_SCALE,
        fontStyle: settings.DEFAULT_FONT_STYLE,
    },

    onLoad() {
        const app = getApp();
        const payload = (app && app.globalData && app.globalData.pendingAlarm) || null;
        if (!payload) {
            wx.navigateBack({
                fail() {
                    wx.reLaunch({ url: '/pages/index/index' });
                },
            });
            return;
        }
        const options = alarm.getOptions();
        const phaseLabel =
            payload.phase === 'start'
                ? '行程开始'
                : payload.phase === 'snooze'
                ? '稍后提醒'
                : payload.phase === 'catchup'
                ? '锁屏补响'
                : '行程提醒';
        this.setData({
            ready: true,
            payload: payload,
            phaseLabel: phaseLabel,
            detail:
                payload.phase === 'catchup' && payload.lateMinutes
                    ? '锁屏期间错过 · 迟到 ' + payload.lateMinutes + ' 分钟'
                    : payload.detail || '',
            extraText: payload.extra ? '另有 ' + payload.extra + ' 个行程也到时间了' : '',
            vibrateOn: options.vibrate,
            snoozeMinutes: options.snoozeMinutes,
            snoozeText: '稍后 ' + options.snoozeMinutes + ' 分钟',
            clock: dateUtil.timeText(Date.now()),
            clockDate: dateUtil.monthDayText(new Date()) + ' ' + this.weekdayText(new Date()),
            fontScale: settings.getFontScale(),
            fontStyle: settings.getFontStyle(),
        });
        this.tickClock();
        this.clockTimer = setInterval(() => this.tickClock(), 1000);
        this.startRinging();
        if (typeof wx.setKeepScreenOn === 'function') {
            wx.setKeepScreenOn({ keepScreenOn: true });
        }
    },

    onUnload() {
        this.stopRinging();
        if (this.clockTimer) {
            clearInterval(this.clockTimer);
            this.clockTimer = null;
        }
        if (typeof wx.setKeepScreenOn === 'function') {
            wx.setKeepScreenOn({ keepScreenOn: false });
        }
        alarm.setRinging(false);
        const app = getApp();
        if (app && app.globalData) {
            app.globalData.pendingAlarm = null;
        }
    },

    weekdayText(date) {
        const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return names[date.getDay()];
    },

    tickClock() {
        const now = new Date();
        this.setData({ clock: dateUtil.timeText(now.getTime()) });
    },

    // 默认开启振动：长振动 3 次一组，间歇后继续，最长 5 分钟
    startRinging() {
        const options = alarm.getOptions();
        this.vibrator = alarm.startVibrateLoop();
        // 振动到最长时长自动停振后，界面上的抖动动画也停下，但闹钟仍留在页面上等你处理
        this.ringStopTimer = setTimeout(() => {
            this.setData({ ringing: false });
        }, options.maxRingMs);
    },

    stopRinging() {
        if (this.ringStopTimer) {
            clearTimeout(this.ringStopTimer);
            this.ringStopTimer = null;
        }
        if (this.vibrator) {
            this.vibrator.stop();
            this.vibrator = null;
        }
        this.setData({ ringing: false });
    },

    onSnooze() {
        const payload = this.data.payload;
        this.stopRinging();
        if (payload) {
            alarm.snooze(payload, this.data.snoozeMinutes);
        }
        wx.showToast({ title: this.data.snoozeText + '再响', icon: 'none', duration: 1200 });
        setTimeout(() => this.leave(), 300);
    },

    onDismiss() {
        this.stopRinging();
        this.leave();
    },

    onOpenTrip() {
        const payload = this.data.payload;
        this.stopRinging();
        if (!payload || !payload.id) {
            this.leave();
            return;
        }
        wx.redirectTo({
            url: '/pages/edit/edit?id=' + payload.id,
            fail() {
                wx.reLaunch({ url: '/pages/index/index' });
            },
        });
    },

    leave() {
        wx.navigateBack({
            fail() {
                wx.reLaunch({ url: '/pages/index/index' });
            },
        });
        // 还有排队的提醒（如锁屏期间错过多个）时，关掉这条后自动响下一条
        setTimeout(() => {
            if (reminder.hasPending()) {
                reminder.nextAlarm();
            }
        }, 700);
    },
});
