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
  const sleepyTailRe =
    /(晚安|做一个甜甜的梦|进入梦乡|睡吧|闭上眼|做个美梦|安心睡|快去睡)[。.!！]*$/;
  if (!templateRe.test(s) && !sleepyTailRe.test(s)) return story;

  const without = s.replace(templateRe, "").replace(sleepyTailRe, "").replace(/\s+$/g, "");
  const endings = [
    "好啦，故事先收进口袋，我们继续去探险吧！",
    "谢谢你听到这里，下一次我们再遇见新朋友。",
    "咻——魔法火花飞走了，我们也挥挥手说再见。",
    "故事先停在这里，小伙伴们一起开开心心回家啦。",
    "如果你愿意，我们下次再去森林里找宝藏！",
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
      "- 不是睡前故事：不要催眠、不要劝睡、不要说晚安/做梦/闭眼等；结尾用“继续冒险/挥手再见/约好下次”等轻快收束；",
      "- 故事要包含孩子喜欢的元素：森林/小动物/拟人化角色/简单魔法或道具/动画感角色（至少命中其中3项）；",
      "- 情节要有清楚的起因-经过-结果，逻辑自洽，不要跳戏；",
      "- 不能出现恐怖、暴力、血腥、成人内容；",
      "- 不要说教，不要出现“作为AI”之类的话；",
      "- 避免固定模板句式，结尾每次换一种说法；不要使用“晚安我的宝贝，做一个甜甜的梦”。",
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
