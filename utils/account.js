const sha256 = require('./sha256.js');

const ACCOUNT_KEY = 'trip_reminder_accounts_v1';
const SESSION_KEY = 'trip_reminder_session_v1';
const GUARD_KEY = 'trip_reminder_login_guard_v1';

const NAME_MIN = 3;
const NAME_MAX = 20;
const PWD_MIN = 8;
const PWD_MAX = 20;
const LOCK_LIMIT = 5;
const LOCK_MS = 60 * 1000;
const SALT_PEPPER = 'trip-reminder-v1';

function readJson(key, fallback) {
    try {
        const raw = wx.getStorageSync(key);
        if (raw && typeof raw === 'object') {
            return raw;
        }
    } catch (error) {
        return fallback;
    }
    return fallback;
}

function writeJson(key, value) {
    try {
        wx.setStorageSync(key, value);
        return true;
    } catch (error) {
        return false;
    }
}

function accounts() {
    const raw = readJson(ACCOUNT_KEY, {});
    return Array.isArray(raw.list) ? raw : { list: [] };
}

function saveAccounts(store) {
    return writeJson(ACCOUNT_KEY, store);
}

function normalizeName(name) {
    return String(name || '').trim();
}

function nameKey(name) {
    return normalizeName(name).toLowerCase();
}

function validateName(name) {
    const value = normalizeName(name);
    if (!value) {
        return { ok: false, message: '请输入账号' };
    }
    if (value.length < NAME_MIN || value.length > NAME_MAX) {
        return { ok: false, message: '账号需为 ' + NAME_MIN + '-' + NAME_MAX + ' 个字符' };
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(value)) {
        return { ok: false, message: '账号只能包含中文、字母、数字或下划线' };
    }
    return { ok: true, message: '' };
}

function validatePassword(password, name) {
    const value = String(password || '');
    if (!value) {
        return { ok: false, message: '请输入密码' };
    }
    if (/\s/.test(value)) {
        return { ok: false, message: '密码不能包含空格' };
    }
    if (value.length < PWD_MIN || value.length > PWD_MAX) {
        return { ok: false, message: '密码需为 ' + PWD_MIN + '-' + PWD_MAX + ' 位' };
    }
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
        return { ok: false, message: '密码需同时包含字母和数字' };
    }
    if (name && value.toLowerCase() === normalizeName(name).toLowerCase()) {
        return { ok: false, message: '密码不能与账号相同' };
    }
    return { ok: true, message: '' };
}

function randomSalt() {
    const seed = Date.now().toString(36) + Math.random().toString(36).slice(2);
    return sha256.sha256Hex(seed + SALT_PEPPER).slice(0, 32);
}

function hashPassword(salt, password) {
    return sha256.sha256Hex(salt + '|' + String(password) + '|' + SALT_PEPPER);
}

function findByName(store, name) {
    const key = nameKey(name);
    for (let i = 0; i < store.list.length; i += 1) {
        if (store.list[i].nameKey === key) {
            return store.list[i];
        }
    }
    return null;
}

function readGuard() {
    const raw = readJson(GUARD_KEY, {});
    return raw && typeof raw === 'object' ? raw : {};
}

function guardOf(name) {
    const guard = readGuard();
    const item = guard[nameKey(name)];
    if (!item || typeof item !== 'object') {
        return { fails: 0, until: 0 };
    }
    return { fails: Number(item.fails) || 0, until: Number(item.until) || 0 };
}

function setGuard(name, fails, until) {
    const guard = readGuard();
    guard[nameKey(name)] = { fails: fails, until: until };
    writeJson(GUARD_KEY, guard);
}

function lockRemain(name) {
    const item = guardOf(name);
    const remain = item.until - Date.now();
    return remain > 0 ? remain : 0;
}

function register(payload) {
    const nameCheck = validateName(payload && payload.name);
    if (!nameCheck.ok) {
        return { data: null, error: 'INVALID_NAME', message: nameCheck.message };
    }
    const pwdCheck = validatePassword(payload && payload.password, payload.name);
    if (!pwdCheck.ok) {
        return { data: null, error: 'INVALID_PASSWORD', message: pwdCheck.message };
    }
    if (String(payload.confirm || '') !== String(payload.password || '')) {
        return { data: null, error: 'PASSWORD_MISMATCH', message: '两次输入的密码不一致' };
    }

    const store = accounts();
    if (findByName(store, payload.name)) {
        return { data: null, error: 'NAME_TAKEN', message: '该账号已被注册，换一个或直接登录' };
    }

    const salt = randomSalt();
    const now = Date.now();
    const record = {
        id: 'u_' + now + '_' + Math.random().toString(36).slice(2, 7),
        name: normalizeName(payload.name),
        nameKey: nameKey(payload.name),
        salt: salt,
        hash: hashPassword(salt, payload.password),
        createdAt: now,
        lastLoginAt: now,
    };
    store.list.push(record);
    if (!saveAccounts(store)) {
        return { data: null, error: 'CLIENT_EXCEPTION', message: '保存失败，请重试' };
    }
    setGuard(payload.name, 0, 0);
    const session = { id: record.id, name: record.name, loginAt: now };
    writeJson(SESSION_KEY, session);
    return { data: { id: record.id, name: record.name }, error: null, message: '' };
}

function login(payload) {
    const name = normalizeName(payload && payload.name);
    if (!name) {
        return { data: null, error: 'INVALID_NAME', message: '请输入账号' };
    }
    if (!payload || !payload.password) {
        return { data: null, error: 'INVALID_PASSWORD', message: '请输入密码' };
    }

    const remain = lockRemain(name);
    if (remain > 0) {
        return {
            data: null,
            error: 'LOCKED',
            message: '尝试次数过多，请 ' + Math.ceil(remain / 1000) + ' 秒后再试',
        };
    }

    const store = accounts();
    const record = findByName(store, name);
    if (!record) {
        return { data: null, error: 'ACCOUNT_NOT_FOUND', message: '账号不存在，请先注册' };
    }

    if (record.hash !== hashPassword(record.salt, payload.password)) {
        const guard = guardOf(name);
        const fails = guard.fails + 1;
        const until = fails >= LOCK_LIMIT ? Date.now() + LOCK_MS : 0;
        setGuard(name, fails, until);
        if (until) {
            return { data: null, error: 'LOCKED', message: '尝试次数过多，请 60 秒后再试' };
        }
        return {
            data: null,
            error: 'WRONG_PASSWORD',
            message: '密码不对，还可以尝试 ' + (LOCK_LIMIT - fails) + ' 次',
        };
    }

    const now = Date.now();
    record.lastLoginAt = now;
    saveAccounts(store);
    setGuard(name, 0, 0);
    writeJson(SESSION_KEY, { id: record.id, name: record.name, loginAt: now });
    return { data: { id: record.id, name: record.name }, error: null, message: '' };
}

function currentUser() {
    const session = readJson(SESSION_KEY, null);
    if (!session || !session.id) {
        return null;
    }
    const store = accounts();
    for (let i = 0; i < store.list.length; i += 1) {
        if (store.list[i].id === session.id) {
            return { id: store.list[i].id, name: store.list[i].name };
        }
    }
    return null;
}

function logout() {
    try {
        wx.removeStorageSync(SESSION_KEY);
    } catch (error) {
        return { error: 'CLIENT_EXCEPTION' };
    }
    return { error: null };
}

function isLoggedIn() {
    return !!currentUser();
}

module.exports = {
    NAME_MIN: NAME_MIN,
    NAME_MAX: NAME_MAX,
    PWD_MIN: PWD_MIN,
    PWD_MAX: PWD_MAX,
    validateName: validateName,
    validatePassword: validatePassword,
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    isLoggedIn: isLoggedIn,
    lockRemain: lockRemain,
};
