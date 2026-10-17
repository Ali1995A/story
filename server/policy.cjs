const { textField, enumField, GuardError } = require('./ai-guard.cjs');
const policy = { scope: 'story-paid', perMinute: 60, perDay: 1000, concurrent: 4, maxBodyBytes: 1024 * 1024,
  validate(body) {
    for (const name of ['seed', 'inputText', 'conversationId', 'generationId']) textField(body, name, 2048);
    for (const name of ['story', 'storyZh', 'storyEn']) textField(body, name, 8000);
    enumField(body, 'lang', ['zh', 'en', '']);
    textField(body, 'inputAudioBase64', 768 * 1024);
    textField(body, 'inputAudioMime', 100);
    if (body.inputAudioBase64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(body.inputAudioBase64)) throw new GuardError(400, 'BAD_AUDIO', '请重新录一次短语音。');
    if (body.history !== undefined) {
      if (!Array.isArray(body.history) || body.history.length > 20) throw new GuardError(400, 'BAD_INPUT', '对话内容太长了。');
      for (const item of body.history) { if (!item || typeof item !== 'object') throw new GuardError(400, 'BAD_INPUT', 'Invalid history'); textField(item, 'content', 2000); }
    }
  }
};
module.exports = { policy };
