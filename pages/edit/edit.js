const store = require('../../utils/store.js');
const dateUtil = require('../../utils/date.js');
const remind = require('../../utils/remind.js');
const categories = require('../../utils/categories.js');
const titleOptions = require('../../utils/title-options.js');
const customTitles = require('../../utils/custom-titles.js');
const parser = require('../../utils/parser.js');
const ocr = require('../../utils/ocr.js');
const settings = require('../../utils/settings.js');
const subscribe = require('../../utils/subscribe.js');
const calendar = require('../../utils/calendar.js');
const sync = require('../../utils/sync.js');

function nextSlot() {
    const now = new Date();
    const minutes = now.getMinutes();
    let add = 30 - (minutes % 30);
    if (add === 0) {
        add = 30;
    }
    const target = new Date(now.getTime() + add * 60000);
    target.setSeconds(0, 0);
    return target;
}

function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

// 月份列：当前月前推 12 个月、后推 24 个月
const MONTH_START_OFFSET = -12;
const MONTH_END_OFFSET = 24;

function buildMonthOptions() {
    const now = new Date();
    const list = [];
    for (let offset = MONTH_START_OFFSET; offset <= MONTH_END_OFFSET; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        list.push({
            key: d.getFullYear() + '-' + pad2(d.getMonth() + 1),
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            label: d.getFullYear() + '年' + (d.getMonth() + 1) + '月',
        });
    }
    return list;
}

// 日期列：每天一项，标签里直接带星期几
function buildDayOptions(year, month, todayKey) {
    const total = new Date(year, month, 0).getDate();
    const list = [];
    for (let day = 1; day <= total; day++) {
        const date = new Date(year, month - 1, day);
        const key = year + '-' + pad2(month) + '-' + pad2(day);
        const weekday = dateUtil.WEEKDAY_CN[date.getDay()];
        list.push({
            key: key,
            label: day + '日 · ' + weekday + (key === todayKey ? '（今天）' : ''),
        });
    }
    return list;
}

Page({
    data: {
        isEdit: false,
        title: '',
        titleOptions: [],
        customCount: 0,
        titleSheetOpen: false,
        customInputOpen: false,
        customDraft: '',
        note: '',
        category: categories.DEFAULT_CATEGORY,
        categoryColor: categories.categoryOf(categories.DEFAULT_CATEGORY).color,
        date: '',
        time: '',
        dateLabel: '',
        dateWeekday: '',
        timeHint: '',
        dateRanges: [[], []],
        dateIndexes: [0, 0],
        scanText: '',
        scanImagePath: '',
        remindIndex: remind.indexOfValue(remind.DEFAULT_REMIND),
        remindLabels: [],
        categories: [],
        previewText: '',
        previewSub: '',
        errorText: '',
        saving: false,
        fontScale: settings.DEFAULT_FONT_SCALE,
        fontStyle: settings.DEFAULT_FONT_STYLE,
        voiceState: 'idle',
        voicePartial: '',
        // 语音输入开关：微信同声传译插件在后台授权通过后，改 true 并在 app.json 加回 plugins 即可启用
        voiceEnabled: false,
    },

    onLoad(options) {
        if (this.data.voiceEnabled) {
            this.initVoice();
        }
        this.setData({ fontScale: settings.getFontScale(), fontStyle: settings.getFontStyle() });
        this.refreshTitleOptions();
        const remindLabels = remind.REMIND_OPTIONS.map((item) => item.label);
        const categoryList = categories.CATEGORIES.map((item) => ({
            key: item.key,
            label: item.label,
            color: item.color,
            bg: item.bg,
        }));
        this.setData({ remindLabels: remindLabels, categories: categoryList });

        const id = options && options.id;
        if (id) {
            this.loadTrip(id);
            return;
        }
        const slot = nextSlot();
        const todayKey = dateUtil.toKey(new Date());
        const pickedDate = options && /^\d{4}-\d{2}-\d{2}$/.test(String(options.date || '')) ? options.date : '';
        const dateKey = pickedDate || dateUtil.toKey(slot);
        this.setData({
            isEdit: false,
            date: dateKey,
            time: dateKey === todayKey ? dateUtil.timeText(slot.getTime()) : '09:00',
        });
        wx.setNavigationBarTitle({ title: '行程提醒' });
        this.buildPreview();
    },

    loadTrip(id) {
        const result = store.getById(id);
        if (result.error) {
            wx.showToast({ title: '行程不存在或已删除', icon: 'none' });
            setTimeout(() => {
                wx.navigateBack({ delta: 1 });
            }, 900);
            return;
        }
        const trip = result.data;
        const start = new Date(trip.startTime);
        this.tripId = trip.id;
        // 记住原始开始时间与提前提醒档位：任一变化都要重写日历事件，没改就跳过避免重复
        this.originalStart = trip.startTime;
        this.originalRemind = Number(trip.remindBefore) || 0;
        this.setData({
            isEdit: true,
            title: trip.title,
            note: trip.note,
            category: trip.category,
            categoryColor: categories.categoryOf(trip.category).color,
            date: dateUtil.toKey(start),
            time: dateUtil.timeText(trip.startTime),
            remindIndex: remind.indexOfValue(trip.remindBefore),
        });
        wx.setNavigationBarTitle({ title: '行程提醒' });
        this.buildPreview();
    },

    computeStartTime() {
        const parts = String(this.data.time || '').split(':');
        if (parts.length !== 2) {
            return 0;
        }
        const date = dateUtil.parseKey(this.data.date);
        const hour = Number(parts[0]);
        const minute = Number(parts[1]);
        if (!isFinite(hour) || !isFinite(minute)) {
            return 0;
        }
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();
    },

    buildPreview() {
        const date = dateUtil.parseKey(this.data.date);
        const startTime = this.computeStartTime();
        if (!startTime) {
            this.setData({ previewText: '请选择行程日期与时间', previewSub: '' });
            return;
        }
        const option = remind.REMIND_OPTIONS[this.data.remindIndex] || remind.REMIND_OPTIONS[0];
        const trigger = startTime - option.value * 60000;
        const triggerDate = new Date(trigger);
        const sameDay = dateUtil.toKey(triggerDate) === dateUtil.toKey(new Date());

        let previewText = '';
        if (trigger <= Date.now()) {
            previewText = '提醒时间已过，保存后不会再提醒';
        } else if (sameDay) {
            previewText = '将在今天 ' + dateUtil.timeText(trigger) + ' 提醒你';
        } else {
            previewText = '将在 ' + dateUtil.monthDayText(triggerDate) + ' ' + dateUtil.timeText(trigger) + ' 提醒你';
        }

        const todayKey = dateUtil.toKey(new Date());
        const dateKey = dateUtil.toKey(date);
        const weekday = dateUtil.WEEKDAY_CN[date.getDay()];
        let dateText = dateUtil.monthDayText(date);
        let weekdayText = weekday;
        const diff = dateUtil.dayDiff(date, new Date());
        if (dateKey === todayKey) {
            dateText = '今天';
            weekdayText = weekday;
        } else if (diff === 1) {
            dateText = '明天';
            weekdayText = weekday;
        } else if (diff === 2) {
            dateText = '后天';
            weekdayText = weekday;
        } else if (diff > 0) {
            weekdayText = weekday + ' · 还有 ' + diff + ' 天';
        } else if (diff < 0) {
            weekdayText = weekday + ' · 已过去 ' + Math.abs(diff) + ' 天';
        }

        const hour = new Date(startTime).getHours();
        let timeHint = '上午';
        if (hour < 6) {
            timeHint = '凌晨';
        } else if (hour < 12) {
            timeHint = '上午';
        } else if (hour < 14) {
            timeHint = '中午';
        } else if (hour < 18) {
            timeHint = '下午';
        } else {
            timeHint = '晚上';
        }

        this.setData({
            dateLabel: dateText,
            dateWeekday: weekdayText,
            timeHint: timeHint,
            previewText: previewText,
            previewSub: (option.value ? option.label : '准时提醒') + ' · ' + weekday + ' ' + dateUtil.timeText(startTime) + ' 开始',
        });
        this.syncDateWheel();
    },

    // 让滚轮的选中位置与当前日期保持一致（月列 + 带星期几的日列）
    syncDateWheel() {
        this.monthOptions = buildMonthOptions();
        const monthLabels = this.monthOptions.map((item) => item.label);
        const dateKey = String(this.data.date || '');
        let monthIndex = this.monthOptions.map((item) => item.key).indexOf(dateKey.slice(0, 7));
        let dayNumber = Number(dateKey.slice(8, 10)) || new Date().getDate();
        if (monthIndex < 0) {
            monthIndex = MONTH_START_OFFSET === 0 ? 0 : 12;
            dayNumber = new Date().getDate();
        }
        const month = this.monthOptions[monthIndex];
        const todayKey = dateUtil.toKey(new Date());
        this.dayOptions = buildDayOptions(month.year, month.month, todayKey);
        let dayIndex = this.dayOptions.map((item) => Number(item.key.slice(8, 10))).indexOf(dayNumber);
        if (dayIndex < 0) {
            dayIndex = 0;
        }
        this.setData({
            dateRanges: [monthLabels, this.dayOptions.map((item) => item.label)],
            dateIndexes: [monthIndex, dayIndex],
        });
    },

    initVoice() {
        this.voiceManager = null;
        this.voiceAvailable = false;
        let plugin = null;
        try {
            if (typeof requirePlugin === 'function') {
                plugin = requirePlugin('WechatSI');
            }
        } catch (error) {
            plugin = null;
        }
        if (!plugin || typeof plugin.getRecordRecognitionManager !== 'function') {
            return;
        }
        this.voiceAvailable = true;
        const manager = plugin.getRecordRecognitionManager();
        manager.onStart(() => {
            this.setData({ voiceState: 'recording', voicePartial: '' });
        });
        manager.onRecognize((res) => {
            if (res && res.result) {
                this.setData({ voicePartial: String(res.result) });
            }
        });
        manager.onStop((res) => {
            this.setData({ voiceState: 'idle', voicePartial: '' });
            const text = res && res.result ? String(res.result).trim() : '';
            if (!text) {
                wx.showToast({ title: '没有听清，再试一次', icon: 'none' });
                return;
            }
            this.applyVoiceText(text);
        });
        manager.onError((res) => {
            this.setData({ voiceState: 'idle', voicePartial: '' });
            wx.showToast({ title: (res && res.msg) || '语音识别失败', icon: 'none' });
        });
        manager.onEnd(() => {
            if (this.data.voiceState !== 'idle') {
                this.setData({ voiceState: 'idle' });
            }
        });
        this.voiceManager = manager;
    },

    toggleVoice() {
        if (this.data.saving) {
            return;
        }
        if (!this.voiceAvailable) {
            wx.showToast({ title: '语音功能需在后台添加「微信同声传译」插件', icon: 'none', duration: 2500 });
            return;
        }
        if (this.data.voiceState === 'recording') {
            this.voiceManager.stop();
            return;
        }
        this.voiceManager.start({ lang: 'zh_CN', duration: 60000 });
    },

    applyVoiceText(text) {
        const clean = String(text).replace(/\s+/g, ' ').trim();
        if (!clean) {
            return;
        }
        const current = String(this.data.title || '').trim();
        let next = current ? current + ' ' + clean : clean;
        if (next.length > 40) {
            next = next.slice(0, 40);
        }
        this.setData({ title: next, errorText: '' });
    },

    stopVoiceIfRecording() {
        if (this.voiceAvailable && this.data.voiceState === 'recording' && this.voiceManager) {
            this.voiceManager.stop();
        }
    },

    onHide() {
        this.stopVoiceIfRecording();
    },

    onUnload() {
        this.stopVoiceIfRecording();
    },

    onTitleInput(event) {
        this.setData({ title: event.detail.value, errorText: '' });
    },

    onNoteInput(event) {
        this.setData({ note: event.detail.value });
    },

    // ===== 识别填充 =====
    onScanInput(event) {
        this.setData({ scanText: event.detail.value });
    },

    // 扫描入口：选一张行程截图 / 通知截图，展示出来配合微信「提取文字」完成识别
    scanImage() {
        ocr.pickScreenshot().then((result) => {
            if (!result.ok) {
                return; // 用户取消选图，不打扰
            }
            this.setData({ scanImagePath: result.imagePath });
            wx.showToast({
                title: '长按截图选「提取文字」并复制',
                icon: 'none',
                duration: 3000,
            });
        });
    },

    // 放大查看选中的截图（微信大图页同样支持长按「提取文字」）
    previewScanImage() {
        if (!this.data.scanImagePath) {
            return;
        }
        wx.previewImage({ urls: [this.data.scanImagePath] });
    },

    // 读取剪贴板里复制的提取文字，解析后填充表单
    parseFromClipboard() {
        wx.getClipboardData({
            success: (res) => {
                const text = String(res.data || '').trim();
                if (!text) {
                    wx.showToast({
                        title: '剪贴板是空的，请先长按截图提取文字并复制',
                        icon: 'none',
                        duration: 2800,
                    });
                    return;
                }
                this.setData({ scanText: text.slice(0, 500) });
                this.applyParsedText(text);
            },
            fail: () => {
                wx.showToast({
                    title: '读取剪贴板未授权，可长按输入框粘贴后点识别填充',
                    icon: 'none',
                    duration: 2800,
                });
            },
        });
    },

    // 识别描述文字并填充表单：输入框有内容优先用输入框，否则读剪贴板
    parseFromText() {
        const text = String(this.data.scanText || '').trim();
        if (!text) {
            this.parseFromClipboard();
            return;
        }
        this.applyParsedText(text);
    },

    // 把文本解析结果填进表单：标题 / 备注只在为空时填充，日期时间以识别为准
    applyParsedText(text) {
        const parsed = parser.parse(text);
        if (!parsed.matched) {
            wx.showToast({ title: '未能识别出有效信息，请手动填写', icon: 'none', duration: 2500 });
            return false;
        }
        const patch = { errorText: '' };
        if (parsed.title && !String(this.data.title || '').trim()) {
            patch.title = parsed.title;
        }
        if (parsed.date) {
            patch.date = parsed.date;
        }
        if (parsed.time) {
            patch.time = parsed.time;
        }
        if (parsed.note && !String(this.data.note || '').trim()) {
            patch.note = parsed.note;
        }
        // 没有任何字段被实际填充，视为识别失败，引导手动填写
        if (Object.keys(patch).length <= 1) {
            wx.showToast({ title: '未能识别出新信息，可手动填写或修改', icon: 'none', duration: 2500 });
            return false;
        }
        this.setData(patch);
        this.buildPreview();
        wx.showToast({ title: '已填充，可继续修改', icon: 'success', duration: 1200 });
        return true;
    },

    selectRemind(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (!isFinite(index) || index < 0 || index >= remind.REMIND_OPTIONS.length) {
            return;
        }
        this.setData({ remindIndex: index });
        this.buildPreview();
    },

    openTitleSheet() {
        if (this.data.saving) {
            return;
        }
        this.refreshTitleOptions();
        this.setData({ titleSheetOpen: true, customInputOpen: false, customDraft: '' });
    },

    closeTitleSheet() {
        this.setData({ titleSheetOpen: false, customInputOpen: false });
    },

    // 自定义标题在前，内置标题在后
    refreshTitleOptions() {
        const custom = customTitles.list();
        const options = custom.map((text) => ({ text: text, custom: true }));
        titleOptions.TITLE_OPTIONS.forEach((text) => {
            options.push({ text: text, custom: false });
        });
        this.setData({ titleOptions: options, customCount: custom.length });
    },

    openCustomInput() {
        this.setData({ customInputOpen: true, customDraft: '' });
    },

    cancelCustom() {
        this.setData({ customInputOpen: false, customDraft: '' });
    },

    onCustomInput(event) {
        this.setData({ customDraft: event.detail.value });
    },

    confirmCustom() {
        const result = customTitles.add(this.data.customDraft, titleOptions.TITLE_OPTIONS);
        if (result === null) {
            wx.showToast({ title: '请先输入标题内容', icon: 'none' });
            return;
        }
        if (result === 'dup') {
            wx.showToast({ title: '这个标题已经有了', icon: 'none' });
            return;
        }
        this.refreshTitleOptions();
        this.setData({
            title: result[0],
            titleSheetOpen: false,
            customInputOpen: false,
            customDraft: '',
            errorText: '',
        });
        wx.showToast({ title: '已添加', icon: 'success', duration: 600 });
    },

    removeCustomOption(event) {
        const value = event.currentTarget.dataset.value;
        if (!value) {
            return;
        }
        wx.showModal({
            title: '删除自定义标题',
            content: '把「' + value + '」从点选列表里移除吗？',
            confirmText: '删除',
            confirmColor: '#d64545',
            cancelText: '保留',
            success: (res) => {
                if (!res.confirm) {
                    return;
                }
                if (customTitles.remove(value)) {
                    this.refreshTitleOptions();
                    wx.showToast({ title: '已移除', icon: 'success', duration: 600 });
                }
            },
        });
    },

    selectTitleOption(event) {
        const value = event.currentTarget.dataset.value;
        if (!value) {
            return;
        }
        this.setData({ title: value, titleSheetOpen: false, errorText: '' });
    },

    noop() {
        // 阻止遮罩层滑动穿透
    },

    selectCategory(event) {
        const key = event.currentTarget.dataset.key;
        this.setData({
            category: key,
            categoryColor: categories.categoryOf(key).color,
        });
    },

    // 滚动月份列时，日列换成该月的天数，并尽量保持原来的「几号」
    onDateColumnChange(event) {
        const column = event.detail.column;
        const index = Number(event.detail.value) || 0;
        if (column !== 0) {
            const max = this.dayOptions ? this.dayOptions.length : 1;
            this.setData({ 'dateIndexes[1]': Math.min(index, max - 1) });
            return;
        }
        if (!this.monthOptions || !this.monthOptions[index]) {
            return;
        }
        const month = this.monthOptions[index];
        const todayKey = dateUtil.toKey(new Date());
        const previousDay = Number(String(this.data.date || '').slice(8, 10)) || new Date().getDate();
        const days = buildDayOptions(month.year, month.month, todayKey);
        let dayIndex = days.map((item) => Number(item.key.slice(8, 10))).indexOf(previousDay);
        if (dayIndex < 0) {
            dayIndex = Math.min(this.data.dateIndexes[1], days.length - 1);
        }
        this.dayOptions = days;
        this.setData({
            dateRanges: [this.monthOptions.map((item) => item.label), days.map((item) => item.label)],
            dateIndexes: [index, dayIndex],
        });
    },

    // 点确定：把选中的「年月 + 日」拼回日期
    onDateChange(event) {
        const indexes = event.detail.value || [];
        const month = (this.monthOptions || [])[indexes[0]];
        const day = (this.dayOptions || [])[indexes[1]];
        if (!month || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day.key)) {
            return;
        }
        this.setData({ date: day.key, errorText: '' });
        this.buildPreview();
    },

    onTimeChange(event) {
        this.setData({ time: event.detail.value, errorText: '' });
        this.buildPreview();
    },

    save() {
        if (this.data.saving) {
            return;
        }
        const title = String(this.data.title || '').trim();
        if (!title) {
            this.setData({ errorText: '请先填写行程标题' });
            return;
        }
        const startTime = this.computeStartTime();
        if (!startTime) {
            this.setData({ errorText: '行程时间无效，请重新选择' });
            return;
        }
        if (!this.data.isEdit && startTime <= Date.now()) {
            this.setData({ errorText: '行程时间已经过去了，请选择之后的时间' });
            return;
        }

        const option = remind.REMIND_OPTIONS[this.data.remindIndex] || remind.REMIND_OPTIONS[0];
        const payload = {
            title: title,
            note: this.data.note,
            category: this.data.category,
            startTime: startTime,
            remindBefore: option.value,
        };

        this.setData({ saving: true, errorText: '' });
        const result = this.data.isEdit ? store.update(this.tripId, payload) : store.create(payload);
        if (result.error) {
            this.setData({ saving: false, errorText: '保存失败，请稍后重试' });
            return;
        }
        this.setData({ saving: false });
        this.enqueuePush(result.data, option);
        this.syncCalendar(result.data);
        // 云端写入（已开启云同步时），失败只提示不回滚本地，下次同步会补齐
        if (sync.isSignedIn()) {
            sync.pushTrip(result.data).then((res) => {
                if (!res.ok) {
                    wx.showToast({ title: '云端保存失败，联网后会自动补齐', icon: 'none', duration: 2200 });
                }
            });
        }
        wx.showToast({ title: this.data.isEdit ? '已更新' : '已创建', icon: 'success', duration: 700 });
        setTimeout(() => {
            wx.navigateBack({
                delta: 1,
                fail() {
                    wx.reLaunch({ url: '/pages/index/index' });
                },
            });
        }, 520);
    },


    // 保存后写入手机系统日历（默认开启）：锁屏时由系统日历提醒
    // 授权不单独设入口——首次写入由系统直接弹授权窗，拒绝后这里自动引导去设置页打开
    syncCalendar(trip) {
        if (!trip || !settings.getAlarm().calendar) {
            return;
        }
        // 当前运行环境不支持写日历（如部分预览沙箱）：明确告知，避免误以为已同步
        if (!calendar.canUse()) {
            wx.showToast({
                title: '当前环境不支持写入日历，正式版微信中将生效',
                icon: 'none',
                duration: 2400,
            });
            return;
        }
        if (!trip.startTime || trip.startTime <= Date.now()) {
            return;
        }
        // 改过开始时间或提前提醒档位才强制重写（微信没有删除日历事件的接口，
        // 重写会生成新事件，旧事件需要用户在系统日历里手动删除）
        const remindBefore = Number(trip.remindBefore) || 0;
        const force =
            this.data.isEdit &&
            ((this.originalStart && this.originalStart !== trip.startTime) ||
                (typeof this.originalRemind === 'number' && this.originalRemind !== remindBefore));
        calendar
            .addTrip(trip, { force: force })
            .then((res) => {
                if (!res) {
                    return;
                }
                if (res.ok) {
                    if (!res.skipped) {
                        wx.showToast({ title: '已写入手机日历，锁屏会提醒', icon: 'none', duration: 1600 });
                    }
                    return;
                }
                if (res.reason === 'DENIED' || res.needSetting) {
                    this.guideCalendarSetting();
                    return;
                }
                if (res.reason === 'PRIVACY') {
                    wx.showModal({
                        title: '暂时写不进日历',
                        content:
                            '微信提示需要先在小程序后台的《用户隐私保护指引》中声明「日历（仅写入）」。请在发布后台确认后重试；期间行程仍会正常在小程序内提醒。',
                        showCancel: false,
                        confirmText: '知道了',
                        confirmColor: '#2B5CE6',
                    });
                    return;
                }
                if (res.reason === 'UNSUPPORTED') {
                    wx.showToast({ title: '当前微信版本不支持写入日历', icon: 'none', duration: 2200 });
                    return;
                }
                if (res.reason === 'REMIND_PASSED') {
                    // 提醒时刻已过，写了也不会响，静默跳过不打扰
                    return;
                }
                // CANCELED（用户点了取消）或一般失败：轻提示即可，不反复打扰
                wx.showToast({ title: '未写入日历，可下次保存时再试', icon: 'none', duration: 2200 });
            })
            .catch(() => {});
    },

    // 授权被拒后微信不再自动弹窗，由写入失败自动带出设置页引导
    guideCalendarSetting() {
        wx.showModal({
            title: '需要日历权限',
            content: '微信需要「添加到日历」权限，才能把行程写进手机系统日历并在锁屏时提醒。点「去设置」把开关打开。',
            confirmText: '去设置',
            cancelText: '稍后',
            confirmColor: '#2B5CE6',
            success: (res) => {
                if (!res.confirm) {
                    return;
                }
                calendar.openSetting().then((result) => {
                    if (result.ok) {
                        wx.showToast({ title: '已开启，保存行程时会写入日历', icon: 'none', duration: 2000 });
                    } else {
                        wx.showToast({ title: '还没打开日历权限', icon: 'none', duration: 2200 });
                    }
                });
            },
        });
    },

    // 保存后把行程登记到云端定时队列，到点由云函数下发订阅消息
    // 未配置 push-config.js 或用户关闭了微信消息提醒时，这里静默跳过，只保留本地闹钟
    enqueuePush(trip, option) {
        if (!trip || !settings.getAlarm().push || !subscribe.isConfigured()) {
            return;
        }
        if (!trip.startTime || trip.startTime <= Date.now()) {
            return;
        }
        const detail = option && option.value > 0 ? '还有 ' + option.value + ' 分钟开始' : '行程现在开始';
        subscribe.schedule(trip, detail).then(() => {}).catch(() => {});
    },

    removeTrip() {
        const title = String(this.data.title || '这个行程');
        wx.showModal({
            title: '删除行程',
            content: '删除后无法恢复，确定删除「' + title + '」吗？',
            confirmText: '删除',
            confirmColor: '#d64545',
            cancelText: '取消',
            success: (res) => {
                if (!res.confirm) {
                    return;
                }
                const result = store.remove(this.tripId);
                if (result.error) {
                    wx.showToast({ title: '删除失败，请重试', icon: 'none' });
                    return;
                }
                if (subscribe.isConfigured()) {
                    subscribe.cancel(this.tripId).then(() => {}).catch(() => {});
                }
                if (sync.isSignedIn()) {
                    sync.removeTrip(this.tripId).then((res) => {
                        if (!res.ok) {
                            wx.showToast({ title: '云端删除失败，下次同步会重试', icon: 'none', duration: 2200 });
                        }
                    });
                }
                wx.showToast({ title: '已删除', icon: 'success', duration: 600 });
                setTimeout(() => {
                    wx.navigateBack({
                        delta: 1,
                        fail() {
                            wx.reLaunch({ url: '/pages/index/index' });
                        },
                    });
                }, 480);
            },
        });
    },
});
