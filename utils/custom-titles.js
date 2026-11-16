// 自定义行程标题：用户在「点选」面板里手动新增的标题项，本地持久保存
const STORAGE_KEY = 'trip_reminder_custom_titles_v1';

const MAX_ITEMS = 50;
const MAX_LENGTH = 40;

function sanitize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
}

function readList() {
    try {
        const raw = wx.getStorageSync(STORAGE_KEY);
        if (Array.isArray(raw)) {
            const seen = {};
            const list = [];
            raw.forEach((item) => {
                const text = sanitize(item);
                if (!text || seen[text]) {
                    return;
                }
                seen[text] = true;
                list.push(text);
            });
            return list;
        }
    } catch (error) {
        return [];
    }
    return [];
}

function writeList(list) {
    try {
        wx.setStorageSync(STORAGE_KEY, list);
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error: 'CLIENT_EXCEPTION' };
    }
}

function list() {
    return readList();
}

// 返回 null 表示参数无效，'dup' 表示与已有项重复（含内置项），其余为保存后的完整列表
function add(text, builtinOptions) {
    const clean = sanitize(text);
    if (!clean) {
        return null;
    }
    const builtins = Array.isArray(builtinOptions) ? builtinOptions : [];
    if (builtins.indexOf(clean) >= 0) {
        return 'dup';
    }
    const current = readList();
    if (current.indexOf(clean) >= 0) {
        return 'dup';
    }
    const next = [clean].concat(current).slice(0, MAX_ITEMS);
    const result = writeList(next);
    return result.error ? null : result.data;
}

function remove(text) {
    const clean = sanitize(text);
    if (!clean) {
        return null;
    }
    const next = readList().filter((item) => item !== clean);
    const result = writeList(next);
    return result.error ? null : result.data;
}

module.exports = {
    MAX_ITEMS: MAX_ITEMS,
    MAX_LENGTH: MAX_LENGTH,
    list: list,
    add: add,
    remove: remove,
};
