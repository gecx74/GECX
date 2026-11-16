const account = require('../../utils/account.js');
const settings = require('../../utils/settings.js');

Page({
    data: {
        mode: 'login',
        name: '',
        password: '',
        confirm: '',
        errorText: '',
        fieldName: '',
        fieldPwd: '',
        fieldConfirm: '',
        submitting: false,
        fontScale: settings.DEFAULT_FONT_SCALE,
        fontStyle: settings.DEFAULT_FONT_STYLE,
    },

    onLoad() {
        this.setData({ fontScale: settings.getFontScale(), fontStyle: settings.getFontStyle() });
        if (account.isLoggedIn()) {
            wx.reLaunch({ url: '/pages/index/index' });
        }
    },

    switchMode(event) {
        const mode = event.currentTarget.dataset.mode;
        if (mode !== 'login' && mode !== 'register') {
            return;
        }
        if (mode === this.data.mode) {
            return;
        }
        this.setData({
            mode: mode,
            password: '',
            confirm: '',
            fieldPwd: '',
            fieldConfirm: '',
            errorText: '',
        });
    },

    onNameInput(event) {
        this.setData({ name: event.detail.value, fieldName: '', errorText: '' });
    },

    onPasswordInput(event) {
        this.setData({ password: event.detail.value, fieldPwd: '', errorText: '' });
    },

    onConfirmInput(event) {
        this.setData({ confirm: event.detail.value, fieldConfirm: '', errorText: '' });
    },

    onNameBlur() {
        if (!this.data.name) {
            return;
        }
        const check = account.validateName(this.data.name);
        this.setData({ fieldName: check.ok ? '' : check.message });
    },

    onPasswordBlur() {
        if (!this.data.password) {
            return;
        }
        const check = account.validatePassword(this.data.password, this.data.name);
        this.setData({ fieldPwd: check.ok ? '' : check.message });
    },

    onConfirmBlur() {
        if (!this.data.confirm || this.data.mode !== 'register') {
            return;
        }
        const same = this.data.confirm === this.data.password;
        this.setData({ fieldConfirm: same ? '' : '两次输入的密码不一致' });
    },

    submit() {
        if (this.data.submitting) {
            return;
        }
        const nameCheck = account.validateName(this.data.name);
        if (!nameCheck.ok) {
            this.setData({ fieldName: nameCheck.message, errorText: '' });
            return;
        }

        if (this.data.mode === 'register') {
            const pwdCheck = account.validatePassword(this.data.password, this.data.name);
            if (!pwdCheck.ok) {
                this.setData({ fieldPwd: pwdCheck.message, errorText: '' });
                return;
            }
            if (this.data.confirm !== this.data.password) {
                this.setData({ fieldConfirm: '两次输入的密码不一致', errorText: '' });
                return;
            }
        } else if (!this.data.password) {
            this.setData({ fieldPwd: '请输入密码', errorText: '' });
            return;
        }

        this.setData({ submitting: true, errorText: '', fieldName: '', fieldPwd: '', fieldConfirm: '' });

        const payload = { name: this.data.name, password: this.data.password };
        const result = this.data.mode === 'register'
            ? account.register({ name: payload.name, password: payload.password, confirm: this.data.confirm })
            : account.login(payload);

        if (result.error) {
            this.setData({
                submitting: false,
                errorText: result.message || '操作失败，请重试',
            });
            return;
        }

        wx.showToast({
            title: this.data.mode === 'register' ? '注册成功' : '登录成功',
            icon: 'success',
            duration: 600,
        });
        this.setData({ submitting: false });
        setTimeout(() => {
            wx.reLaunch({
                url: '/pages/index/index',
                fail() {
                    wx.redirectTo({ url: '/pages/index/index' });
                },
            });
        }, 480);
    },
});
