// 截图文字识别（OCR）接口层 —— 本地实现。
// 方案：不依赖云端模型，复用微信客户端自带的「提取文字」能力：
//   1) pickScreenshot 让用户选一张截图，编辑页把它展示出来（<image show-menu-by-longpress>）；
//   2) 用户长按截图选「提取文字」并复制；
//   3) 回到编辑页点「提取填充」，wx.getClipboardData 读取剪贴板文字，交给 parser 解析填充。
// 将来开通云服务后，可在 recognizeImage 里接入 cloud.llm 视觉模型
// （base64 图片 + 提取行程要素的提示词），返回 { ok: true, mode: 'cloud', text } 即可全自动，
// 编辑页只需把展示引导分支换成直接填文本。
function pickScreenshot() {
    return new Promise((resolve) => {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            success: (res) => {
                const file = res.tempFiles && res.tempFiles[0];
                if (!file || !file.tempFilePath) {
                    resolve({ ok: false, reason: 'NO_FILE' });
                    return;
                }
                resolve({ ok: true, mode: 'local', imagePath: file.tempFilePath });
            },
            fail: () => {
                resolve({ ok: false, reason: 'CANCELLED' });
            },
        });
    });
}

// 云服务视觉识别的预留入口：当前返回未开通，编辑页会自动走本地「提取文字」引导
function recognizeImage() {
    return Promise.resolve({
        ok: false,
        mode: 'cloud',
        text: '',
        reason: 'OCR_UNAVAILABLE',
    });
}

module.exports = {
    pickScreenshot: pickScreenshot,
    recognizeImage: recognizeImage,
};
