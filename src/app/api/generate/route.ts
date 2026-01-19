import { zhipuChatCompletions, zhipuTts } from "@/lib/zhipu";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type OkResponse = {
  ok: true;
  story: string;
  audioBase64?: string;
  audioMime?: string;
  requestId?: string;
};

type ErrResponse = { ok: false; error: string; requestId?: string };

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

export async function POST(req: Request) {
  let requestId: string | undefined;

  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");
    const chatModel = process.env.ZHIPU_CHAT_MODEL?.trim() || "glm-4.7";
    const ttsModel = process.env.ZHIPU_TTS_MODEL?.trim();
    const ttsEndpoint =
      process.env.ZHIPU_TTS_ENDPOINT?.trim() ||
      "https://open.bigmodel.cn/api/paas/v4/audio/speech";
    const ttsVoice = process.env.ZHIPU_TTS_VOICE?.trim();

    const body = (await req.json().catch(() => ({}))) as { seed?: unknown };
    const seedRaw = typeof body.seed === "string" ? body.seed : "";
    const seed = clampText(seedRaw, 200);
    if (!seed) {
      return NextResponse.json<ErrResponse>(
        { ok: false, error: "请输入一些字符" },
        { status: 400 },
      );
    }

    const system = [
      "你是一个给5岁儿童讲故事的讲述者。",
      "输入是小朋友随便敲键盘得到的乱码/随机文字/表情。",
      "请把这些字符当作“种子”，联想到形象与情节，编一个非常温柔、非常安全的儿童故事。",
      "只输出故事正文，不要输出任何分析、推理过程或步骤。",
      "要求：",
      "- 中文输出；",
      "- 6~10句，短句为主；",
      "- 适合朗读，语气温暖，节奏轻快；",
      "- 不能出现恐怖、暴力、血腥、成人内容；",
      "- 不要说教，不要出现“作为AI”之类的话；",
      "- 结尾要有一句轻轻的晚安/拥抱/谢谢之类的收束。",
    ].join("\n");

    const { content, requestId: chatReqId } = await zhipuChatCompletions({
      apiKey,
      model: chatModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `种子：${seed}` },
      ],
      temperature: 0.9,
      top_p: 0.9,
      max_tokens: 1000,
      thinking: { type: "disabled" },
    });
    requestId = chatReqId ?? requestId;

    const story = clampText(content.replace(/\r\n/g, "\n"), 700);
    if (!ttsModel) {
      return NextResponse.json<OkResponse>(
        {
          ok: true,
          story,
          requestId,
        },
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const tts = await zhipuTts({
      apiKey,
      endpoint: ttsEndpoint,
      model: ttsModel,
      input: story,
      voice: ttsVoice,
      response_format: "wav",
      speed: 1.0,
      volume: 1.0,
    });
    requestId = tts.requestId ?? requestId;

    return NextResponse.json<OkResponse>(
      {
        ok: true,
        story,
        audioBase64: tts.audioBase64,
        audioMime: tts.audioMime,
        requestId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json<ErrResponse>(
      { ok: false, error: message, requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
