import { zhipuChatCompletions } from "@/lib/zhipu";
import { appendMemory } from "@/lib/memories";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type OkResponse = {
  ok: true;
  story: string;
  lang: "en";
  generationId?: string;
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

function rewriteEnglishTemplateEnding(story: string, seed: string) {
  const s = story.replace(/\s+$/g, "");
  const sleepyTailRe =
    /(good night|sweet dreams|go to sleep|close your eyes|sleep tight)\s*[.!?]*$/i;
  if (!sleepyTailRe.test(s)) return story;

  const without = s.replace(sleepyTailRe, "").replace(/\s+$/g, "");
  const endings = [
    "Now we wave and plan the next adventure.",
    "We smile and promise to explore again soon.",
    "The little friends giggle and walk home together.",
    "The magic sparkles fade, and we say see you next time.",
    "The story pauses here, and our adventure can continue later.",
  ];
  const tail = stableChoice(seed, endings);
  const joiner = /[.!?]$/.test(without) ? " " : ". ";
  return without ? `${without}${joiner}${tail}` : tail;
}

function sanitizeStrictEnglishStory(story: string) {
  // Keep only ASCII letters, spaces, commas, and sentence punctuation.
  let s = story.replace(/\r\n/g, "\n");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[^A-Za-z ,.!?]/g, "");
  s = s.replace(/[!?]/g, ".");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/,{2,}/g, ",").trim();

  const sentences = s
    .split(".")
    .map((x) => x.trim().replace(/,+$/g, "").trim())
    .filter((x) => x.length > 0)
    .slice(0, 10);

  if (sentences.length === 0) return "";
  return `${sentences.join(". ")}.`;
}

function fallbackStrictEnglishStory(seed: string) {
  const animals = ["Bunny", "Bear", "Deer", "Kitten", "Puppy"];
  const items = ["magic leaf", "tiny bell", "colorful stone", "bubble wand", "star sticker"];
  const sounds = ["tweet tweet", "rumble", "whoosh", "ding ding", "swish swish"];
  const animal = stableChoice(seed, animals);
  const item = stableChoice(seed.split("").reverse().join(""), items);
  const s1 = stableChoice(`${seed}-s`, sounds);

  const lines = [
    `In the forest, ${s1}.`,
    `${animal} has a small wish.`,
    `${animal} wants to find a ${item}.`,
    `${animal} walks softly under the trees.`,
    `Little animal friends come to help.`,
    `They look and look with happy steps.`,
    `A leaf suddenly glows bright.`,
    `The ${item} lands in a warm paw.`,
    `Everyone laughs in a round little circle.`,
    `They wave and plan a new adventure.`,
  ];

  const count = Math.max(6, Math.min(10, 6 + (seed.length % 5)));
  return lines.slice(0, count).join(" ");
}

export async function POST(req: Request) {
  let requestId: string | undefined;
  let seedForLog = "";
  let storyForLog = "";
  let generationIdForLog: string | undefined;

  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");
    const chatModel =
      process.env.STORY_EN_CHAT_MODEL?.trim() ||
      process.env.ZHIPU_CHAT_MODEL?.trim() ||
      "glm-4.7";

    const body = (await req.json().catch(() => ({}))) as {
      seed?: unknown;
      generationId?: unknown;
    };
    const seedRaw = typeof body.seed === "string" ? body.seed : "";
    const seed = clampText(seedRaw, 200);
    seedForLog = seed;

    const generationIdRaw =
      typeof body.generationId === "string" ? body.generationId : "";
    const generationId = clampText(generationIdRaw, 80) || undefined;
    generationIdForLog = generationId;

    if (!seed) {
      return NextResponse.json<ErrResponse>(
        { ok: false, error: "Please type a few characters." },
        { status: 400 },
      );
    }

    const system = [
      "You are a gentle storyteller for a 5-year-old child.",
      "The input is random keyboard smash characters from a kid.",
      "Use them as a seed to imagine a safe, warm, and clear short story.",
      "Output only the story text. No analysis. No title. No lists. No numbering. No line breaks.",
      "",
      "Strict format rules:",
      "- The story must use only English letters (A-Z, a-z), spaces, commas, periods, question marks, and exclamation marks.",
      "- No emojis, no numbers, no quotes, no brackets, no colons, no semicolons, no dashes, no ellipses.",
      "- No line breaks.",
      "",
      "Sentence rules:",
      "- 6 to 10 sentences total.",
      "- Short sentences, mostly under 12 words each.",
      "- Each sentence should end with a period.",
      "",
      "Style:",
      "- Read-aloud friendly and warm.",
      "- Light, playful rhythm.",
      "- Use simple words a 5-year-old understands.",
      "- Use cute sound words like tweet tweet, ding ding, whoosh.",
      "- Not a bedtime story: do not mention sleep, dreams, good night, or closing eyes.",
      "- End with a light goodbye and next adventure, not a fixed template.",
      "",
      "Content elements:",
      "- Include at least three of: forest, little animals, a friendly character, simple magic or a small item, cartoon-like feeling.",
      "",
      "Plot logic:",
      "- Clear beginning, middle, end.",
      "- Start with a small wish or small problem.",
      "- A playful search or try.",
      "- A happy solution and a small reward.",
      "- Always safe. No fear. No violence. No injury. No punishment.",
      "",
      "Narration:",
      "- No direct dialogue with quotes.",
      "- If someone speaks, use reported speech.",
      "",
      "Priority if conflict:",
      "- First: allowed characters only.",
      "- Second: 6-10 sentences with periods.",
      "- Third: short sentences.",
    ].join("\n");

    const { content, requestId: chatReqId } = await zhipuChatCompletions({
      apiKey,
      model: chatModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Seed: ${seed}` },
      ],
      temperature: 0.9,
      top_p: 0.9,
      max_tokens: 900,
      thinking: { type: "disabled" },
      timeoutMs: Number(
        process.env.ZHIPU_CHAT_TIMEOUT_MS ??
          process.env.ZHIPU_TIMEOUT_MS ??
          (process.env.VERCEL ? "9000" : "30000"),
      ),
    });
    requestId = chatReqId ?? requestId;

    const raw = rewriteEnglishTemplateEnding(clampText(content, 900), seed);
    let story = sanitizeStrictEnglishStory(raw);
    if (!story) {
      console.warn("[/api/generate-en] strict sanitize produced empty story; using fallback", {
        requestId,
      });
      story = fallbackStrictEnglishStory(seed);
    }
    storyForLog = story;

    const ipFromHeaders =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    try {
      await appendMemory({
        kind: "story",
        lang: "en",
        generationId: generationIdForLog,
        seed: seedForLog,
        story: storyForLog,
        storyEn: storyForLog,
        requestId,
        hasAudio: false,
        userAgent: req.headers.get("user-agent") ?? undefined,
        ip: ipFromHeaders,
      });
    } catch {
      // ignore logging failures
    }

    return NextResponse.json<OkResponse>(
      { ok: true, story, lang: "en", generationId: generationIdForLog, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[/api/generate-en] error", { message, requestId });
    return NextResponse.json<ErrResponse>(
      { ok: false, error: message, requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
