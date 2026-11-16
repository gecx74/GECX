/**
 * 订阅消息（微信服务通知）配置 —— 锁屏提醒的唯一可靠通道
 *
 * 为什么锁屏要靠它：小程序被切到后台/锁屏后 JS 会被系统挂起，本地闹钟的定时器与
 * wx.vibrate 都不会执行；只有服务端下发的「订阅消息」能在锁屏界面弹出通知。
 *
 * 上线前必须补齐三步，缺任一步只保留本地闹钟：
 * 1. 微信公众平台 → 功能 → 订阅消息 → 选用「行程提醒 / 日程提醒」类模板，模板 ID 填到 templateIds；
 *    一次最多填 3 个，授权时一并申请，成功率更高。
 * 2. 开通云开发，环境 ID 填到 cloudEnv，上传 cloudfunctions/sendReminder 并勾选「上传触发器」。
 * 3. 手机系统里允许微信通知（iOS：设置 → 通知 → 微信 → 允许通知 + 锁屏显示）。
 *
 * 一次性订阅 vs 长期订阅：
 * - 长期订阅（longTerm: true）仅部分类目开放，一次授权可长期下发，锁屏最稳；
 * - 一次性订阅每次授权只能发一条，需要在用户创建/修改行程时反复授权。
 */

module.exports = {
    // 兼容旧字段：只选了一个模板时填这里即可
    templateId: '',
    // 推荐用法：填 1~3 个模板 ID，授权时一次性申请全部
    templateIds: [],
    // 你的模板若是长期订阅模板，改成 true（届时只需授权一次）
    longTerm: false,

    cloudEnv: '',
    cloudFunction: 'sendReminder',
    page: 'pages/index/index',
    miniprogramState: 'formal',

    // 模板字段映射：key 固定，value 改成你实际模板里的字段名
    fields: {
        title: 'thing1',
        time: 'time2',
        detail: 'thing3',
        note: 'thing4',
    },
};
