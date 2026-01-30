import { appendMemory } from "@/lib/memories";
import { zhipuChatCompletions } from "@/lib/zhipu";
import { zhipuTts } from "@/lib/zhipu";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatOk = {
  ok: true;
  conversationId: string;
  assistantText: string;
  assistantAudioBase64?: string;
  assistantAudioMime?: string;
  requestId?: string;
};

type ChatErr = { ok: false; error: string; requestId?: string };

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing env: ${name}`);
  }
  return value.trim();
}

function clampText(input: string, maxLen: number) {
  const s = input.trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return;
  return value as Record<string, unknown>;
}

function getNested(value: unknown, path: (string | number)[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    const record = asRecord(cur);
    if (!record) {
      if (Array.isArray(cur) && typeof key === "number") {
        cur = cur[key];
        continue;
      }
      if (Array.isArray(cur) && typeof key === "string") {
        const idx = Number(key);
        if (Number.isFinite(idx)) {
          cur = cur[idx];
          continue;
        }
      }
      return undefined;
    }
    cur = record[String(key)];
  }
  return cur;
}

function getNestedString(value: unknown, path: (string | number)[]) {
  const v = getNested(value, path);
  return typeof v === "string" ? v : undefined;
}

function extractAudioFromJson(payload: unknown): { audioBase64?: string; mime?: string } {
  const audioBase64 =
    getNestedString(payload, ["audio"]) ??
    getNestedString(payload, ["data", "audio"]) ??
    getNestedString(payload, ["data", "data", "audio"]) ??
    getNestedString(payload, ["choices", 0, "audio"]) ??
    getNestedString(payload, ["data", "choices", 0, "audio"]);

  const mime =
    getNestedString(payload, ["mime"]) ??
    getNestedString(payload, ["data", "mime"]) ??
    getNestedString(payload, ["data", "data", "mime"]) ??
    getNestedString(payload, ["content_type"]) ??
    getNestedString(payload, ["data", "content_type"]);

  return { audioBase64, mime };
}

function audioFormatFromMime(mime: string) {
  const m = mime.toLowerCase().split(";")[0]?.trim();
  if (!m) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("aac")) return "aac";
  return "wav";
}

function buildSystemPrompt() {
  return [
    "你是“海皮”，一名非常有耐心的幼儿园老师，正在和一个5岁孩子语音聊天。",
    "话题来自刚刚听过的故事。",
    "对话目标：用轻松好玩的方式，引导孩子思考、观察、表达；顺便做一点点小科普。",
    "要求：",
    "- 每次回复 1~3 句，短句为主，语气温柔、活泼、鼓励；",
    "- 多提问题，逐步引导，不要一次讲太多；",
    "- 不要说教，不要责备；",
    "- 内容必须非常安全：不恐怖、不暴力、不成人；",
    "- 如果孩子的话听不清/没听懂：先友好确认，再用简单问题让孩子重说；",
    "- 结尾可以留一个小问题，邀请孩子继续说。",
  ].join("\n");
}

function buildSystemPromptEn() {
  return [
    'You are "Haipi", a very patient kindergarten teacher talking with a 5-year-old child.',
    "The topic comes from the story the child just heard.",
    "Goal: guide the child to think, notice, and express in a playful way, with a tiny bit of gentle science facts.",
    "Rules:",
    "- Reply with 1 to 3 short sentences each time.",
    "- Warm, playful, encouraging tone.",
    "- Ask questions and guide step by step. Do not lecture.",
    "- Must be extremely safe: no fear, no violence, no adult content.",
    "- If the child's words are unclear: kindly confirm, then ask a simple question to help them try again.",
    "- You may end with a small question to invite the child to continue.",
  ].join("\n");
}

export async function POST(req: Request) {
  let requestId: string | undefined;
  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");

    const body = (await req.json().catch(() => ({}))) as {
      conversationId?: unknown;
      generationId?: unknown;
      story?: unknown;
      storyZh?: unknown;
      storyEn?: unknown;
      seed?: unknown;
      lang?: unknown;
      history?: unknown;
      inputText?: unknown;
      inputAudioBase64?: unknown;
      inputAudioMime?: unknown;
    };

    const langRaw = typeof body.lang === "string" ? body.lang.trim() : "";
    const lang: "zh" | "en" = langRaw === "en" ? "en" : "zh";

    const model =
      (lang === "en"
        ? process.env.STORY_EN_VOICE_MODEL?.trim()
        : process.env.ZHIPU_VOICE_MODEL?.trim()) || "glm-4-voice";
    const endpoint =
      (lang === "en"
        ? process.env.STORY_EN_VOICE_ENDPOINT?.trim()
        : process.env.ZHIPU_VOICE_ENDPOINT?.trim()) ||
      "https://open.bigmodel.cn/api/paas/v4/chat/completions";

    const conversationIdRaw =
      typeof body.conversationId === "string" ? body.conversationId : "";
    const conversationId = conversationIdRaw.trim() || crypto.randomUUID();

    const generationIdRaw =
      typeof body.generationId === "string" ? body.generationId : "";
    const generationId = clampText(generationIdRaw, 80) || undefined;

    const storyZh = clampText(typeof body.storyZh === "string" ? body.storyZh : "", 1400);
    const storyEn = clampText(typeof body.storyEn === "string" ? body.storyEn : "", 1400);
    const storyLegacy = clampText(typeof body.story === "string" ? body.story : "", 1400);
    const story = clampText(
      lang === "en" ? (storyEn || storyZh || storyLegacy) : (storyZh || storyLegacy),
      1400,
    );
    if (!story) {
      return NextResponse.json<ChatErr>(
        { ok: false, error: "Missing story" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const seed = clampText(typeof body.seed === "string" ? body.seed : "", 200);

    const inputText = clampText(
      typeof body.inputText === "string" ? body.inputText : "",
      300,
    );
    const inputAudioBase64 =
      typeof body.inputAudioBase64 === "string" ? body.inputAudioBase64 : "";
    const inputAudioMime =
      typeof body.inputAudioMime === "string" ? body.inputAudioMime : "";

    const history = Array.isArray(body.history) ? body.history : [];
    const historyText: { role: "user" | "assistant"; content: string }[] = [];
    for (const item of history.slice(-10)) {
      const rec = asRecord(item);
      if (!rec) continue;
      const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : null;
      const content = typeof rec.content === "string" ? rec.content : "";
      if (!role || !content.trim()) continue;
      historyText.push({ role, content: clampText(content, 600) });
    }

    if (!inputText && !inputAudioBase64) {
      return NextResponse.json<ChatErr>(
        { ok: false, error: "Missing inputText or inputAudio" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const system = lang === "en" ? buildSystemPromptEn() : buildSystemPrompt();

    const userTextBlock = [
      lang === "en"
        ? `Story (topic background):\n${story}`
        : `故事（作为话题背景）：\n${story}`,
      seed
        ? lang === "en"
          ? `Seed (optional reference): ${seed}`
          : `孩子的输入种子（可选参考）：${seed}`
        : "",
      historyText.length
        ? lang === "en"
          ? `Recent conversation:\n${historyText
              .map((m) => `${m.role === "user" ? "Kid" : "Haipi"}: ${m.content}`)
              .join("\n")}`
          : `最近对话（供你保持上下文）：\n${historyText
              .map((m) => `${m.role === "user" ? "孩子" : "海皮"}：${m.content}`)
              .join("\n")}`
        : "",
      inputText
        ? lang === "en"
          ? `This time the kid said/wrote: ${inputText}`
          : `孩子这次说/写的是：${inputText}`
        : "",
      inputAudioBase64
        ? lang === "en"
          ? "This time the kid used voice. Please try to understand and respond naturally."
          : "孩子这次是语音输入：请尽力听懂，并自然地回应。"
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const userContent: unknown[] = [{ type: "text", text: userTextBlock }];
    if (inputAudioBase64) {
      userContent.push({
        type: "input_audio",
        input_audio: {
          data: inputAudioBase64,
          format: audioFormatFromMime(inputAudioMime),
          mime: inputAudioMime || undefined,
        },
      });
    }

    let textOut = "";
    let assistantAudioBase64: string | undefined;
    let assistantAudioMime: string | undefined;
    let upstreamMode: "voice" | "chat_fallback" = "voice";
    let voiceRequestId: string | undefined;
    let chatRequestId: string | undefined;
    let ttsRequestId: string | undefined;

    try {
      const controller = new AbortController();
      const t = setTimeout(
        () => controller.abort(),
        Number(process.env.ZHIPU_VOICE_TIMEOUT_MS ?? process.env.ZHIPU_TIMEOUT_MS ?? "30000"),
      );
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: userContent },
            ],
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 800,
          }),
        });
      } finally {
        clearTimeout(t);
      }

      voiceRequestId = res.headers.get("x-request-id") ?? undefined;
      requestId = voiceRequestId ?? requestId;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const snippet = text ? text.slice(0, 800) : "";
        console.error("[/api/chat] voice upstream not ok", {
          status: res.status,
          statusText: res.statusText,
          requestId,
          model,
          endpoint,
          bodySnippet: snippet,
        });
        throw new Error(
          `Zhipu voice chat failed: ${res.status} ${res.statusText}${snippet ? ` - ${snippet}` : ""}`,
        );
      }

      const json = (await res.json()) as unknown;
      const assistantText =
        getNestedString(json, ["choices", 0, "message", "content"]) ??
        getNestedString(json, ["choices", 0, "delta", "content"]) ??
        getNestedString(json, ["data", "choices", 0, "message", "content"]) ??
        "";
      textOut = clampText(assistantText, 800);
      if (!textOut) throw new Error("Voice chat returned empty content");

      const extracted = extractAudioFromJson(json);
      assistantAudioBase64 = extracted.audioBase64;
      assistantAudioMime = extracted.mime;
    } catch (voiceErr) {
      upstreamMode = "chat_fallback";
      // Fallback path: if audio input is not accepted (common on iOS/WeChat), keep the convo alive
      // by responding with a text-only model and then TTS.
      console.warn("[/api/chat] voice failed, falling back to text chat", {
        message: voiceErr instanceof Error ? voiceErr.message : String(voiceErr),
      });
      const chatModel =
        (lang === "en"
          ? process.env.STORY_EN_CHAT_MODEL?.trim()
          : process.env.ZHIPU_CHAT_MODEL?.trim()) || "glm-4.7";
      const { content, requestId: chatReqId } = await zhipuChatCompletions({
        apiKey,
        model: chatModel,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              lang === "en"
                ? `${userTextBlock}\n\n(If the kid's voice is unclear, kindly ask them to try again.)`
                : `${userTextBlock}\n\n（如果孩子的语音听不清，请先温柔地请TA再说一遍。）`,
          },
        ],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 600,
        thinking: { type: "disabled" },
        timeoutMs: Number(
          process.env.ZHIPU_CHAT_TIMEOUT_MS ??
            process.env.ZHIPU_TIMEOUT_MS ??
            (process.env.VERCEL ? "9000" : "30000"),
        ),
      });
      chatRequestId = chatReqId ?? chatRequestId;
      requestId = chatRequestId ?? requestId;
      textOut = clampText(content, 800);
    }

    if (!assistantAudioBase64) {
      const ttsModel = process.env.ZHIPU_TTS_MODEL?.trim();
      const ttsEndpoint =
        process.env.ZHIPU_TTS_ENDPOINT?.trim() ||
        "https://open.bigmodel.cn/api/paas/v4/audio/speech";
      const ttsVoice =
        (lang === "en"
          ? process.env.STORY_EN_TTS_VOICE?.trim()
          : process.env.ZHIPU_TTS_VOICE?.trim()) || undefined;
      if (ttsModel) {
        const tts = await zhipuTts({
          apiKey,
          endpoint: ttsEndpoint,
          model: ttsModel,
          input: textOut,
          voice: ttsVoice,
          response_format: "wav",
          speed: 1.0,
          volume: 1.0,
          timeoutMs: Number(
            process.env.ZHIPU_TTS_TIMEOUT_MS ??
              process.env.ZHIPU_TIMEOUT_MS ??
              (process.env.VERCEL ? "9000" : "30000"),
          ),
        });
        assistantAudioBase64 = tts.audioBase64;
        assistantAudioMime = tts.audioMime;
        ttsRequestId = tts.requestId ?? ttsRequestId;
        requestId = ttsRequestId ?? requestId;
      }
    }

    console.info("[/api/chat] upstream", {
      upstreamMode,
      voiceRequestId,
      chatRequestId,
      ttsRequestId,
      hasAudio: Boolean(assistantAudioBase64),
    });

    try {
      await appendMemory({
        kind: "chat",
        lang,
        generationId,
        seed,
        story,
        storyZh: storyZh || undefined,
        storyEn: storyEn || undefined,
        conversationId,
        kidText: inputText || undefined,
        assistantText: textOut,
        requestId,
        hasAudio: Boolean(assistantAudioBase64),
        userAgent: req.headers.get("user-agent") ?? undefined,
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      });
    } catch {
      // ignore
    }

    return NextResponse.json<ChatOk>(
      {
        ok: true,
        conversationId,
        assistantText: textOut,
        assistantAudioBase64,
        assistantAudioMime,
        requestId,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "x-haipi-upstream": upstreamMode,
          ...(voiceRequestId ? { "x-haipi-voice-request-id": voiceRequestId } : {}),
          ...(chatRequestId ? { "x-haipi-chat-request-id": chatRequestId } : {}),
          ...(ttsRequestId ? { "x-haipi-tts-request-id": ttsRequestId } : {}),
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[/api/chat] error", { message, requestId });
    return NextResponse.json<ChatErr>(
      { ok: false, error: message, requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
