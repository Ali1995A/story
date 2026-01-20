import { appendMemory } from "@/lib/memories";
import { zhipuTts } from "@/lib/zhipu";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
  let requestId: string | undefined;
  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");
    const model =
      process.env.ZHIPU_VOICE_MODEL?.trim() || "glm-4-voice";
    const endpoint =
      process.env.ZHIPU_VOICE_ENDPOINT?.trim() ||
      "https://open.bigmodel.cn/api/paas/v4/chat/completions";

    const body = (await req.json().catch(() => ({}))) as {
      conversationId?: unknown;
      story?: unknown;
      seed?: unknown;
      history?: unknown;
      inputText?: unknown;
      inputAudioBase64?: unknown;
      inputAudioMime?: unknown;
    };

    const conversationIdRaw =
      typeof body.conversationId === "string" ? body.conversationId : "";
    const conversationId = conversationIdRaw.trim() || crypto.randomUUID();

    const story = clampText(typeof body.story === "string" ? body.story : "", 1200);
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

    const system = buildSystemPrompt();

    const userTextBlock = [
      `故事（作为话题背景）：\n${story}`,
      seed ? `孩子的输入种子（可选参考）：${seed}` : "",
      historyText.length
        ? `最近对话（供你保持上下文）：\n${historyText
            .map((m) => `${m.role === "user" ? "孩子" : "海皮"}：${m.content}`)
            .join("\n")}`
        : "",
      inputText ? `孩子这次说/写的是：${inputText}` : "",
      inputAudioBase64
        ? "孩子这次是语音输入：请尽力听懂，并自然地回应。"
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
          mime: inputAudioMime || undefined,
        },
      });
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Number(process.env.ZHIPU_VOICE_TIMEOUT_MS ?? process.env.ZHIPU_TIMEOUT_MS ?? "30000"));
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

    requestId = res.headers.get("x-request-id") ?? undefined;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Zhipu voice chat failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
      );
    }

    const json = (await res.json()) as unknown;
    const assistantText =
      getNestedString(json, ["choices", 0, "message", "content"]) ??
      getNestedString(json, ["choices", 0, "delta", "content"]) ??
      getNestedString(json, ["data", "choices", 0, "message", "content"]) ??
      "";

    const textOut = clampText(assistantText, 800);
    if (!textOut) {
      throw new Error("Voice chat returned empty content");
    }

    const extracted = extractAudioFromJson(json);
    let assistantAudioBase64 = extracted.audioBase64;
    let assistantAudioMime = extracted.mime;

    if (!assistantAudioBase64) {
      const ttsModel = process.env.ZHIPU_TTS_MODEL?.trim();
      const ttsEndpoint =
        process.env.ZHIPU_TTS_ENDPOINT?.trim() ||
        "https://open.bigmodel.cn/api/paas/v4/audio/speech";
      const ttsVoice = process.env.ZHIPU_TTS_VOICE?.trim() || undefined;
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
        });
        assistantAudioBase64 = tts.audioBase64;
        assistantAudioMime = tts.audioMime;
        requestId = tts.requestId ?? requestId;
      }
    }

    try {
      await appendMemory({
        kind: "chat",
        seed,
        story,
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
      { headers: { "Cache-Control": "no-store" } },
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
