/**
 * 云函数：sendReminder
 * 作用：登记行程提醒 → 到点下发订阅消息（微信「服务通知」）
 *
 * 部署前准备：
 * 1. npm 安装依赖：在云函数目录执行 `npm install --production`
 * 2. 云开发控制台建集合 reminder_pushes（权限：仅创建者可读写）
 * 3. 上传函数时勾选「上传触发器」，config.json 里已配每分钟扫描一次
 *
 * 支持 action：
 * - schedule：登记一条待发提醒
 * - cancel：取消某个行程的待发提醒
 * - send：立即发送一条（闹钟响起时前台同步推送）
 * - tick：定时触发器调用，扫描到期记录并发送
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'reminder_pushes';
// 每分钟扫描时，允许补发的最大延迟（避免服务异常后堆积一堆过期提醒）
const LATE_TOLERANCE = 10 * 60 * 1000;
// 非「未订阅」类错误的临时失败重试次数，锁屏提醒宁晚不丢
const MAX_RETRY = 3;

function collection() {
    return db.collection(COLLECTION);
}

async function sendMessage(params) {
    const data = Object.assign({}, params.message || {});
    return cloud.openapi.subscribeMessage.send({
        touser: params.openid,
        templateId: params.templateId,
        page: params.page || 'pages/index/index',
        data: data,
        miniprogramState: params.miniprogramState || 'formal',
        lang: 'zh_CN',
    });
}

async function schedule(event, openid) {
    const payload = event.payload || {};
    if (!payload.id || !payload.startTime) {
        return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    const before = Number(payload.remindBefore) || 0;
    const sendAt = payload.startTime - before * 60000;

    // 同一行程只保留一条待发记录
    await collection()
        .where({ openid: openid, tripId: payload.id, state: 'pending' })
        .remove()
        .catch(() => {});

    const result = await collection().add({
        data: {
            openid: openid,
            tripId: payload.id,
            title: payload.title || '',
            startTime: payload.startTime,
            sendAt: sendAt,
            templateId: event.templateId,
            message: payload.message || {},
            page: payload.page || 'pages/index/index',
            miniprogramState: payload.miniprogramState || 'formal',
            state: 'pending',
            createdAt: Date.now(),
        },
    });
    return { ok: true, id: result._id };
}

async function cancel(event, openid) {
    const tripId = event.payload && event.payload.id;
    if (!tripId) {
        return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    const result = await collection()
        .where({ openid: openid, tripId: tripId, state: 'pending' })
        .remove();
    return { ok: true, removed: result.stats ? result.stats.removed : 0 };
}

async function send(event, openid) {
    const payload = event.payload || {};
    if (!event.templateId || !payload.message) {
        return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    try {
        await sendMessage({
            openid: openid,
            templateId: event.templateId,
            page: payload.page,
            miniprogramState: payload.miniprogramState,
            message: payload.message,
        });
        return { ok: true };
    } catch (error) {
        return { ok: false, reason: 'SEND_FAILED', message: error.errMsg || String(error) };
    }
}

async function tick() {
    const now = Date.now();
    const result = await collection()
        .where({ state: 'pending', sendAt: _.lte(now) })
        .limit(50)
        .get();

    const list = result.data || [];
    let sent = 0;
    for (const record of list) {
        if (now - record.sendAt > LATE_TOLERANCE) {
            await collection().doc(record._id).update({ data: { state: 'expired' } });
            continue;
        }
        try {
            await sendMessage({
                openid: record.openid,
                templateId: record.templateId,
                page: record.page,
                miniprogramState: record.miniprogramState,
                message: record.message,
            });
            await collection().doc(record._id).update({ data: { state: 'sent', sentAt: Date.now() } });
            sent += 1;
        } catch (error) {
            const code = error.errCode || 0;
            // 43101 = 用户未订阅/次数用完，重试无意义；其他错误（网络、频控）延后一分钟重试
            const retry = Number(record.retry) || 0;
            if (code === 43101 || code === 43102 || retry >= MAX_RETRY) {
                await collection()
                    .doc(record._id)
                    .update({ data: { state: 'failed', error: code || error.errMsg || 'unknown' } });
            } else {
                await collection()
                    .doc(record._id)
                    .update({ data: { retry: retry + 1, sendAt: record.sendAt + 60000, error: code || 'retry' } });
            }
        }
    }
    return { ok: true, scanned: list.length, sent: sent };
}

exports.main = async (event) => {
    const action = event.action || 'tick';
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;

    if (action === 'schedule') {
        return schedule(event, openid);
    }
    if (action === 'cancel') {
        return cancel(event, openid);
    }
    if (action === 'send') {
        return send(event, openid);
    }
    if (action === 'status') {
        const total = await collection().where({ openid: openid, state: 'pending' }).count();
        return { ok: true, pending: total.total };
    }
    return tick();
};
