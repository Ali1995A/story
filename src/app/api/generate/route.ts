import { zhipuChatCompletions } from "@/lib/zhipu";
import { appendMemory } from "@/lib/memories";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type OkResponse = {
  ok: true;
  story: string;
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

function stableChoice(seed: string, items: string[]) {
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) acc = (acc + seed.charCodeAt(i)) >>> 0;
  const idx = items.length ? acc % items.length : 0;
  return items[idx] ?? "";
}

function rewriteTemplateEnding(story: string, seed: string) {
  const s = story.replace(/\s+$/g, "");
  const templateRe = /晚安我的宝贝[，,]\s*做一个甜甜的梦[。.!！]*$/;
  if (!templateRe.test(s)) return story;

  const without = s.replace(templateRe, "").replace(/\s+$/g, "");
  const endings = [
    "晚安呀，我们明天再一起玩。",
    "轻轻抱抱你，明天见。",
    "谢谢你听到这里，我们下次继续。",
    "晚安，星星会帮你守护梦。",
    "好啦，故事先藏起来，明天再打开。",
  ];
  const tail = stableChoice(seed, endings);
  if (!without) return tail;
  const joiner = /[。.!！]$/.test(without) ? "" : "。";
  return `${without}${joiner}${tail}`;
}

export async function POST(req: Request) {
  let requestId: string | undefined;
  let seedForLog = "";
  let storyForLog = "";

  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");
    const chatModel = process.env.ZHIPU_CHAT_MODEL?.trim() || "glm-4.7";
    // TTS is handled by /api/tts to avoid long single requests on serverless.

    const body = (await req.json().catch(() => ({}))) as { seed?: unknown };
    const seedRaw = typeof body.seed === "string" ? body.seed : "";
    const seed = clampText(seedRaw, 200);
    seedForLog = seed;
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
      "- 结尾要温柔收束（如晚安/拥抱/谢谢），但不要固定模板句式，每次换一种说法；不要使用“晚安我的宝贝，做一个甜甜的梦”。",
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
      timeoutMs: Number(
        process.env.ZHIPU_CHAT_TIMEOUT_MS ??
          process.env.ZHIPU_TIMEOUT_MS ??
          (process.env.VERCEL ? "9000" : "30000"),
      ),
    });
    requestId = chatReqId ?? requestId;

    const story = rewriteTemplateEnding(
      clampText(content.replace(/\r\n/g, "\n"), 700),
      seed,
    );
    storyForLog = story;
    const ipFromHeaders =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    try {
      await appendMemory({
        kind: "story",
        seed: seedForLog,
        story: storyForLog,
        requestId,
        hasAudio: false,
        userAgent: req.headers.get("user-agent") ?? undefined,
        ip: ipFromHeaders,
      });
    } catch {
      // ignore logging failures
    }

    return NextResponse.json<OkResponse>(
      {
        ok: true,
        story,
        requestId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    // Helpful for Vercel function logs; do not include secrets.
    console.error("[/api/generate] error", { message, requestId });
    return NextResponse.json<ErrResponse>(
      { ok: false, error: message, requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
