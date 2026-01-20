import { zhipuTts } from "@/lib/zhipu";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type OkResponse = {
  ok: true;
  audioBase64: string;
  audioMime: string;
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
    const ttsModel = process.env.ZHIPU_TTS_MODEL?.trim();
    if (!ttsModel) {
      return NextResponse.json<ErrResponse>(
        { ok: false, error: "Missing env: ZHIPU_TTS_MODEL" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const ttsEndpoint =
      process.env.ZHIPU_TTS_ENDPOINT?.trim() ||
      "https://open.bigmodel.cn/api/paas/v4/audio/speech";
    const ttsVoice = process.env.ZHIPU_TTS_VOICE?.trim() || undefined;

    const body = (await req.json().catch(() => ({}))) as { story?: unknown };
    const storyRaw = typeof body.story === "string" ? body.story : "";
    const story = clampText(storyRaw, 900);
    if (!story) {
      return NextResponse.json<ErrResponse>(
        { ok: false, error: "Missing story" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
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
      { ok: true, audioBase64: tts.audioBase64, audioMime: tts.audioMime, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[/api/tts] error", { message, requestId });
    return NextResponse.json<ErrResponse>(
      { ok: false, error: message, requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

