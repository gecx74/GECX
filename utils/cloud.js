/**
 * 云服务客户端（全局单例）
 *
 * 初始化参数来自 WorkBuddy 云服务下发的 publicConfig：
 *   endpoint        —— 当前应用的数据面网关，必须显式传入（小程序没有同源回退）
 *   publishableKey  —— 标识「哪个应用」，本身不含权限；服务器按 Origin 校验
 *
 * 说明：
 * - SDK 延迟加载：只有真正用到云服务时才 require，避免本地模式下页面因构建产物缺失而崩溃。
 * - 请求诊断包装：失败请求会在 vConsole 打印 [WorkBuddy Cloud] request failed，
 *   便于在真机上定位「域名未加入白名单 / 403」这类问题。
 */

const PUBLIC_CONFIG = {
    endpoint: 'https://mp-api.app.workbuddy.host',
    publishableKey: 'wbpk_WrhYwaxsvhrtH6lx2cs9Uk_sDZVyQIGKAS3P6iCVbXg78pEiP6BCyHO',
};

let client = null;
let sdk = null;

function loadSdk() {
    if (sdk) {
        return sdk;
    }
    // 必须用 /miniprogram 子路径的工厂，不要手动拼 fetch 或 polyfill
    sdk = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
    return sdk;
}

/**
 * 获取云客户端；SDK 不可用时返回 null，调用方按「未开启云同步」处理
 */
function getCloud() {
    if (client) {
        return client;
    }
    try {
        const loaded = loadSdk();
        const createDiagnosticWx = require('./workbuddy-cloud-diagnostics.js').createDiagnosticWx;
        client = loaded.createMiniProgramWorkBuddyCloud({
            endpoint: PUBLIC_CONFIG.endpoint,
            publishableKey: PUBLIC_CONFIG.publishableKey,
            wx: createDiagnosticWx(wx),
        });
        return client;
    } catch (error) {
        return null;
    }
}

function isAvailable() {
    return !!getCloud();
}

module.exports = {
    PUBLIC_CONFIG: PUBLIC_CONFIG,
    getCloud: getCloud,
    isAvailable: isAvailable,
};
