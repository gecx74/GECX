// 解析器回归测试（不参与小程序打包，放在 .workbuddy 下）
// 运行：node .workbuddy/tests/parser.test.js
const parser = require('../../utils/parser.js');

const BASE = new Date(2026, 10, 14); // 2026-11-14 周六

const cases = [
    ['下周二 总部会议 下午3点', '2026-11-17', '15:00'],
    ['14号交材料', '2026-11-14', ''],
    ['17号 医院复查', '2026-11-17', ''],
    ['5号 缴水电费', '2026-12-05', ''],
    ['周三 客户拜访', '2026-11-18', ''],
    ['下周一 例会', '2026-11-16', ''],
    ['下周日 家庭聚餐', '2026-11-22', ''],
    ['这周五 复盘', '2026-11-13', ''],
    ['下下周三 培训', '2026-11-25', ''],
    ['1月5日 年会', '2027-01-05', ''],
    ['11月10日 补录事项', '2026-11-10', ''],
    ['2026年12月1日 上午9点 出差', '2026-12-01', '09:00'],
    ['2026-12-31 跨年', '2026-12-31', ''],
    ['下个月5号 交报告', '2026-12-05', ''],
    ['本月20号 体检', '2026-11-20', ''],
    ['明天下午3点半 开会', '2026-11-15', '15:00'],
    ['大后天 9:30 出发', '2026-11-17', '09:30'],
    ['31号 月结', '2026-12-31', ''],
    ['2月30日 不存在的日期', '', ''],
    ['3号线维修', '', ''],
    ['在3号会议室开会', '', ''],
    ['周末去郊游', '', ''],
];

let pass = 0;
let fail = 0;
cases.forEach(function (item) {
    const result = parser.parse(item[0], BASE);
    const dateOk = result.date === item[1];
    const timeOk = result.time === item[2];
    if (dateOk && timeOk) {
        pass += 1;
    } else {
        fail += 1;
        console.log('[FAIL] ' + item[0] + ' -> date=' + (result.date || '(空)') + ' time=' + (result.time || '(空)') +
            ' | 期望 date=' + (item[1] || '(空)') + ' time=' + (item[2] || '(空)'));
    }
});

// 跨年与闰年边界
const boundaries = [
    [new Date(2026, 11, 31), '1号 元旦', '2027-01-01'],
    [new Date(2026, 11, 31), '下周二 复盘', '2027-01-05'],
    [new Date(2026, 1, 20), '31号 结算', '2026-03-31'],
    [new Date(2028, 1, 28), '28号 纪念日', '2028-02-28'],
    [new Date(2028, 1, 29), '28号 已过', '2028-03-28'],
];
boundaries.forEach(function (item) {
    const result = parser.parse(item[1], item[0]);
    if (result.date === item[2]) {
        pass += 1;
    } else {
        fail += 1;
        console.log('[FAIL] 边界 ' + item[1] + '（基准 ' + item[0].toLocaleDateString() + '） -> ' + (result.date || '(空)') + ' 期望 ' + item[2]);
    }
});

console.log('解析器用例：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) {
    process.exit(1);
}
