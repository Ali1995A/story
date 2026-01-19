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
- `ZHIPU_VOICE_MODEL`：可选，语音对话模型（默认 `glm-2-voice`）
- `ZHIPU_VOICE_ENDPOINT`：可选，语音对话接口地址（默认 `https://open.bigmodel.cn/api/paas/v4/chat/completions`）
- `STORY_ADMIN_TOKEN`：后台查看成长记录用的 token（用于 `/admin` 和 `/api/memories`）
- `STORY_LOG_PATH`：可选，记录文件路径（默认 `data/memories.jsonl`）
- `STORY_REMOTE_LOG_URL`：可选，远端存储服务地址（例如 `https://mem.cciscc.cc/story-memories`）
- `STORY_REMOTE_LOG_TOKEN`：可选，远端存储服务 token（Bearer）

## 成长记录（后台）

每次生成故事后，会把「种子 + 故事正文」追加写入到 `data/memories.jsonl`（JSONL，一行一条）。

查看方式：

- 打开 `/admin`，输入 `STORY_ADMIN_TOKEN`，点击加载
- 或调用接口：`GET /api/memories?limit=200`，带请求头 `Authorization: Bearer <STORY_ADMIN_TOKEN>`

注意：如果部署在无持久化磁盘的平台（例如 Vercel 默认环境），本地文件可能不会长期保存。要长期记录请使用带持久化存储的部署方式，或把记录路径指向你自己的持久化盘。

如果配置了 `STORY_REMOTE_LOG_URL` + `STORY_REMOTE_LOG_TOKEN`，应用会优先把记录写入远端存储，并从远端读取（更适合 Vercel 这类无持久化磁盘环境）。

## 海皮老师语音对话

生成故事后，右侧会出现「海皮老师聊一聊」：

- 支持麦克风语音输入（需要浏览器/微信授权麦克风权限）
- 也支持打字输入（当语音不可用或听不清时）
- 对话会围绕刚生成的故事，逐步引导孩子思考与小科普

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
