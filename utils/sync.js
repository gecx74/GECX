/**
 * 云同步编排层
 *
 * 设计原则：
 * - 本地存储始终是「缓存 + 离线可用」：闹钟、日历、列表渲染都走本地，断网也能提醒；
 * - 云端是「账号数据的真源」：开启云同步后，行程以云端为准，本地只是镜像；
 * - 云身份是微信登录（wx.login -> cloud.auth.signInWithWechat），不伪造、不降级；
 * - 本地账号仍然只是本机的一把锁，不参与云端鉴权。
 */

const store = require('./store.js');
const cloudTrips = require('./cloud-trips.js');
const { getCloud } = require('./cloud.js');

const SESSION_KEY = 'trip_reminder_cloud_session_v1';

let cachedSession = null;
let sessionChecked = false;

function sdkReady() {
    return !!getCloud();
}

/**
 * 读取当前云会话（带一次内存缓存）
 * @returns {Promise<{session: Object|null, error: *}>}
 */
function getSession() {
    const cloud = getCloud();
    if (!cloud) {
        return Promise.resolve({ session: null, error: { kind: 'unavailable', message: '云服务未就绪' } });
    }
    return cloud.auth
        .getSession()
        .then(({ data, error }) => {
            sessionChecked = true;
            cachedSession = error ? null : data || null;
            return { session: cachedSession, error: error || null };
        })
        .catch((error) => {
            sessionChecked = true;
            cachedSession = null;
            return { session: null, error: error || { message: '会话读取失败' } };
        });
}

function cachedUser() {
    return cachedSession && cachedSession.user ? cachedSession.user : null;
}

/**
 * 微信一键登录：wx.login 拿 code -> 换云会话
 * @returns {Promise<{ok: boolean, user: Object|null, message: string}>}
 */
function signInWithWeChat() {
    const cloud = getCloud();
    if (!cloud) {
        return Promise.resolve({ ok: false, user: null, message: '当前环境云服务未就绪，请重新构建后再试' });
    }
    return new Promise((resolve) => {
        wx.login({
            success({ code }) {
                if (!code) {
                    resolve({ ok: false, user: null, message: '微信登录失败：未获取到登录凭证' });
                    return;
                }
                let appid = '';
                try {
                    appid = wx.getAccountInfoSync().miniProgram.appId;
                } catch (error) {
                    appid = '';
                }
                cloud.auth
                    .signInWithWechat(code, appid)
                    .then(({ data, error }) => {
                        if (error) {
                            resolve({ ok: false, user: null, message: error.message || '微信登录失败' });
                            return;
                        }
                        cachedSession = data || null;
                        sessionChecked = true;
                        try {
                            wx.setStorageSync(SESSION_KEY, { at: Date.now() });
                        } catch (error) {
                            // 仅作本地提示用，写不进去不影响云会话
                        }
                        resolve({ ok: true, user: cachedSession ? cachedSession.user : null, message: '' });
                    })
                    .catch((error) => {
                        resolve({ ok: false, user: null, message: (error && error.message) || '微信登录失败' });
                    });
            },
            fail(error) {
                resolve({ ok: false, user: null, message: (error && error.errMsg) || '微信登录失败' });
            },
        });
    });
}

function signOut() {
    const cloud = getCloud();
    cachedSession = null;
    sessionChecked = true;
    try {
        wx.removeStorageSync(SESSION_KEY);
    } catch (error) {
        // 忽略
    }
    if (!cloud) {
        return Promise.resolve({ error: null });
    }
    return cloud.auth
        .signOut()
        .then(({ error }) => ({ error: error || null }))
        .catch((error) => ({ error: error || { message: '退出失败' } }));
}

/**
 * 合并本地与云端列表（纯函数，便于测试）
 * 同一 id 取 updatedAt 较新的一条；本地更新但云端没有的，进入待上传列表
 * @param {Array} localList 本地行程
 * @param {Array} remoteList 云端行程
 * @returns {{merged: Array, pendingUpload: Array}}
 */
function mergeLists(localList, remoteList) {
    const localMap = {};
    (localList || []).forEach((trip) => {
        localMap[trip.id] = trip;
    });
    const remoteMap = {};
    (remoteList || []).forEach((trip) => {
        remoteMap[trip.id] = trip;
    });
    const merged = [];
    const pendingUpload = [];
    const ids = Object.keys(localMap).concat(Object.keys(remoteMap).filter((id) => !localMap[id]));
    ids.forEach((id) => {
        const local = localMap[id];
        const remoteTrip = remoteMap[id];
        if (local && remoteTrip) {
            if (Number(remoteTrip.updatedAt) >= Number(local.updatedAt)) {
                merged.push(remoteTrip);
            } else {
                merged.push(local);
                pendingUpload.push(local);
            }
            return;
        }
        if (local) {
            merged.push(local);
            pendingUpload.push(local);
            return;
        }
        merged.push(remoteTrip);
    });
    return { merged: merged, pendingUpload: pendingUpload };
}

/**
 * 拉取云端并合并进本地缓存
 * @returns {Promise<{ok, merged, uploaded, error}>}
 */
async function pull() {
    const localResult = store.list();
    if (localResult.error) {
        return { ok: false, merged: 0, uploaded: 0, error: { message: '本地行程读取失败' } };
    }
    const remote = await cloudTrips.fetchAll();
    if (remote.error) {
        return { ok: false, merged: 0, uploaded: 0, error: remote.error };
    }
    const result = mergeLists(localResult.data, remote.data);
    const merged = result.merged;

    const written = store.replaceAll(merged);
    if (written.error) {
        return { ok: false, merged: 0, uploaded: 0, error: { message: '本地缓存写入失败' } };
    }

    let uploaded = 0;
    if (result.pendingUpload.length) {
        const user = cachedUser();
        const pushed = await cloudTrips.upsertMany(result.pendingUpload, user && user.name);
        if (!pushed.error) {
            uploaded = result.pendingUpload.length;
        }
    }
    return { ok: true, merged: merged.length, uploaded: uploaded, error: null };
}

/**
 * 单条写入云端（新建/编辑后调用）
 */
function pushTrip(trip) {
    if (!trip) {
        return Promise.resolve({ ok: true, error: null });
    }
    const user = cachedUser();
    return cloudTrips
        .upsert(trip, user && user.name)
        .then(({ data, error }) => ({ ok: !error, error: error || null, data: data }))
        .catch((error) => ({ ok: false, error: error || { message: '上传失败' } }));
}

/**
 * 删除云端一条（本地删除后调用）
 */
function removeTrip(id) {
    return cloudTrips
        .removeByClientId(id)
        .then(({ error }) => ({ ok: !error, error: error || null }))
        .catch((error) => ({ ok: false, error: error || { message: '删除失败' } }));
}

/**
 * 同步提醒标记（已提醒/已开始提醒），失败不打扰用户
 */
function pushFlags(id, flags) {
    return cloudTrips.updateFlags(id, flags).then(({ error }) => ({ ok: !error, error: error || null }));
}

function resetCache() {
    cachedSession = null;
    sessionChecked = false;
}

module.exports = {
    sdkReady: sdkReady,
    getSession: getSession,
    cachedUser: cachedUser,
    mergeLists: mergeLists,
    isSignedIn: () => sessionChecked && !!cachedSession,
    signInWithWeChat: signInWithWeChat,
    signOut: signOut,
    pull: pull,
    pushTrip: pushTrip,
    removeTrip: removeTrip,
    pushFlags: pushFlags,
    resetCache: resetCache,
};
