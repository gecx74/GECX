// 行程标题的可选内容：原「备注类型」的 19 项原样保留并排在前面，新增「旅行」「郊游」追加在末尾
const noteOptions = require('./note-options.js');

const EXTRA_TITLE_OPTIONS = ['旅行', '郊游'];

const TITLE_OPTIONS = noteOptions.NOTE_OPTIONS.concat(EXTRA_TITLE_OPTIONS);

function isValidTitleOption(value) {
    return TITLE_OPTIONS.indexOf(value) >= 0;
}

module.exports = {
    TITLE_OPTIONS: TITLE_OPTIONS,
    EXTRA_TITLE_OPTIONS: EXTRA_TITLE_OPTIONS,
    isValidTitleOption: isValidTitleOption,
};
