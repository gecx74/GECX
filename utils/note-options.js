const NOTE_OPTIONS = [
    '总部会议视频会议',
    '分公司条线团客周例会',
    '分公司部门协同会议',
    '保赔协同会',
    '分公司月度会',
    '分公司季度会',
    '行业会议',
    '监管会议',
    '晚餐',
    '午餐',
    '接待经纪公司',
    '接待再保公司',
    '机构视频会',
    '机构调研',
    '拜访客户',
    '出差（火车）',
    '出差（飞机）',
    '出差（自备车）',
    '其他',
];

function isValidNoteType(value) {
    return NOTE_OPTIONS.indexOf(value) >= 0;
}

module.exports = {
    NOTE_OPTIONS: NOTE_OPTIONS,
    isValidNoteType: isValidNoteType,
};
