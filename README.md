# 粉粉故事机（Vercel / iPad / WeChat）

一个适合 5 岁左右、还不认识文字的小朋友使用的网页小玩具：随便乱按输入法 → 生成短故事 → 朗读播放；听完还能「按住说话」继续和“海皮老师”聊。

本项目偏“设备兼容优先”：目标环境是 iPad / iOS Safari / 微信内置浏览器（音频播放、录音权限等限制很多）。

## 你能得到什么

- 一个大输入框：随便敲（乱码/随机字/表情都可以）
- 一键生成：用智谱（Zhipu）LLM 把“种子”组织成短故事（默认严格中文+标点输出）
- 语音播放：故事合成音频并播放（为避免 Vercel 超时，故事生成与 TTS 拆分为两个接口）
- 双语模式：同一个种子会生成中文故事 + 英文故事（英文为“直接生成”，不是把中文翻译成英文）
- 朗读切换：默认中文朗读；右侧「听」按钮旁边有个语言按钮（`ABC` / `中`），一键切换并立即朗读对应语言
- 海皮老师：围绕刚生成的故事做多轮对话（支持语音输入；上游不支持时自动降级到文本+TTS）
- 成长记录：把每次故事与对话写入 JSONL，可在 `/admin` 查看与导出
- 适配细节：尽量处理 iOS/微信的“必须用户手势触发音频/需要先解锁音频会话”等限制

## 技术栈

- Next.js（App Router）+ TypeScript
- React 19
- Tailwind CSS v4
- Server runtime：`nodejs`（API 路由在 Node 运行时）

## 快速开始（本地）

前置：Node.js（建议 20+）

```bash
npm i
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`

### 常用脚本

- `npm run dev`：本地开发
- `npm run build`：构建
- `npm run start`：运行构建产物
- `npm run lint`：ESLint

## 环境变量

把这些配置到 `.env.local`（本地）或 Vercel Project Settings → Environment Variables（线上）。

### 必填

- `ZHIPU_API_KEY`：智谱 API Key（服务端调用）
- `STORY_ADMIN_TOKEN`：后台查看成长记录的 token（用于 `/admin`、`/api/memories`、`/api/health`）

### 建议填写

- `ZHIPU_CHAT_MODEL`：生成故事/文本对话的模型（默认 `glm-4.7`）
- `STORY_EN_CHAT_MODEL`：可选，本应用英文故事/英文对话用的模型（不填则复用 `ZHIPU_CHAT_MODEL`；通常不需要配置，GLM 模型可兼容中英文）
- `ZHIPU_TTS_MODEL`：TTS 模型（不填则禁用“智谱语音合成”，UI 会回退到系统朗读；推荐 `glm-tts`）
- `ZHIPU_TTS_ENDPOINT`：TTS 接口地址（默认 `https://open.bigmodel.cn/api/paas/v4/audio/speech`）
- `ZHIPU_TTS_VOICE`：可选音色（不填/留空表示使用默认音色）
- `STORY_EN_TTS_VOICE`：可选英文音色（不填则复用 `ZHIPU_TTS_VOICE`；通常不需要配置）
- `ZHIPU_VOICE_MODEL`：可选，语音对话模型（默认 `glm-4-voice`）
- `ZHIPU_VOICE_ENDPOINT`：可选，语音对话接口地址（默认 `https://open.bigmodel.cn/api/paas/v4/chat/completions`）
- `STORY_EN_VOICE_MODEL` / `STORY_EN_VOICE_ENDPOINT`：可选英文语音对话配置（不填则复用中文配置；通常不需要配置）

### 成长记录存储（2 选 1）

#### 方案 A：本地 JSONL（默认）

- `STORY_LOG_PATH`：可选，记录文件路径（默认 `data/memories.jsonl`）

说明：这是追加写入的 JSONL（每行一条 JSON）。适合本机或带持久化磁盘的部署环境。

#### 方案 B：远端日志服务（推荐用于 Vercel）

> 因为 Vercel 默认无持久化磁盘，本地文件不会长期保存。

- `STORY_REMOTE_LOG_URL`：远端存储服务 base URL（例如 `https://mem.example.com/story-memories`）
- `STORY_REMOTE_LOG_TOKEN`：远端存储服务 token（Bearer）
- `STORY_REMOTE_LOG_TIMEOUT_MS`：可选，默认 `2000`

约定：远端服务需要提供这几个接口（应用会按此调用）：

- `POST {base}/append`：写入一条记录（JSON body）
- `GET {base}/memories?limit=200`：读取最近 N 条记录（返回 `{ ok: true, memories: [...] }`）
- `GET {base}/healthz`：健康检查（`200` 表示可用）

## 部署到 Vercel

1. 推送到 GitHub
2. Vercel 新建项目，选择该仓库
3. 在 Vercel 配置环境变量（见上）
4. Deploy

注意：Vercel 修改 Environment Variables 后，需要 Redeploy 才会生效。

## 使用说明（面向 iPad / 微信）

### 生成故事与播放

1. 在输入框随便敲点字符（越“乱”越好玩）
2. 点「开始」
3. 如果能自动播放音频，会直接朗读
4. 如果 iOS/微信阻止自动播放：点一下右侧喇叭按钮（或随便点一下屏幕），再试一次
5. 想切换英文朗读：点右侧喇叭旁边的语言按钮（`ABC`/`中`），会立刻切换并开始朗读

### 海皮老师语音对话（按住说话）

生成故事后右侧会出现对话区：

- 按住说话（录音），松开后发送
- 需要麦克风权限（微信内置浏览器也可以授权）
- 录音会在浏览器端尽量转为 WAV（单声道 / 16kHz / 最长 8 秒）再上传，以兼容语音模型接口
- 如果语音上游不接受音频输入：服务端会自动回退到“文本模型回答 + TTS 合成”，对话不中断

## 成长记录（后台）

记录内容：

- 每次生成故事：写入同一个 `generationId` 下的「seed + storyZh + storyEn」（旧数据可能是两条记录：一条 zh、一条 en；后台会自动合并展示）
- 每次对话：写入「lang + generationId + seed + story（当前语言作为背景）+ 孩子输入（文字或语音标记）+ 海皮回复」

查看方式：

- 打开 `/admin`，输入 `STORY_ADMIN_TOKEN`，点击加载
- 或直接调用：`GET /api/memories?limit=200`，请求头带 `Authorization: Bearer <STORY_ADMIN_TOKEN>`

## API 说明（排查/对接用）

> 所有接口都返回 JSON；错误时 `ok: false`，并带 `error` 字段。

### `POST /api/generate-bilingual`（推荐）

一次请求同时生成中文故事 + 英文故事（用于双语展示与双语朗读）。

请求：

```bash
curl -sS -X POST http://localhost:3000/api/generate-bilingual \
  -H "Content-Type: application/json" \
  -d "{\"seed\":\"qwe🙂123\"}"
```

响应（成功）：

```json
{ "ok": true, "generationId": "...", "seed": "...", "storyZh": "……", "storyEn": "…", "requestId": "..." }
```

### `POST /api/generate`（legacy）

只生成故事文字（不做 TTS）。

请求：

```bash
curl -sS -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d "{\"seed\":\"qwe🙂123\"}"
```

响应（成功）：

```json
{ "ok": true, "story": "……", "requestId": "..." }
```

响应（失败）：

```json
{ "ok": false, "error": "Missing env: ZHIPU_API_KEY" }
```

### `POST /api/generate-en`

只生成英文故事文字（不做 TTS）。目前主要作为 legacy / 备用接口。

请求：

```bash
curl -sS -X POST http://localhost:3000/api/generate-en \
  -H "Content-Type: application/json" \
  -d "{\"seed\":\"qwe🙂123\"}"
```

### `POST /api/tts`

把故事文字合成语音（默认返回 `wav` 的 base64）。

请求：

```bash
curl -sS -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d "{\"story\":\"森林里啾啾响。小兔有个小愿望。……\",\"lang\":\"zh\"}"
```

响应（成功）：

```json
{ "ok": true, "audioBase64": "...", "audioMime": "audio/wav", "lang": "zh", "requestId": "..." }
```

如果未配置 `ZHIPU_TTS_MODEL`，接口会返回 `400` 并提示缺少配置；UI 会自动回退到系统朗读。

### `POST /api/chat`

围绕故事做多轮对话。支持文字输入或语音输入（base64）。通过 `lang` 跟随中文/英文。

请求（文字）：

```bash
curl -sS -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"lang\":\"zh\",\"story\":\"……\",\"seed\":\"abc\",\"history\":[],\"inputText\":\"我喜欢小兔\"}"
```

响应（成功）：

```json
{
  "ok": true,
  "conversationId": "...",
  "assistantText": "……",
  "assistantAudioBase64": "...",
  "assistantAudioMime": "audio/wav",
  "requestId": "..."
}
```

说明：

- 优先走“语音对话上游”（`ZHIPU_VOICE_MODEL`）；上游失败会自动降级到文本模型，再用 TTS 补音频（若配置了 `ZHIPU_TTS_MODEL`）
- 响应头会带 `x-haipi-upstream: voice|chat_fallback`（方便排查）

### `GET /api/memories`

读取成长记录（需要管理员 token）。

```bash
curl -sS "http://localhost:3000/api/memories?limit=200" \
  -H "Authorization: Bearer <STORY_ADMIN_TOKEN>"
```

### `GET /api/health`

查看线上环境变量缺失情况 + 远端存储健康状态（不会返回密钥本身）。

```bash
curl -sS "http://localhost:3000/api/health?token=<STORY_ADMIN_TOKEN>"
```

## 目录结构（关键文件）

- UI：`src/components/StoryToy.tsx`
- 页面：`src/app/page.tsx`、`src/app/layout.tsx`、`src/app/globals.css`
- 生成故事：`src/app/api/generate/route.ts`
- 生成英文故事：`src/app/api/generate-en/route.ts`
- 双语生成（推荐）：`src/app/api/generate-bilingual/route.ts`
- TTS：`src/app/api/tts/route.ts`
- 语音对话：`src/app/api/chat/route.ts`
- 成长记录：`src/lib/memories.ts`、`src/app/api/memories/route.ts`、`src/app/admin/page.tsx`
- 健康检查：`src/app/api/health/route.ts`
- 智谱封装：`src/lib/zhipu.ts`

## 常见问题（Troubleshooting）

### 1）点了「开始」但没声音

- iOS/微信经常禁止“非用户手势触发”的自动播放：点一下喇叭按钮或随便点一下屏幕再试
- 未配置 `ZHIPU_TTS_MODEL` 时，服务端 TTS 会不可用：UI 会回退到系统朗读（如果设备支持）

### 2）按住说话没反应 / 一直卡在“正在发送”

- 先确认麦克风权限已授予
- 部分 iOS/微信对 `MediaRecorder` 兼容较差：前端有 watchdog 与降级文案，仍可继续对话

### 3）Vercel 上成长记录为空

- Vercel 无持久化磁盘：请使用远端日志服务（`STORY_REMOTE_LOG_URL` + `STORY_REMOTE_LOG_TOKEN`）或换带持久化的部署环境

## 安全提示

- `STORY_ADMIN_TOKEN` 等同于后台权限，请妥善保管，不要写进前端代码或提交到 Git
- 本项目不会在接口返回中暴露 `ZHIPU_API_KEY`，但你仍应把密钥仅配置在服务端环境变量中
