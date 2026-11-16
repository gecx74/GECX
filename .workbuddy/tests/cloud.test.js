/**
 * 云服务数据层测试：字段映射 + 本地/云端合并规则
 * 运行：node .workbuddy/tests/cloud.test.js
 */

// 这些模块只在函数内部访问 wx，require 阶段不依赖运行环境
const cloudTrips = require('../../utils/cloud-trips.js');
const sync = require('../../utils/sync.js');

let pass = 0;
let fail = 0;

function check(name, condition, extra) {
    if (condition) {
        pass += 1;
        console.log('PASS | ' + name);
    } else {
        fail += 1;
        console.log('FAIL | ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
    }
}

const startTime = new Date(2026, 11, 20, 15, 0).getTime();

function main() {
    const trip = {
        id: 't_1_abc',
        title: '产品评审会',
        note: 'A栋201',
        category: 'life',
        startTime: startTime,
        remindBefore: 10,
        done: true,
        notified: false,
        startNotified: true,
        updatedAt: startTime - 3600000,
    };

    const row = cloudTrips.toRow(trip, '小李');

    check('云端行不含 owner_id（由 DEFAULT auth.uid() 填充）', !('owner_id' in row), Object.keys(row));
    check('client_id 使用端侧行程 id', row.client_id === 't_1_abc', row.client_id);
    check('开始时间保持毫秒时间戳', row.start_time === startTime, row.start_time);
    check('提醒档位映射为 remind_before', row.remind_before === 10, row.remind_before);
    check('分类与标记位映射正确', row.category === 'life' && row.done === true && row.start_notified === true, row);
    check('owner_name 记录昵称快照', row.owner_name === '小李', row.owner_name);

    const back = cloudTrips.fromRow({
        id: 7,
        owner_id: 'EchhGXFadSANiCSaVim2wQ',
        owner_name: '小李',
        client_id: 't_1_abc',
        title: '产品评审会',
        note: 'A栋201',
        category: 'life',
        start_time: startTime,
        remind_before: 10,
        done: true,
        notified: false,
        start_notified: true,
        created_at: new Date(startTime).toISOString(),
        updated_at: new Date(trip.updatedAt).toISOString(),
    });

    check('云端行还原为本地行程结构', back.id === trip.id && back.startTime === trip.startTime, back);
    check('还原后提醒档位一致', back.remindBefore === 10, back.remindBefore);
    check('还原后标记位一致', back.done === true && back.startNotified === true && back.notified === false, back);
    check('缺少 client_id 的行被丢弃', cloudTrips.fromRow({ title: 'x' }) === null);

    // ---- 合并规则 ----
    const localNewer = { id: 'a', updatedAt: 2000, title: '本地较新' };
    const remoteOlder = { id: 'a', updatedAt: 1000, title: '云端较旧' };
    let result = sync.mergeLists([localNewer], [remoteOlder]);
    check('本地较新：保留本地并进入待上传', result.merged[0].title === '本地较新' && result.pendingUpload.length === 1, result);

    const localOlder = { id: 'b', updatedAt: 1000, title: '本地较旧' };
    const remoteNewer = { id: 'b', updatedAt: 2000, title: '云端较新' };
    result = sync.mergeLists([localOlder], [remoteNewer]);
    check('云端较新：采用云端且不上传', result.merged[0].title === '云端较新' && result.pendingUpload.length === 0, result);

    result = sync.mergeLists([{ id: 'c', updatedAt: 1 }], []);
    check('仅本地存在：保留并待上传', result.merged.length === 1 && result.pendingUpload.length === 1, result);

    result = sync.mergeLists([], [{ id: 'd', updatedAt: 1 }]);
    check('仅云端存在：落入本地缓存', result.merged.length === 1 && result.pendingUpload.length === 0, result);

    result = sync.mergeLists([], []);
    check('双方为空返回空结果', result.merged.length === 0 && result.pendingUpload.length === 0, result);

    result = sync.mergeLists(
        [{ id: 'x', updatedAt: 5000 }, { id: 'y', updatedAt: 100 }],
        [{ id: 'y', updatedAt: 300 }, { id: 'z', updatedAt: 200 }]
    );
    check('混合场景：并集去重且顺序稳定', result.merged.length === 3 && result.pendingUpload.length === 1, result.merged.map((item) => item.id));

    console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败');
    if (fail) {
        process.exitCode = 1;
    }
}

main();
