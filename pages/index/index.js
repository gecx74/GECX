const store = require('../../utils/store.js');
const dateUtil = require('../../utils/date.js');
const remind = require('../../utils/remind.js');
const categories = require('../../utils/categories.js');
const settings = require('../../utils/settings.js');
const account = require('../../utils/account.js');
const reminder = require('../../utils/reminder.js');
const sync = require('../../utils/sync.js');

const FILTER_ALL = 'all';

Page({
    data: {
        loading: true,
        errorText: '',
        viewMode: 'list',
        calMode: 'month',
        activeCategory: FILTER_ALL,
        filters: [],
        heroEyebrow: '',
        heroTitle: '',
        heroHint: '',
        groups: [],
        pastGroups: [],
        pastCount: 0,
        showPast: false,
        pastToggleText: '',
        emptyTitle: '',
        emptyText: '',
        weekdays: dateUtil.WEEKDAY_SHORT,
        weeks: [],
        calendarTitle: '',
        selectedKey: '',
        selectedLabel: '',
        selectedMeta: '',
        selectedItems: [],
        selectedEmpty: false,
        fontScale: settings.DEFAULT_FONT_SCALE,
        fontOptions: settings.FONT_SCALES,
        fontStyle: settings.DEFAULT_FONT_STYLE,
        styleOptions: settings.FONT_STYLES,
        settingsOpen: false,
        alarmVibrate: true,
        snoozeMinutes: 5,
        missedTips: [],
        missedText: '',
        logoutConfirming: false,
        cloudReady: false,
        cloudOn: false,
        cloudUser: '',
        cloudTip: '',
        cloudBusy: false,
        userName: '',
        userInitial: '',
        isToday: true,
    },

    onLoad() {
        this.trips = [];
        this.todayKey = dateUtil.toKey(new Date());
        this.selectedKey = this.todayKey;
        this.anchorKey = this.todayKey;
        this.setData({ filters: this.buildFilters(), fontScale: settings.getFontScale(), fontStyle: settings.getFontStyle() });
    },

    onShow() {
        const user = account.currentUser();
        if (!user) {
            wx.reLaunch({ url: '/pages/auth/auth' });
            return;
        }
        this.setData({
            fontScale: settings.getFontScale(),
            fontStyle: settings.getFontStyle(),
            alarmVibrate: settings.getAlarm().vibrate,
            snoozeMinutes: settings.getAlarm().snoozeMinutes,
            userName: user.name,
            userInitial: String(user.name).slice(0, 1).toUpperCase(),
        });
        this.collectMissed();
        this.loadData();
        this.refreshCloud();
    },

    buildFilters() {
        const filters = [{ key: FILTER_ALL, label: '全部', color: '#16191F', bg: '#EEF1F6' }];
        categories.CATEGORIES.forEach((item) => {
            filters.push({ key: item.key, label: item.label, color: item.color, bg: item.bg });
        });
        return filters;
    },

    loadData() {
        const result = store.list();
        if (result.error) {
            this.setData({ loading: false, errorText: '行程加载失败，请稍后重试' });
            return;
        }
        this.todayKey = dateUtil.toKey(new Date());
        this.trips = result.data;
        this.setData({ loading: false, errorText: '' });
        this.render();
    },

    render() {
        const filtered = this.filteredTrips();
        this.renderHero();
        this.renderList(filtered);
        this.renderCalendar(filtered);
    },

    filteredTrips() {
        const key = this.data.activeCategory;
        const list = key === FILTER_ALL ? this.trips.slice() : this.trips.filter((trip) => trip.category === key);
        return list.sort((a, b) => a.startTime - b.startTime);
    },

    renderHero() {
        const now = Date.now();
        const today = new Date();
        const todayTrips = this.trips.filter((trip) => dateUtil.toKey(new Date(trip.startTime)) === this.todayKey);
        const upcoming = this.trips.filter((trip) => trip.startTime >= now).sort((a, b) => a.startTime - b.startTime);
        let heroHint = '点击右下角的 + 添加你的第一个行程';
        if (upcoming.length) {
            const next = upcoming[0];
            const title = dateUtil.dayTitle(new Date(next.startTime));
            heroHint = title.label + ' ' + dateUtil.timeText(next.startTime) + ' · ' + next.title;
        }
        this.setData({
            heroEyebrow: dateUtil.fullDateText(today),
            heroTitle: todayTrips.length ? '今天有 ' + todayTrips.length + ' 个安排' : '今天暂无安排',
            heroHint: heroHint,
        });
    },

    renderList(filtered) {
        const now = Date.now();
        const future = filtered.filter((trip) => trip.startTime >= now);
        const past = filtered.filter((trip) => trip.startTime < now).sort((a, b) => b.startTime - a.startTime);
        const groups = this.groupByDay(future);
        const pastGroups = this.groupByDay(past);
        const hasTrips = this.trips.length > 0;

        let emptyTitle = '接下来没有安排';
        let emptyText = '点击右下角的 + ，新建一个行程';
        if (!hasTrips) {
            emptyTitle = '还没有行程';
            emptyText = '点击右下角的 + ，创建第一个行程';
        } else if (!filtered.length) {
            emptyTitle = '该分类下暂无行程';
            emptyText = '换一个分类看看，或新建一个行程';
        } else if (!future.length) {
            emptyTitle = '接下来没有安排';
            emptyText = '已过去的行程可以在下方展开查看';
        }

        this.setData({
            groups: groups,
            pastGroups: pastGroups,
            pastCount: past.length,
            pastToggleText: this.data.showPast ? '收起已过去行程' : '查看已过去行程（' + past.length + '）',
            emptyTitle: emptyTitle,
            emptyText: emptyText,
            selectedKey: this.selectedKey,
        });
    },

    groupByDay(list) {
        const rows = [];
        const map = {};
        list.forEach((trip) => {
            const key = dateUtil.toKey(new Date(trip.startTime));
            if (!map[key]) {
                const title = dateUtil.dayTitle(dateUtil.parseKey(key));
                map[key] = { key: key, label: title.label, sub: title.sub, countText: '', items: [] };
                rows.push(map[key]);
            }
            map[key].items.push(this.toItemView(trip));
        });
        rows.forEach((row) => {
            row.countText = row.items.length + ' 个安排';
        });
        return rows;
    },

    toItemView(trip) {
        const category = categories.categoryOf(trip.category);
        const noteText = trip.note;
        return {
            id: trip.id,
            title: trip.title,
            timeText: dateUtil.timeText(trip.startTime),
            noteText: noteText,
            done: trip.done,
            categoryLabel: category.label,
            color: category.color,
            bg: category.bg,
            remindText: remind.remindLabel(trip.remindBefore),
        };
    },

    renderCalendar(filtered) {
        const counts = {};
        filtered.forEach((trip) => {
            const key = dateUtil.toKey(new Date(trip.startTime));
            counts[key] = (counts[key] || 0) + 1;
        });

        const selectedKey = this.selectedKey;
        const weeks = [];
        let calendarTitle = '';

        if (this.data.calMode === 'week') {
            const base = dateUtil.parseKey(selectedKey);
            const start = dateUtil.addDays(base, -dateUtil.mondayIndex(base));
            const end = dateUtil.addDays(start, 6);
            const cells = [];
            for (let i = 0; i < 7; i += 1) {
                cells.push(this.buildCell(dateUtil.addDays(start, i), counts, selectedKey, true, start));
            }
            weeks.push({ key: 'week-0', cells: cells });
            calendarTitle = dateUtil.monthDayText(start) + ' - ' + dateUtil.monthDayText(end);
            if (start.getFullYear() !== end.getFullYear()) {
                calendarTitle = start.getFullYear() + '年' + dateUtil.monthDayText(start) + ' - ' + end.getFullYear() + '年' + dateUtil.monthDayText(end);
            }
        } else {
            const anchor = dateUtil.parseKey(this.anchorKey);
            const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
            const start = dateUtil.addDays(first, -dateUtil.mondayIndex(first));
            for (let w = 0; w < 6; w += 1) {
                const cells = [];
                for (let i = 0; i < 7; i += 1) {
                    cells.push(this.buildCell(dateUtil.addDays(start, w * 7 + i), counts, selectedKey, false, first));
                }
                weeks.push({ key: 'week-' + w, cells: cells });
            }
            calendarTitle = first.getFullYear() + '年' + (first.getMonth() + 1) + '月';
        }

        const selectedItems = filtered
            .filter((trip) => dateUtil.toKey(new Date(trip.startTime)) === selectedKey)
            .map((trip) => this.toItemView(trip));
        const selectedDate = dateUtil.parseKey(selectedKey);
        const title = dateUtil.dayTitle(selectedDate);

        // 「今天」按钮的回显：当前浏览的周/月是否已经包含今天
        const todayKey = dateUtil.toKey(new Date());
        const todayDate = dateUtil.parseKey(todayKey);
        let containsToday = false;
        if (this.data.calMode === 'week') {
            const weekBase = dateUtil.parseKey(selectedKey);
            const weekStart = dateUtil.addDays(weekBase, -dateUtil.mondayIndex(weekBase));
            const weekEnd = dateUtil.addDays(weekStart, 6);
            containsToday = todayKey >= dateUtil.toKey(weekStart) && todayKey <= dateUtil.toKey(weekEnd);
        } else {
            const monthAnchor = dateUtil.parseKey(this.anchorKey);
            containsToday =
                monthAnchor.getFullYear() === todayDate.getFullYear() && monthAnchor.getMonth() === todayDate.getMonth();
        }

        this.setData({
            weeks: weeks,
            calendarTitle: calendarTitle,
            selectedLabel: title.label + ' · ' + title.sub,
            selectedMeta: selectedItems.length ? selectedItems.length + ' 个安排' : '暂无安排',
            selectedItems: selectedItems,
            selectedEmpty: selectedItems.length === 0,
            isToday: containsToday && selectedKey === todayKey,
        });
    },

    buildCell(date, counts, selectedKey, forced, firstOfMonth) {
        const key = dateUtil.toKey(date);
        const inMonth = forced
            ? true
            : date.getFullYear() === firstOfMonth.getFullYear() && date.getMonth() === firstOfMonth.getMonth();
        let className = '';
        if (!inMonth) {
            className += ' is-out';
        }
        if (key === this.todayKey) {
            className += ' is-today';
        }
        if (key === selectedKey) {
            className += ' is-selected';
        }
        return {
            key: key,
            day: date.getDate(),
            dot: (counts[key] || 0) > 0,
            className: className,
        };
    },

    switchView(event) {
        const mode = event.currentTarget.dataset.mode;
        if (mode === this.data.viewMode) {
            return;
        }
        this.setData({ viewMode: mode });
        if (mode === 'calendar') {
            this.renderCalendar(this.filteredTrips());
        }
    },

    switchCalMode(event) {
        const mode = event.currentTarget.dataset.mode;
        if (mode === this.data.calMode) {
            return;
        }
        this.setData({ calMode: mode });
        this.renderCalendar(this.filteredTrips());
    },

    shiftCalendar(event) {
        const dir = Number(event.currentTarget.dataset.dir) || 0;
        if (this.data.calMode === 'week') {
            this.selectedKey = dateUtil.toKey(dateUtil.addDays(dateUtil.parseKey(this.selectedKey), dir * 7));
        } else {
            const anchor = dateUtil.parseKey(this.anchorKey);
            const nextMonth = dateUtil.addMonths(anchor, dir);
            const isCurrentMonth = nextMonth.getFullYear() === new Date().getFullYear() && nextMonth.getMonth() === new Date().getMonth();
            this.anchorKey = dateUtil.toKey(nextMonth);
            this.selectedKey = isCurrentMonth ? this.todayKey : dateUtil.toKey(nextMonth);
        }
        this.render();
    },

    selectDate(event) {
        const key = event.currentTarget.dataset.key;
        if (!key) {
            return;
        }
        this.selectedKey = key;
        if (this.data.calMode === 'month') {
            this.anchorKey = key;
        }
        this.render();
    },

    goToday() {
        this.todayKey = dateUtil.toKey(new Date());
        this.anchorKey = this.todayKey;
        this.selectedKey = this.todayKey;
        this.render();
    },

    switchCategory(event) {
        const key = event.currentTarget.dataset.key;
        if (key === this.data.activeCategory) {
            return;
        }
        this.setData({ activeCategory: key });
        this.render();
    },

    togglePast() {
        this.setData({
            showPast: !this.data.showPast,
            pastToggleText: !this.data.showPast ? '收起已过去行程' : '查看已过去行程（' + this.data.pastCount + '）',
        });
    },

    toggleDone(event) {
        const id = event.currentTarget.dataset.id;
        const result = store.toggleDone(id);
        if (result.error) {
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
            return;
        }
        try {
            wx.vibrateShort({ type: 'light' });
        } catch (error) {
            // 部分设备不支持震动
        }
        this.loadData();
        // 云端同步勾选状态（未开启云同步时静默跳过）
        if (this.data.cloudOn && result.data) {
            sync.pushTrip(result.data);
        }
    },

    openEdit(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) {
            return;
        }
        wx.navigateTo({
            url: '/pages/edit/edit?id=' + id,
            fail() {
                wx.showToast({ title: '打开行程失败', icon: 'none' });
            },
        });
    },

    createTrip() {
        const url = this.data.viewMode === 'calendar'
            ? '/pages/edit/edit?date=' + this.selectedKey
            : '/pages/edit/edit';
        wx.navigateTo({
            url: url,
            fail() {
                wx.showToast({ title: '页面暂不可用', icon: 'none' });
            },
        });
    },

    handleRetry() {
        this.setData({ loading: true, errorText: '' });
        this.loadData();
    },

    openSettings() {
        // 每次打开面板都重置确认态，避免上次残留的「再次点击」状态误触
        this.clearLogoutConfirm();
        this.setData({ settingsOpen: true });
    },

    // 清掉退出确认态与超时定时器
    clearLogoutConfirm() {
        if (this._logoutTimer) {
            clearTimeout(this._logoutTimer);
            this._logoutTimer = null;
        }
        if (this.data.logoutConfirming) {
            this.setData({ logoutConfirming: false });
        }
    },

    // 退出登录：两段式确认——第一次点击本行变红显示「再次点击，确认退出登录」，
    // 3 秒内再点一次才真正退出，超时自动还原。
    // 刻意不依赖 wx.showModal：部分运行环境缺失该 API 或 success 回调不带回执，
    // 会让点击毫无反应。这里的确认是纯 UI 状态，任何环境都能工作。
    logout() {
        if (!this.data.logoutConfirming) {
            this.setData({ logoutConfirming: true });
            if (this._logoutTimer) {
                clearTimeout(this._logoutTimer);
            }
            this._logoutTimer = setTimeout(() => {
                this._logoutTimer = null;
                this.setData({ logoutConfirming: false });
            }, 3000);
            return;
        }
        if (this._logoutTimer) {
            clearTimeout(this._logoutTimer);
            this._logoutTimer = null;
        }
        this.setData({ logoutConfirming: false, settingsOpen: false });
        // 同时退出云身份：本机账号换了人，云会话不能继续沿用上一个人的，
        // 否则下一次同步会把别人的行程拉进来。失败不影响本机退出。
        try {
            const signOutResult = sync.signOut();
            if (signOutResult && typeof signOutResult.catch === 'function') {
                signOutResult.catch(() => {});
            }
        } catch (error) {
            // 云服务未就绪时直接跳过
        }
        let result = null;
        try {
            result = account.logout();
        } catch (error) {
            result = { error: 'CLIENT_EXCEPTION' };
        }
        if ((result && result.error) || account.isLoggedIn()) {
            wx.showToast({ title: '退出失败，请重试', icon: 'none' });
            return;
        }
        // 逐级兜底跳登录页：reLaunch -> redirectTo -> navigateTo，全部失败给出明确提示
        const goAuth = (methods) => {
            if (!methods.length) {
                wx.showToast({ title: '已退出登录，请重新打开小程序', icon: 'none', duration: 2500 });
                return;
            }
            const name = methods[0];
            try {
                if (typeof wx[name] !== 'function') {
                    goAuth(methods.slice(1));
                    return;
                }
                wx[name]({
                    url: '/pages/auth/auth',
                    fail() {
                        goAuth(methods.slice(1));
                    },
                });
            } catch (error) {
                goAuth(methods.slice(1));
            }
        };
        goAuth(['reLaunch', 'redirectTo', 'navigateTo']);
    },

    closeSettings() {
        this.clearLogoutConfirm();
        this.setData({ settingsOpen: false });
    },

    selectFontScale(event) {
        const key = event.currentTarget.dataset.key;
        if (!key || key === this.data.fontScale) {
            return;
        }
        const result = settings.setFontScale(key);
        if (result.error) {
            wx.showToast({ title: '设置保存失败，请重试', icon: 'none' });
            return;
        }
        this.setData({ fontScale: key });
    },

    selectFontStyle(event) {
        const key = event.currentTarget.dataset.key;
        if (!key || key === this.data.fontStyle) {
            return;
        }
        const result = settings.setFontStyle(key);
        if (result.error) {
            wx.showToast({ title: "设置保存失败，请重试", icon: "none" });
            return;
        }
        this.setData({ fontStyle: key });
    },

    // 振动开关：默认开启，关掉后闹钟只保留界面与弹窗
    toggleVibrate(event) {
        const value = !!(event.detail && event.detail.value);
        const result = settings.setAlarm({ vibrate: value });
        if (result.error) {
            wx.showToast({ title: '设置保存失败，请重试', icon: 'none' });
            return;
        }
        this.setData({ alarmVibrate: value });
        wx.showToast({ title: value ? '闹钟将振动提醒' : '已关闭振动', icon: 'none' });
    },

    // ---------- 云同步 ----------

    // 刷新云同步状态：SDK 是否就绪 + 当前是否已登录云账号
    refreshCloud() {
        if (!sync.sdkReady()) {
            this.setData({
                cloudReady: false,
                cloudOn: false,
                cloudTip: '当前运行环境未加载云服务 SDK，发布正式版后可用',
            });
            return;
        }
        sync.getSession().then((res) => {
            const user = res.session && res.session.user ? res.session.user : null;
            this.setData({
                cloudReady: true,
                cloudOn: !!user,
                cloudUser: user ? user.name || '微信用户' : '',
                cloudTip: res.error
                    ? '云会话读取失败：' + (res.error.message || '请稍后重试')
                    : user
                      ? '已登录，行程保存在云端；本机保留缓存，断网也能提醒'
                      : '未开启：微信登录后行程存到云端，换手机或重装也能找回',
            });
            if (user) {
                this.pullCloud(false);
            }
        });
    },

    // 拉取云端数据并合并到本地缓存；silent 为 true 时不打扰用户
    pullCloud(showToast) {
        if (!this.data.cloudOn) {
            if (showToast) {
                wx.showToast({ title: '请先微信登录开启云同步', icon: 'none' });
            }
            return;
        }
        this.setData({ cloudBusy: true });
        sync.pull().then((res) => {
            this.setData({ cloudBusy: false });
            if (!res.ok) {
                wx.showToast({
                    title: '同步失败：' + ((res.error && res.error.message) || '请检查网络'),
                    icon: 'none',
                    duration: 2400,
                });
                return;
            }
            this.loadData();
            if (showToast) {
                wx.showToast({
                    title: res.uploaded ? '已同步，上传 ' + res.uploaded + ' 条' : '已是最新',
                    icon: 'none',
                });
            }
        });
    },

    // 微信一键登录，建立云会话后立即全量合并
    cloudLogin() {
        if (this.data.cloudBusy) {
            return;
        }
        if (!this.data.cloudReady) {
            wx.showToast({ title: '当前环境暂不支持云服务', icon: 'none', duration: 2400 });
            return;
        }
        this.setData({ cloudBusy: true });
        sync.signInWithWeChat().then((res) => {
            this.setData({ cloudBusy: false });
            if (!res.ok) {
                wx.showToast({ title: res.message || '微信登录失败', icon: 'none', duration: 2600 });
                return;
            }
            wx.showToast({ title: '已开启云同步', icon: 'none' });
            this.refreshCloud();
        });
    },

    cloudLogout() {
        if (this.data.cloudBusy) {
            return;
        }
        this.setData({ cloudBusy: true });
        sync.signOut().then((res) => {
            this.setData({ cloudBusy: false });
            if (res.error) {
                wx.showToast({ title: '退出云账号失败，请重试', icon: 'none' });
                return;
            }
            wx.showToast({ title: '已退出云账号，本机行程保留', icon: 'none' });
            this.refreshCloud();
        });
    },

    syncNow() {
        this.pullCloud(true);
    },

    // 锁屏/退后台期间错过的提醒，回到前台给个交代
    collectMissed() {
        const list = reminder.takeMissed();
        if (!list || !list.length) {
            return;
        }
        const tips = list.map((item) => dateUtil.timeText(item.startTime) + ' ' + item.title);
        this.setData({
            missedTips: tips,
            missedText: '锁屏期间错过了 ' + list.length + ' 个提醒：' + tips.join('；'),
        });
    },

    dismissMissed() {
        this.setData({ missedTips: [], missedText: '' });
    },

    noop() {
        // 阻止遮罩层滑动穿透
    },
});
