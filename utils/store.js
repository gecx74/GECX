const noteOptions = require('./note-options.js');

const STORAGE_KEY = 'trip_reminder_items_v1';
const CATEGORY_KEYS = ['work', 'life'];
const LEGACY_CATEGORY_MAP = { travel: 'life', other: 'life' };
const REMIND_VALUES = [0, 5, 10, 15, 30, 60, 120, 1440];

function normalizeCategory(value) {
    if (CATEGORY_KEYS.indexOf(value) >= 0) {
        return value;
    }
    if (LEGACY_CATEGORY_MAP[value]) {
        return LEGACY_CATEGORY_MAP[value];
    }
    return 'work';
}

function isPlainNumber(value) {
    return typeof value === 'number' && isFinite(value);
}

function isValidRecord(record) {
    return !!record && typeof record === 'object' && typeof record.id === 'string' && isPlainNumber(record.startTime);
}

function normalize(record) {
    const legacyNote = noteOptions.isValidNoteType(record.noteType) ? record.noteType : '';
    const keptNote = legacyNote || String(record.migratedNote || '').slice(0, 40);
    let title = String(record.title || '').trim();
    if (legacyNote) {
        if (!title) {
            title = legacyNote;
        } else if (title.indexOf(legacyNote) < 0) {
            title = title + ' · ' + legacyNote;
        }
    }
    title = title.slice(0, 40);
    return {
        id: record.id,
        title: title,
        noteType: '',
        migratedNote: keptNote,
        note: String(record.note || '').slice(0, 200),
        category: normalizeCategory(record.category),
        startTime: record.startTime,
        remindBefore: REMIND_VALUES.indexOf(Number(record.remindBefore)) >= 0 ? Number(record.remindBefore) : 10,
        done: !!record.done,
        notified: !!record.notified,
        startNotified: !!record.startNotified,
        createdAt: isPlainNumber(record.createdAt) ? record.createdAt : Date.now(),
        updatedAt: isPlainNumber(record.updatedAt) ? record.updatedAt : Date.now(),
    };
}

function readAll() {
    try {
        const raw = wx.getStorageSync(STORAGE_KEY);
        if (!Array.isArray(raw)) {
            return { data: [], error: null };
        }
        return { data: raw.filter(isValidRecord).map(normalize), error: null };
    } catch (error) {
        return { data: [], error: 'CLIENT_EXCEPTION' };
    }
}

function writeAll(list) {
    try {
        wx.setStorageSync(STORAGE_KEY, list);
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error: 'CLIENT_EXCEPTION' };
    }
}

function sortByTime(list) {
    return list.slice().sort((a, b) => a.startTime - b.startTime);
}

function list() {
    const result = readAll();
    if (result.error) {
        return result;
    }
    return { data: sortByTime(result.data), error: null };
}

function getById(id) {
    if (typeof id !== 'string' || !id) {
        return { data: null, error: 'INVALID_ID' };
    }
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    for (let i = 0; i < result.data.length; i += 1) {
        if (result.data[i].id === id) {
            return { data: result.data[i], error: null };
        }
    }
    return { data: null, error: 'NOT_FOUND_OR_FORBIDDEN' };
}

function pickPayload(payload) {
    const source = payload || {};
    const title = String(source.title || '').trim().slice(0, 40);
    if (!title) {
        return { data: null, error: 'INVALID_PAYLOAD' };
    }
    if (!isPlainNumber(source.startTime) || source.startTime <= 0) {
        return { data: null, error: 'INVALID_PAYLOAD' };
    }
    return {
        data: {
            title: title,
            note: String(source.note || '').trim().slice(0, 200),
            category: normalizeCategory(source.category),
            startTime: Math.round(source.startTime),
            remindBefore: REMIND_VALUES.indexOf(Number(source.remindBefore)) >= 0 ? Number(source.remindBefore) : 10,
        },
        error: null,
    };
}

function create(payload) {
    const picked = pickPayload(payload);
    if (picked.error) {
        return { data: null, error: picked.error };
    }
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    const now = Date.now();
    const record = normalize({
        id: 't_' + now + '_' + Math.random().toString(36).slice(2, 7),
        title: picked.data.title,
        note: picked.data.note,
        category: picked.data.category,
        startTime: picked.data.startTime,
        remindBefore: picked.data.remindBefore,
        done: false,
        notified: false,
        startNotified: false,
        createdAt: now,
        updatedAt: now,
    });
    const next = result.data.concat([record]);
    const written = writeAll(next);
    if (written.error) {
        return { data: null, error: written.error };
    }
    return { data: record, error: null };
}

function update(id, payload) {
    if (typeof id !== 'string' || !id) {
        return { data: null, error: 'INVALID_ID' };
    }
    const picked = pickPayload(payload);
    if (picked.error) {
        return { data: null, error: picked.error };
    }
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    let found = null;
    const next = result.data.map((record) => {
        if (record.id !== id) {
            return record;
        }
        found = normalize({
            id: record.id,
            title: picked.data.title,
            migratedNote: record.migratedNote,
            note: picked.data.note,
            category: picked.data.category,
            startTime: picked.data.startTime,
            remindBefore: picked.data.remindBefore,
            done: record.done,
            notified: false,
            startNotified: false,
            createdAt: record.createdAt,
            updatedAt: Date.now(),
        });
        return found;
    });
    if (!found) {
        return { data: null, error: 'NOT_FOUND_OR_FORBIDDEN' };
    }
    const written = writeAll(next);
    if (written.error) {
        return { data: null, error: written.error };
    }
    return { data: found, error: null };
}

function remove(id) {
    if (typeof id !== 'string' || !id) {
        return { data: null, error: 'INVALID_ID' };
    }
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    const next = result.data.filter((record) => record.id !== id);
    if (next.length === result.data.length) {
        return { data: null, error: 'NOT_FOUND_OR_FORBIDDEN' };
    }
    const written = writeAll(next);
    if (written.error) {
        return { data: null, error: written.error };
    }
    return { data: { id: id }, error: null };
}

function patch(id, changes) {
    if (typeof id !== 'string' || !id) {
        return { data: null, error: 'INVALID_ID' };
    }
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    let found = null;
    const next = result.data.map((record) => {
        if (record.id !== id) {
            return record;
        }
        found = Object.assign({}, record, changes, { updatedAt: Date.now() });
        return found;
    });
    if (!found) {
        return { data: null, error: 'NOT_FOUND_OR_FORBIDDEN' };
    }
    const written = writeAll(next);
    if (written.error) {
        return { data: null, error: written.error };
    }
    return { data: found, error: null };
}

function toggleDone(id) {
    const result = getById(id);
    if (result.error) {
        return result;
    }
    return patch(id, { done: !result.data.done });
}

function markFlags(ids, flags) {
    if (!ids || !ids.length) {
        return { data: null, error: null };
    }
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    const next = result.data.map((record) => {
        if (ids.indexOf(record.id) < 0) {
            return record;
        }
        return Object.assign({}, record, flags);
    });
    return writeAll(next);
}

function markNotifiedMany(ids) {
    return markFlags(ids, { notified: true });
}

function markStartedMany(ids) {
    return markFlags(ids, { startNotified: true });
}

function markAllNotifiedMany(ids) {
    return markFlags(ids, { notified: true, startNotified: true });
}

// 云同步用：用合并后的完整列表覆盖本地缓存（仍保留 normalize 校验）
function replaceAll(list) {
    const safe = (Array.isArray(list) ? list : []).filter(isValidRecord).map(normalize);
    return writeAll(safe);
}

function clearAll() {
    return writeAll([]);
}

// 清理历史版本留下的示例行程（id 以 t_seed_ 开头），用户自建数据不受影响
const SEED_PREFIX = 't_seed_';

function removeSeedTrips() {
    const result = readAll();
    if (result.error) {
        return { data: null, error: result.error };
    }
    const next = result.data.filter((record) => String(record.id || '').indexOf(SEED_PREFIX) !== 0);
    if (next.length === result.data.length) {
        return { data: null, error: null };
    }
    return writeAll(next);
}

module.exports = {
    STORAGE_KEY: STORAGE_KEY,
    list: list,
    getById: getById,
    create: create,
    update: update,
    remove: remove,
    toggleDone: toggleDone,
    markNotifiedMany: markNotifiedMany,
    markStartedMany: markStartedMany,
    markAllNotifiedMany: markAllNotifiedMany,
    replaceAll: replaceAll,
    clearAll: clearAll,
    removeSeedTrips: removeSeedTrips,
};
