# 粉粉故事机（Vercel / iPad / WeChat）

一个适合 5 岁左右、还不认识文字的小朋友使用的网页小玩具：随便乱按输入法 → 生成短故事 → 朗读播放。

## 功能

- 一个大输入框：随便敲（乱码/随机字/表情都可以）
- 一键生成：用智谱（Zhipu）LLM 组织成短故事
- 语音播放：将故事转成音频并播放
- 兼容优先：第一代 iPad Pro / iOS Safari / 微信内置浏览器（音频需用户点击触发）

## 本地运行

```bash
npm i
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`

## 环境变量

把这些配置到 `.env.local`（本地）或 Vercel Project Settings → Environment Variables（线上）：

- `ZHIPU_API_KEY`：智谱 API Key
- `ZHIPU_CHAT_MODEL`：生成故事的模型（默认 `glm-4.7`）
- `ZHIPU_TTS_MODEL`：TTS 模型（不填则只返回文字，不会有语音；推荐 `glm-tts`）
- `ZHIPU_TTS_ENDPOINT`：TTS 接口地址（默认 `https://open.bigmodel.cn/api/paas/v4/audio/speech`）
- `ZHIPU_TTS_VOICE`：可选，音色/发音人（按你手上的智谱文档填写）

## 部署到 Vercel

1. 推送到 GitHub
2. Vercel 新建项目，选择该仓库
3. 在 Vercel 配置环境变量（见上）
4. Deploy

## 推送到 GitHub（手动）

```bash
git status
git add .
git commit -m "init: pink story toy"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 代码入口

- UI：`src/components/StoryToy.tsx`
- 接口：`src/app/api/generate/route.ts`
- 智谱封装：`src/lib/zhipu.ts`
