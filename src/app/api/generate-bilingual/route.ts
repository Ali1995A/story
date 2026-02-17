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

function stableChoice<T>(seed: string, items: T[]) {
  let acc = 0;
  for (let i = 0; i < seed.length; i += 1) acc = (acc + seed.charCodeAt(i)) >>> 0;
  const idx = items.length ? acc % items.length : 0;
  return (items[idx] ?? items[0]) as T;
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
  const places = ["森林", "海边", "花园", "雪地", "云朵城", "蘑菇屋", "彩虹桥", "星星草地"];
  const animals = ["小兔", "小熊", "小鹿", "小猫", "小狗", "小企鹅", "小狐狸", "小松鼠"];
  const items = [
    "魔法叶",
    "小铃铛",
    "彩色石",
    "泡泡棒",
    "星星贴",
    "会笑的帽子",
    "会跳的纽扣",
    "会唱的贝壳",
  ];
  const sounds = ["啾啾", "咕噜", "呼呼", "叮叮", "哗啦", "咚咚", "沙沙", "噗噗"];
  const helpers = ["小鸟", "小青蛙", "小刺猬", "小海豹", "小瓢虫", "小松鼠"];
  const obstacles = ["小水坑", "迷路弯", "滑滑泥", "大叶门", "风呼呼", "雨点点"];
  const magics = ["发光", "变色", "唱歌", "跳舞", "飘起来", "变软软", "变圆圆"];
  const rewards = ["一颗星星", "一朵小花", "一个拥抱", "一枚徽章", "一块小饼"];
  const showHooks = [
    { name: "旺旺队", vibe: "救援" },
    { name: "超级飞侠", vibe: "送快递" },
    { name: "小猪佩奇", vibe: "日常" },
    { name: "巴巴爸爸一家人", vibe: "变形" },
  ];

  const place = stableChoice(`${seed}-p`, places);
  const animal = stableChoice(seed, animals);
  const item = stableChoice(seed.split("").reverse().join(""), items);
  const s1 = stableChoice(`${seed}-s`, sounds);
  const helper = stableChoice(`${seed}-h`, helpers);
  const obstacle = stableChoice(`${seed}-o`, obstacles);
  const magic = stableChoice(`${seed}-m`, magics);
  const reward = stableChoice(`${seed}-r`, rewards);
  const hook = stableChoice(`${seed}-show`, showHooks);
  const hookLine =
    hook.vibe === "救援"
      ? `${hook.name}来帮忙。`
      : hook.vibe === "送快递"
        ? `${hook.name}送来礼物。`
        : hook.vibe === "日常"
          ? `${hook.name}一起玩。`
          : `${hook.name}变出办法。`;

  const lines = [
    `${place}里${s1}响。`,
    `${animal}有个小愿望。`,
    `它要找${item}。`,
    `路上有${obstacle}。`,
    hookLine,
    `${helper}也来帮忙。`,
    `它们想个小办法。`,
    `${item}忽然${magic}。`,
    `问题一下就好了。`,
    `${animal}得到${reward}。`,
    `大家挥手说再见。`,
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
  const places = [
    "forest",
    "beach",
    "flower garden",
    "snowy hill",
    "cloud city",
    "mushroom house",
    "rainbow bridge",
    "star meadow",
  ];
  const animals = ["Bunny", "Bear", "Deer", "Kitten", "Puppy", "Penguin", "Fox", "Squirrel"];
  const items = [
    "magic leaf",
    "tiny bell",
    "colorful stone",
    "bubble wand",
    "star sticker",
    "smiling hat",
    "bouncy button",
    "singing shell",
  ];
  const sounds = [
    "tweet tweet",
    "rumble",
    "whoosh",
    "ding ding",
    "swish swish",
    "tap tap",
    "puff puff",
  ];
  const helpers = ["Bird", "Frog", "Hedgehog", "Seal", "Ladybug", "Sparrow"];
  const obstacles = ["a small puddle", "a windy path", "a tricky turn", "a sticky spot", "a big leaf gate"];
  const magics = ["glows", "changes color", "sings", "dances", "floats up", "gets soft"];
  const rewards = ["a tiny star", "a small flower", "a warm hug", "a little badge", "a yummy cookie"];
  const showHooks = [
    { name: "Paw Patrol", vibe: "rescue" },
    { name: "Super Wings", vibe: "delivery" },
    { name: "Peppa Pig", vibe: "daily" },
    { name: "Barbapapa family", vibe: "shape" },
  ];

  const place = stableChoice(`${seed}-p`, places);
  const animal = stableChoice(seed, animals);
  const item = stableChoice(seed.split("").reverse().join(""), items);
  const s1 = stableChoice(`${seed}-s`, sounds);
  const helper = stableChoice(`${seed}-h`, helpers);
  const obstacle = stableChoice(`${seed}-o`, obstacles);
  const magic = stableChoice(`${seed}-m`, magics);
  const reward = stableChoice(`${seed}-r`, rewards);
  const hook = stableChoice(`${seed}-show`, showHooks);
  const hookLine =
    hook.vibe === "rescue"
      ? `${hook.name} comes to help.`
      : hook.vibe === "delivery"
        ? `${hook.name} brings a small delivery.`
        : hook.vibe === "daily"
          ? `${hook.name} joins the play.`
          : `${hook.name} shapes a smart idea.`;

  const lines = [
    `In the ${place}, ${s1}.`,
    `${animal} has a small wish.`,
    `${animal} wants to find a ${item}.`,
    `On the way, there is ${obstacle}.`,
    hookLine,
    `${helper} comes to help too.`,
    `They try a tiny idea.`,
    `The ${item} suddenly ${magic}.`,
    `The problem feels easy now.`,
    `${animal} gets ${reward}.`,
    `They wave and say see you next time.`,
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
      "多样性与内容元素（两种语言故事都要满足）：",
      "- 每次故事必须包含：明确地点、主角小动物、一个具体道具或小魔法、一个小阻碍、一个小收获",
      "- 地点不要总是森林：从这些场景中选 1 个写进去，并在英文里用对应英文表达：森林forest、海边beach、花园flower garden、雪地snowy hill、云朵城cloud city、蘑菇屋mushroom house、彩虹桥rainbow bridge、星星草地star meadow",
      "- “新奇点”必须至少有 1 个，而且每次尽量不同：会唱歌的贝壳、会打嗝的泡泡、会变色的叶子、会跳舞的石头、会发光的帽子、会转圈的铃铛、会变软的云朵、会飞的贴纸",
      "- 记忆钩子：每次必须融入 1 个孩子熟悉的动画元素（只选 1 个系列，不要混搭多个系列；必须原创剧情，不能复述或改写现成剧集）",
      "  - 中文故事：只能用中文名，从以下任选 1 个并写进正文：旺旺队、超级飞侠、小猪佩奇、巴巴爸爸一家人",
      "  - English story: pick 1 and write it in the story text: Paw Patrol, Super Wings, Peppa Pig, Barbapapa family",
      "  - 系列典型元素（写法要像“借了感觉”，但剧情必须全新）：",
      "    - 旺旺队 / Paw Patrol：小救援任务、队友分工、工具车或小装备、帮助别人解决小麻烦",
      "    - 超级飞侠 / Super Wings：送快递到某个地方、带来需要的小物件、途中小阻碍、准时送达并开心",
      "    - 小猪佩奇 / Peppa Pig：日常家庭场景、去公园或玩泥巴或小聚会、遇到一点小状况、轻松解决",
      "    - 巴巴爸爸一家人 / Barbapapa family：变形能力当作“解决办法”，把东西变成需要的形状来帮忙",
      "  - 控制出现方式：点到 1~2 个角色/载具/能力/道具即可；不要出现口号台词；不要提“这一集/动画片里”",
      "- 禁止为了凑句子：每句都必须推动剧情（出现动作或变化），不要连续多句只形容“很开心很漂亮”",
      "- 避免雷同句式：不要反复使用“忽然一片叶子发光”“大家笑得圆圆的”“约好再冒险”等固定模板",
      "- 句子开头尽量变化：不要连续多句都以“它”或同一个主语开头",
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
