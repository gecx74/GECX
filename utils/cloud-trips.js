/**
 * 行程表（public.trips）读写
 *
 * 表结构约定（云端，RLS 按 owner_id 隔离）：
 *   owner_id    TEXT NOT NULL DEFAULT auth.uid()  —— 服务端写入，客户端永不传
 *   client_id   TEXT NOT NULL                     —— 端侧行程 id（store.js 生成的 t_xxx）
 *   start_time  BIGINT                            —— 毫秒时间戳，与本地一致
 *   remind_before / done / notified / start_notified —— 与本地字段一一对应
 *
 * 客户端只负责业务列；owner_id 由 DEFAULT auth.uid() 填充，伪造会被 WITH CHECK 拒绝。
 */

const { getCloud } = require('./cloud.js');

const TABLE = 'trips';

function toIso(value) {
    const time = Number(value) || Date.now();
    return new Date(time).toISOString();
}

/**
 * 本地行程 -> 云端行（不含 owner_id）
 */
function toRow(trip, ownerName) {
    return {
        client_id: String(trip.id),
        owner_name: ownerName || null,
        title: String(trip.title || '').slice(0, 40),
        note: String(trip.note || '').slice(0, 200),
        category: trip.category === 'life' ? 'life' : 'work',
        start_time: Math.round(Number(trip.startTime) || 0),
        remind_before: Number(trip.remindBefore) || 0,
        done: !!trip.done,
        notified: !!trip.notified,
        start_notified: !!trip.startNotified,
        updated_at: toIso(trip.updatedAt),
    };
}

/**
 * 云端行 -> 本地行程
 */
function fromRow(row) {
    if (!row || !row.client_id) {
        return null;
    }
    return {
        id: String(row.client_id),
        title: String(row.title || ''),
        noteType: '',
        migratedNote: '',
        note: String(row.note || ''),
        category: row.category === 'life' ? 'life' : 'work',
        startTime: Number(row.start_time) || 0,
        remindBefore: Number(row.remind_before) || 0,
        done: !!row.done,
        notified: !!row.notified,
        startNotified: !!row.start_notified,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    };
}

/**
 * 拉取当前账号的全部行程
 * @returns {Promise<{data: Array, error: *}>}
 */
async function fetchAll() {
    const cloud = getCloud();
    if (!cloud) {
        return { data: [], error: { kind: 'unavailable', message: '云服务未就绪' } };
    }
    const { data, error } = await cloud.database.from(TABLE).select('*').order('start_time', { ascending: true });
    if (error) {
        return { data: [], error: error };
    }
    const list = (data || []).map(fromRow).filter(Boolean);
    return { data: list, error: null };
}

/**
 * 写入/更新一条行程（按 owner_id + client_id 幂等）
 */
async function upsert(trip, ownerName) {
    const cloud = getCloud();
    if (!cloud) {
        return { data: null, error: { kind: 'unavailable', message: '云服务未就绪' } };
    }
    const { data, error } = await cloud.database
        .from(TABLE)
        .upsert(toRow(trip, ownerName), { onConflict: 'owner_id,client_id' })
        .select();
    if (error) {
        return { data: null, error: error };
    }
    const row = Array.isArray(data) && data.length ? fromRow(data[0]) : null;
    return { data: row, error: null };
}

/**
 * 批量写入（首次开启云同步时上传本地行程）
 */
async function upsertMany(trips, ownerName) {
    const cloud = getCloud();
    if (!cloud) {
        return { data: null, error: { kind: 'unavailable', message: '云服务未就绪' } };
    }
    const rows = (trips || []).map((trip) => toRow(trip, ownerName));
    if (!rows.length) {
        return { data: [], error: null };
    }
    const { data, error } = await cloud.database
        .from(TABLE)
        .upsert(rows, { onConflict: 'owner_id,client_id' })
        .select();
    if (error) {
        return { data: null, error: error };
    }
    return { data: (data || []).map(fromRow).filter(Boolean), error: null };
}

/**
 * 删除一条行程；返回被删除的行（空数组代表不存在或不是本人的）
 */
async function removeByClientId(clientId) {
    const cloud = getCloud();
    if (!cloud) {
        return { data: [], error: { kind: 'unavailable', message: '云服务未就绪' } };
    }
    const { data, error } = await cloud.database
        .from(TABLE)
        .delete()
        .eq('client_id', String(clientId))
        .select();
    if (error) {
        return { data: [], error: error };
    }
    return { data: data || [], error: null };
}

/**
 * 只更新提醒标记（已提醒/已开始提醒），避免整行覆盖
 */
async function updateFlags(clientId, flags) {
    const cloud = getCloud();
    if (!cloud) {
        return { data: null, error: { kind: 'unavailable', message: '云服务未就绪' } };
    }
    const patch = { updated_at: toIso(Date.now()) };
    if (typeof flags.notified === 'boolean') {
        patch.notified = flags.notified;
    }
    if (typeof flags.startNotified === 'boolean') {
        patch.start_notified = flags.startNotified;
    }
    const { data, error } = await cloud.database
        .from(TABLE)
        .update(patch)
        .eq('client_id', String(clientId))
        .select();
    if (error) {
        return { data: null, error: error };
    }
    return { data: data || [], error: null };
}

module.exports = {
    TABLE: TABLE,
    toRow: toRow,
    fromRow: fromRow,
    fetchAll: fetchAll,
    upsert: upsert,
    upsertMany: upsertMany,
    removeByClientId: removeByClientId,
    updateFlags: updateFlags,
};
