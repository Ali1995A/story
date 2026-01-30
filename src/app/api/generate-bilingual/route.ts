import { zhipuChatCompletions } from "@/lib/zhipu";
import { appendMemory } from "@/lib/memories";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type OkResponse = {
  ok: true;
  generationId: string;
  seed: string;
  storyZh: string;
  storyEn: string;
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

function sanitizeStrictZhStory(story: string) {
  let s = story.replace(/\s+/g, "");
  s = s.replace(/[？！]/g, "。");
  // Keep only CJK ideographs + allowed punctuation.
  s = s.replace(/[^\u4e00-\u9fff。，？！]/g, "");
  // Enforce "。"-only sentence ending requirement.
  s = s.replace(/[？！]/g, "。");

  const sentences = s
    .split("。")
    .map((x) => x.replace(/，+$/g, ""))
    .filter((x) => x.length > 0)
    .slice(0, 10);

  if (sentences.length === 0) return "";
  return `${sentences.join("。")}。`;
}

function fallbackStrictZhStory(seed: string) {
  const animals = ["小兔", "小熊", "小鹿", "小猫", "小狗"];
  const items = ["魔法叶", "小铃铛", "彩色石", "泡泡棒", "星星贴"];
  const sounds = ["啾啾", "咕噜", "呼呼", "叮叮", "哗啦"];
  const animal = stableChoice(seed, animals);
  const item = stableChoice(seed.split("").reverse().join(""), items);
  const s1 = stableChoice(`${seed}-s`, sounds);

  const lines = [
    `森林里${s1}响。`,
    `${animal}有个小愿望。`,
    `它想找到${item}。`,
    `它轻轻走进树影里。`,
    `小动物们也来帮忙。`,
    `它们找呀找不停。`,
    `忽然一片叶子发光。`,
    `${item}跳到手心里。`,
    `大家笑得圆圆的。`,
    `它们约好再冒险。`,
  ];

  const count = Math.max(6, Math.min(10, 6 + (seed.length % 5)));
  return lines.slice(0, count).join("");
}

function sanitizeStrictEnglishStory(story: string) {
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
    `They wave and plan the next adventure.`,
  ];

  const count = Math.max(6, Math.min(10, 6 + (seed.length % 5)));
  return lines.slice(0, count).join(" ");
}

function safeJsonParse(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    // Some models may wrap JSON in code fences.
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (!fenced) return undefined;
    try {
      return JSON.parse(fenced.trim());
    } catch {
      return undefined;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return;
  return value as Record<string, unknown>;
}

export async function POST(req: Request) {
  let requestId: string | undefined;
  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");
    const chatModel = process.env.ZHIPU_CHAT_MODEL?.trim() || "glm-4.7";

    const body = (await req.json().catch(() => ({}))) as { seed?: unknown; generationId?: unknown };
    const seedRaw = typeof body.seed === "string" ? body.seed : "";
    const seed = clampText(seedRaw, 200);
    if (!seed) {
      return NextResponse.json<ErrResponse>(
        { ok: false, error: "请输入一些字符" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const generationIdRaw =
      typeof body.generationId === "string" ? body.generationId.trim() : "";
    const generationId =
      clampText(generationIdRaw, 80) ||
      (() => {
        try {
          return crypto.randomUUID();
        } catch {
          return `g_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        }
      })();

    const system = [
      "你是一个给5岁儿童讲故事的讲述者。",
      "输入是小朋友随便敲键盘得到的乱码随机文字表情。",
      "你要基于同一个种子，同时生成中文故事和英文故事。",
      "只输出严格 JSON，不要输出任何分析、解释、标题、代码块、换行以外的多余内容。",
      "",
      "JSON 结构：",
      '{ "storyZh": "中文故事", "storyEn": "English story" }',
      "",
      "中文故事规则：",
      "- 只能出现中文汉字和中文标点：句号。逗号，问号？感叹号！",
      "- 禁止空格、英文、数字、表情、引号、括号、书名号、冒号、分号、破折号、省略号、任何特殊符号",
      "- 全文六到十句，短句为主，每句只说一件事，每句尽量不超过十五个字，每句必须用句号结尾",
      "- 不是睡前故事：不要出现晚安、做梦、闭眼、快去睡等内容",
      "",
      "English story rules:",
      "- Use only English letters (A-Z a-z), spaces, commas, periods, question marks, exclamation marks.",
      "- No emojis, numbers, quotes, brackets, colons, semicolons, dashes, ellipses, or special symbols.",
      "- 6 to 10 sentences. Short sentences. Each sentence ends with a period.",
      "- Not a bedtime story: do not mention sleep, dreams, good night, or closing eyes.",
      "",
      "内容元素（两种语言故事都要满足）：",
      "- 至少包含以下元素中的三项：森林、小动物、拟人化角色、简单魔法或道具、动画感角色",
      "",
      "情节逻辑：",
      "- 起因：一个小问题或小愿望",
      "- 经过：轻快的寻找或尝试",
      "- 结果：解决问题并带来开心的小收获",
      "- 全程安全温柔：不恐怖、不暴力、不成人、不受伤、不惩罚",
      "",
      "叙述方式：",
      "- 不能出现任何直接对话格式（不要引号）",
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
      max_tokens: 900,
      thinking: { type: "disabled" },
      timeoutMs: Number(
        process.env.ZHIPU_CHAT_TIMEOUT_MS ??
          process.env.ZHIPU_TIMEOUT_MS ??
          (process.env.VERCEL ? "9000" : "30000"),
      ),
    });
    requestId = chatReqId ?? requestId;

    const parsed = safeJsonParse(content);
    const rec = asRecord(parsed);
    const zhRaw = typeof rec?.storyZh === "string" ? rec.storyZh : "";
    const enRaw = typeof rec?.storyEn === "string" ? rec.storyEn : "";

    let storyZh = sanitizeStrictZhStory(clampText(zhRaw, 900));
    let storyEn = sanitizeStrictEnglishStory(clampText(enRaw, 900));
    if (!storyZh) storyZh = fallbackStrictZhStory(seed);
    if (!storyEn) storyEn = fallbackStrictEnglishStory(seed);

    const ipFromHeaders =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    try {
      await appendMemory({
        kind: "story",
        generationId,
        seed,
        story: storyZh,
        storyZh,
        storyEn,
        requestId,
        hasAudio: false,
        userAgent: req.headers.get("user-agent") ?? undefined,
        ip: ipFromHeaders,
      });
    } catch {
      // ignore logging failures
    }

    return NextResponse.json<OkResponse>(
      { ok: true, generationId, seed, storyZh, storyEn, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[/api/generate-bilingual] error", { message, requestId });
    return NextResponse.json<ErrResponse>(
      { ok: false, error: message, requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
