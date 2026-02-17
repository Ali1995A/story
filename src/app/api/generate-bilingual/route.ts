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
  s = s.replace(/[^\u4e00-\u9fff。，？！、]/g, "");
  // Enforce "。"-only sentence ending requirement.
  s = s.replace(/[？！]/g, "。");

  const sentences = s
    .split("。")
    .map((x) => x.replace(/[，、]+$/g, ""))
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
  const obstacles = ["小水坑", "迷路弯", "滑滑泥", "大叶门", "风呼呼", "雨点点", "大坑", "大石头"];
  const magics = ["发光", "变色", "唱歌", "跳舞", "飘起来", "变软软", "变圆圆"];
  const rewards = ["一颗星星", "一朵小花", "一个拥抱", "一枚徽章", "一块小饼"];
  const showHooks = [
    { name: "旺旺队", vibe: "救援" as const },
    { name: "超级飞侠", vibe: "送快递" as const },
    { name: "小猪佩奇", vibe: "日常" as const },
    { name: "巴巴爸爸一家人", vibe: "变形" as const },
  ];
  const themeWords = ["帮忙", "勇敢", "耐心", "分享", "谢谢"];
  const transformThings = ["梯子", "小桥", "小船", "小伞", "小网", "小绳", "小钩"];
  const deliveryTools = ["小绳钩", "小夹子", "小梯子", "小网兜", "小风扇"];

  const place = stableChoice(`${seed}-p`, places);
  const animal = stableChoice(seed, animals);
  const item = stableChoice(seed.split("").reverse().join(""), items);
  const s1 = stableChoice(`${seed}-s`, sounds);
  const helper = stableChoice(`${seed}-h`, helpers);
  const obstacle = stableChoice(`${seed}-o`, obstacles);
  const magic = stableChoice(`${seed}-m`, magics);
  const reward = stableChoice(`${seed}-r`, rewards);
  const hook = stableChoice(`${seed}-show`, showHooks);
  const theme = stableChoice(`${seed}-t`, themeWords);
  const transformThing = stableChoice(`${seed}-bt`, transformThings);
  const deliveryTool = stableChoice(`${seed}-dt`, deliveryTools);

  const hookLines =
    hook.vibe === "救援"
      ? [`${hook.name}出动救援。`, `它们分工${theme}。`, `它们带来小工具。`]
      : hook.vibe === "送快递"
        ? [`${hook.name}送来快递。`, `包裹里有${deliveryTool}。`, `它说快递准时到。`]
        : hook.vibe === "日常"
          ? [`${hook.name}在这里玩。`, `它们先试一试，可是还不行。`, `它们说要${theme}。`]
          : [`${hook.name}变形帮忙。`, `它变成${transformThing}。`, `它说${theme}最重要。`];

  const lines = [
    `${place}里，${s1}响。`,
    `${animal}有个小愿望。`,
    `它想找${item}。`,
    `可是路上有${obstacle}。`,
    `${animal}试一试，却还是不行。`,
    hookLines[0] ?? `${hook.name}来帮忙。`,
    hookLines[1] ?? `${helper}也来帮忙。`,
    hookLines[2] ?? `它们用${theme}想办法。`,
    hook.vibe === "送快递"
      ? `它用${deliveryTool}拿到${item}。`
      : hook.vibe === "变形"
        ? `它们用${transformThing}拿到${item}。`
        : `它们一起拿到${item}。`,
    `${item}忽然${magic}，亮亮的。`,
    `小麻烦解决了，大家笑。`,
    `${animal}得到${reward}。`,
    `它说${theme}${theme}，谢谢。`,
  ];

  return lines.slice(0, 10).join("");
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
  const obstacles = ["a small puddle", "a windy path", "a tricky turn", "a sticky spot", "a big leaf gate"];
  const magics = ["glows", "changes color", "sings", "dances", "floats up", "gets soft"];
  const rewards = ["a tiny star", "a small flower", "a warm hug", "a little badge", "a yummy cookie"];
  const showHooks = [
    { name: "Paw Patrol", vibe: "rescue" as const },
    { name: "Super Wings", vibe: "delivery" as const },
    { name: "Peppa Pig", vibe: "daily" as const },
    { name: "Barbapapa family", vibe: "shape" as const },
  ];
  const themeWords = ["help", "brave", "patient", "share", "thanks"];
  const transformThings = ["a ladder", "a bridge", "a boat", "an umbrella", "a net", "a rope", "a hook"];
  const deliveryTools = ["a rope hook", "a small clip", "a tiny ladder", "a net bag", "a little fan"];

  const place = stableChoice(`${seed}-p`, places);
  const animal = stableChoice(seed, animals);
  const item = stableChoice(seed.split("").reverse().join(""), items);
  const s1 = stableChoice(`${seed}-s`, sounds);
  const obstacle = stableChoice(`${seed}-o`, obstacles);
  const magic = stableChoice(`${seed}-m`, magics);
  const reward = stableChoice(`${seed}-r`, rewards);
  const hook = stableChoice(`${seed}-show`, showHooks);
  const theme = stableChoice(`${seed}-t`, themeWords);
  const transformThing = stableChoice(`${seed}-bt`, transformThings);
  const deliveryTool = stableChoice(`${seed}-dt`, deliveryTools);

  const hookLines =
    hook.vibe === "rescue"
      ? [`${hook.name} starts a rescue mission.`, `They work as a team to ${theme}.`, `They bring a small tool.`]
      : hook.vibe === "delivery"
        ? [`${hook.name} delivers a package.`, `The package has ${deliveryTool}.`, `They say delivery is on time.`]
        : hook.vibe === "daily"
          ? [`${hook.name} joins the play.`, `They try once, but it still fails.`, `They stay ${theme} and try again.`]
          : [`${hook.name} turns into ${transformThing}.`, `They try, but it is still hard.`, `They stay ${theme} and try again.`];

  const lines = [
    `In the ${place}, ${s1}.`,
    `${animal} has a small wish.`,
    `${animal} wants to find a ${item}.`,
    `But on the way, there is ${obstacle}.`,
    `${animal} tries, but still cannot.`,
    hookLines[0] ?? `${hook.name} comes to help.`,
    hookLines[1] ?? `They try again.`,
    hookLines[2] ?? `They stay ${theme} and try again.`,
    hook.vibe === "delivery"
      ? `They use ${deliveryTool} to get the ${item}.`
      : hook.vibe === "shape"
        ? `They use ${transformThing} to get the ${item}.`
        : `They get the ${item} together.`,
    `The ${item} suddenly ${magic}.`,
    `The problem is fixed, and they smile.`,
    `${animal} gets ${reward}.`,
    `${animal} says ${theme} ${theme} thanks.`,
  ];

  return lines.slice(0, 10).join(" ");
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

type QualityResult = { ok: boolean; reasons: string[] };

function includesAny(haystack: string, needles: string[]) {
  for (const n of needles) {
    if (n && haystack.includes(n)) return true;
  }
  return false;
}

function firstIndexOfAny(haystack: string, needles: string[]) {
  let best = Number.POSITIVE_INFINITY;
  let hit: string | undefined;
  for (const n of needles) {
    const idx = haystack.indexOf(n);
    if (idx >= 0 && idx < best) {
      best = idx;
      hit = n;
    }
  }
  return hit ? { needle: hit, index: best } : undefined;
}

function countIncludes(haystack: string, needles: string[]) {
  let count = 0;
  for (const n of needles) {
    if (n && haystack.includes(n)) count += 1;
  }
  return count;
}

function qualityCheckZh(story: string): QualityResult {
  const s = story.trim();
  const reasons: string[] = [];

  const sentences = s
    .split("。")
    .map((x) => x.trim())
    .filter(Boolean);
  if (sentences.length < 8 || sentences.length > 10) reasons.push("zh_sentence_count");

  const hasMotivation = includesAny(s, ["小愿望", "想", "要", "准备"]);
  if (!hasMotivation) reasons.push("zh_missing_motivation");

  const hasObstacle = includesAny(s, ["挡", "卡", "过不去", "找不到", "拦住", "绕不过", "打不开"]);
  if (!hasObstacle) reasons.push("zh_missing_obstacle");

  const hasTry = includesAny(s, ["试", "想办法", "可是", "却", "但是", "还是", "怎么也"]);
  if (!hasTry) reasons.push("zh_missing_try");

  const hasAction = includesAny(s, ["走", "找", "推", "拉", "跳", "爬", "搬", "拿", "送", "带", "变", "修", "想办法", "帮忙"]);
  if (!hasAction) reasons.push("zh_missing_action");

  const hasClosure = includesAny(s, ["得到", "找到", "解决", "好了", "开心", "笑", "谢谢", "挥手", "再见", "下次", "约好"]);
  if (!hasClosure) reasons.push("zh_missing_closure");
  const lastSentence = sentences[sentences.length - 1] ?? "";
  const lastHasClosure = includesAny(lastSentence, ["开心", "笑", "谢谢", "挥手", "再见", "下次", "约好", "得到", "找到"]);
  if (!lastHasClosure) reasons.push("zh_last_sentence_not_closure");

  const pausePunct = (s.match(/[，、]/g) ?? []).length;
  if (pausePunct < 1) reasons.push("zh_missing_pause_punct");

  const hasCausal = includesAny(s, ["于是", "所以", "因为", "结果", "后来", "这时", "只好"]);
  if (!hasCausal) reasons.push("zh_missing_causal");

  if (includesAny(s, ["要谢谢", "说要谢谢"]) || /说要(帮忙|勇敢|耐心|分享|谢谢)/.test(s)) {
    reasons.push("zh_forced_theme_phrase");
  }

  const themeWords = ["帮忙", "勇敢", "耐心", "分享", "谢谢"];
  const themeHit = themeWords.some((w) => s.includes(w));
  if (!themeHit) reasons.push("zh_missing_theme_word");
  const themeCount = themeWords.reduce((acc, w) => acc + (s.match(new RegExp(w, "g"))?.length ?? 0), 0);
  if (themeCount < 2) reasons.push("zh_theme_not_repeated");

  const seriesKeys = ["汪汪队", "旺旺队", "超级飞侠", "小猪佩奇", "巴巴爸爸一家人", "巴巴爸爸"];
  const seriesCount = countIncludes(s, seriesKeys);
  if (seriesCount < 1 || seriesCount > 2) reasons.push("zh_series_count_invalid");

  const mainSeries =
    firstIndexOfAny(s, ["汪汪队", "旺旺队"])?.needle ||
    firstIndexOfAny(s, ["超级飞侠", "小猪佩奇", "巴巴爸爸一家人", "巴巴爸爸"])?.needle ||
    undefined;
  if (!mainSeries) reasons.push("zh_missing_series");

  // Main series should actively help, not just cameo.
  if (
    mainSeries &&
    !includesAny(s, ["帮忙", "想办法", "送来", "送到", "出动", "变成", "变形", "带来", "修", "救援"])
  ) {
    reasons.push("zh_main_series_not_helping");
  }

  if (mainSeries === "汪汪队" || mainSeries === "旺旺队") {
    if (!includesAny(s, ["救援", "任务", "装备", "工具", "帮忙", "出动"])) reasons.push("zh_pawpatrol_missing_motif");
  } else if (mainSeries === "超级飞侠") {
    const hasDelivery = includesAny(s, ["快递", "包裹", "投递", "送到", "送来", "带来"]);
    const hasToolOrParcel = includesAny(s, ["小物件", "工具", "夹子", "绳", "钩", "梯", "盒", "包裹", "快递"]);
    const hasUse = includesAny(s, ["用", "拿来", "拿着", "装上", "打开"]);
    if (!hasDelivery) reasons.push("zh_superwings_missing_delivery");
    if (!hasToolOrParcel) reasons.push("zh_superwings_missing_tool");
    if (!hasUse) reasons.push("zh_superwings_missing_use");
  } else if (mainSeries === "小猪佩奇") {
    if (!includesAny(s, ["爸爸", "妈妈", "乔治", "弟弟"])) reasons.push("zh_peppa_missing_family");
    if (!includesAny(s, ["家", "公园", "泥", "雨靴", "跳", "滑梯", "野餐"])) reasons.push("zh_peppa_missing_daily_scene");
    if (!includesAny(s, ["帮忙", "想办法", "一起", "试一试"])) reasons.push("zh_peppa_missing_help_action");
  } else if (mainSeries === "巴巴爸爸一家人" || mainSeries === "巴巴爸爸") {
    const hasTransform = includesAny(s, ["变形", "变成", "变出", "变"]);
    const hasIntoThing = includesAny(s, ["变成梯", "变成桥", "变成船", "变成伞", "变成网", "变成车", "变成绳", "变成钩"]);
    if (!hasTransform) reasons.push("zh_barbapapa_missing_transform");
    if (!hasIntoThing) reasons.push("zh_barbapapa_missing_transform_into");
  }

  return { ok: reasons.length === 0, reasons };
}

function qualityCheckEn(story: string): QualityResult {
  const sRaw = story.trim();
  const s = sRaw.toLowerCase();
  const reasons: string[] = [];

  const sentences = sRaw
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean);
  if (sentences.length < 8 || sentences.length > 10) reasons.push("en_sentence_count");

  const hasMotivation = includesAny(s, ["wish", "wants", "want", "plans", "needs"]);
  if (!hasMotivation) reasons.push("en_missing_motivation");

  const hasObstacle = includesAny(s, ["blocked", "stuck", "cannot", "cant", "lost", "no way"]);
  if (!hasObstacle) reasons.push("en_missing_obstacle");

  const hasTry = includesAny(s, ["tries", "try", "but", "still", "however", "cannot", "cant"]);
  if (!hasTry) reasons.push("en_missing_try");

  const hasAction = includesAny(s, ["help", "helps", "bring", "brings", "deliver", "delivers", "use", "uses", "build", "builds", "shape", "shapes", "turn", "turns", "change", "changes"]);
  if (!hasAction) reasons.push("en_missing_action");

  const hasClosure = includesAny(s, ["gets", "finds", "fixed", "happy", "smile", "thanks", "wave", "next time"]);
  if (!hasClosure) reasons.push("en_missing_closure");
  const lastSentence = (sentences[sentences.length - 1] ?? "").toLowerCase();
  const lastHasClosure = includesAny(lastSentence, ["happy", "smile", "thanks", "wave", "next time", "gets", "finds"]);
  if (!lastHasClosure) reasons.push("en_last_sentence_not_closure");

  const hasCausal = includesAny(s, ["so", "because", "then", "later"]);
  if (!hasCausal) reasons.push("en_missing_causal");

  const themeWords = ["help", "brave", "patient", "share", "thanks"];
  const themeHit = themeWords.some((w) => s.includes(w));
  if (!themeHit) reasons.push("en_missing_theme_word");
  const themeCount = themeWords.reduce((acc, w) => acc + (s.match(new RegExp(w, "g"))?.length ?? 0), 0);
  if (themeCount < 2) reasons.push("en_theme_not_repeated");

  const seriesKeys = ["paw patrol", "super wings", "peppa pig", "barbapapa family", "barbapapa"];
  const seriesCount = countIncludes(s, seriesKeys);
  if (seriesCount < 1 || seriesCount > 2) reasons.push("en_series_count_invalid");

  const mainSeries =
    firstIndexOfAny(s, ["paw patrol"])?.needle ||
    firstIndexOfAny(s, ["super wings", "peppa pig", "barbapapa family", "barbapapa"])?.needle ||
    undefined;
  if (!mainSeries) reasons.push("en_missing_series");

  if (
    mainSeries &&
    !includesAny(s, ["help", "team", "deliver", "package", "transform", "turns into", "changes into", "use", "uses", "bring", "brings"])
  ) {
    reasons.push("en_main_series_not_helping");
  }

  if (mainSeries === "paw patrol") {
    if (!includesAny(s, ["rescue", "mission", "team", "tool", "help"])) reasons.push("en_pawpatrol_missing_motif");
  } else if (mainSeries === "super wings") {
    const hasDelivery = includesAny(s, ["deliver", "delivery", "package"]);
    const hasToolOrParcel = includesAny(s, ["package", "tool", "clip", "hook", "rope", "ladder", "box"]);
    const hasUse = includesAny(s, ["use", "uses", "open", "opens", "takes", "attach", "attaches"]);
    if (!hasDelivery) reasons.push("en_superwings_missing_delivery");
    if (!hasToolOrParcel) reasons.push("en_superwings_missing_tool");
    if (!hasUse) reasons.push("en_superwings_missing_use");
  } else if (mainSeries === "peppa pig") {
    if (!includesAny(s, ["mummy", "daddy", "george", "family"])) reasons.push("en_peppa_missing_family");
    if (!includesAny(s, ["park", "mud", "boots", "picnic", "home"])) reasons.push("en_peppa_missing_daily_scene");
    if (!includesAny(s, ["help", "try", "idea", "together"])) reasons.push("en_peppa_missing_help_action");
  } else if (mainSeries === "barbapapa family" || mainSeries === "barbapapa") {
    const hasTransform = includesAny(s, ["shape", "transform", "turns into", "changes into"]);
    const hasIntoThing = includesAny(s, ["into a ladder", "into a bridge", "into a boat", "into an umbrella", "into a net", "into a rope", "into a hook"]);
    if (!hasTransform) reasons.push("en_barbapapa_missing_transform");
    if (!hasIntoThing) reasons.push("en_barbapapa_missing_transform_into");
  }

  return { ok: reasons.length === 0, reasons };
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
      "- 只能出现中文汉字和中文标点：句号。逗号，顿号、问号？感叹号！",
      "- 禁止空格、英文、数字、表情、引号、括号、书名号、冒号、分号、破折号、省略号、任何特殊符号",
      "- 全文八到十句，短句为主，每句只说一件事，每句尽量不超过五十个字，每句必须用句号结尾",
      "- 不是睡前故事：不要出现晚安、做梦、闭眼、快去睡等内容",
      "- 句子中间可以自然使用逗号或顿号做停顿，且全文至少出现一次逗号或顿号",
      "- 主题词：在心里从这几个词中选一个并写进故事里至少两次：帮忙、勇敢、耐心、分享、谢谢",
      "",
      "English story rules:",
      "- Use only English letters (A-Z a-z), spaces, commas, periods, question marks, exclamation marks.",
      "- No emojis, numbers, quotes, brackets, colons, semicolons, dashes, ellipses, or special symbols.",
      "- 8 to 10 sentences. Short sentences. Each sentence ends with a period.",
      "- Not a bedtime story: do not mention sleep, dreams, good night, or closing eyes.",
      "- Theme word: choose one and repeat it at least twice: help, brave, patient, share, thanks.",
      "",
      "多样性与内容元素（两种语言故事都要满足）：",
      "- 每次故事必须包含：明确地点、主角小动物、一个具体道具或小魔法、一个小阻碍、一个小收获",
      "- 地点不要总是森林：从这些场景中选 1 个写进去，并在英文里用对应英文表达：森林forest、海边beach、花园flower garden、雪地snowy hill、云朵城cloud city、蘑菇屋mushroom house、彩虹桥rainbow bridge、星星草地star meadow",
      "- “新奇点”必须至少有 1 个，而且每次尽量不同：会唱歌的贝壳、会打嗝的泡泡、会变色的叶子、会跳舞的石头、会发光的帽子、会转圈的铃铛、会变软的云朵、会飞的贴纸",
      "- 记忆钩子：每次必须选 1 个主系列融入；允许再加 1 个客串（可选），客串只点到为止，不能抢戏；必须原创剧情，不能复述或改写现成剧集",
      "  - 中文故事：主系列从以下选 1 个并写进正文：旺旺队、超级飞侠、小猪佩奇、巴巴爸爸一家人；客串最多再选 1 个也写进正文",
      "  - English story: main series pick 1 and write it in the story text: Paw Patrol, Super Wings, Peppa Pig, Barbapapa family; optional cameo pick at most 1 more",
      "  - 系列典型元素（写法要像“借了感觉”，但剧情必须全新）：",
      "    - 旺旺队 / Paw Patrol：小救援任务、队友分工、工具车或小装备、帮助别人解决小麻烦",
      "    - 超级飞侠 / Super Wings：送快递到某个地方、带来需要的小物件、途中小阻碍、准时送达并开心",
      "    - 小猪佩奇 / Peppa Pig：日常家庭场景、去公园或玩泥巴或小聚会、遇到一点小状况、轻松解决",
      "    - 巴巴爸爸一家人 / Barbapapa family：变形能力当作“解决办法”，把东西变成需要的形状来帮忙",
      "  - 控制出现方式：主系列要参与关键解决步骤；客串最多一句点到，不要出现口号台词；不要提“这一集/动画片里”",
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
      "",
      "结构硬约束（两种语言都要满足）：",
      "- 你写的每一句都必须是剧情推进句，不能只凑数形容",
      "- 必须明确写出：主角想要什么或要做什么、遇到的阻碍、尝试或想办法、动画元素的主动帮助、解决方式、最后的小收获或收束",
      "- 道具或能力不能凭空出现：必须交代是谁带来/送来/找到/变出来，并且用于解决阻碍",
      "- 必须出现至少一次转折词来体现尝试与困难：中文用“可是/但是/却/怎么也/还是”，英文用“but/however/still”",
      "- 如果选了“超级飞侠 / Super Wings”：必须出现投递语义（送来/送到/包裹/快递/deliver/package），并且投递来的小物件必须被用来解决阻碍",
      "- 如果选了“巴巴爸爸一家人 / Barbapapa family”：必须出现明确的变形成某个具体物件（例如变成梯子/桥/船/伞/网）并用于解决阻碍",
      "- 必须出现至少一个因果连接词让逻辑闭环：中文用“于是/所以/因为/结果/后来/这时”，英文用“so/because/then/later”",
      "- 末句必须收束：要么表达开心+谢谢，要么挥手再见+约好下次，并把主题词再说一次",
      "- 主题词不要生硬写成“说要谢谢/说要勇敢”这类口号句式，要写成真正的行动或感受",
      "- 主系列不能只路过：主系列必须参与关键解决步骤（出动救援/投递工具/日常一起想办法/变形成物件）",
    ].join("\n");

    const systemRetry = [
      system,
      "",
      "质量自检（不达标就全部重写）：",
      "- 中文必须出现 1 个主系列名（汪汪队/旺旺队/超级飞侠/小猪佩奇/巴巴爸爸一家人），可选再出现 1 个客串系列名；主系列要参与关键解决步骤",
      "- 英文必须出现 1 个主系列名（Paw Patrol/Super Wings/Peppa Pig/Barbapapa family），可选再出现 1 个客串系列名；主系列要参与关键解决步骤",
      "- 不要出现“路过一下就结束”的角色，不要用万能句糊弄",
      "- 句子之间要有因果连接：阻碍要和目标有关，解决要和道具有关",
    ].join("\n");

    const timeoutMs = Number(
      process.env.ZHIPU_CHAT_TIMEOUT_MS ??
        process.env.ZHIPU_TIMEOUT_MS ??
        (process.env.VERCEL ? "9000" : "30000"),
    );

    const callUpstream = async (prompt: string) => {
      const { content, requestId: chatReqId } = await zhipuChatCompletions({
        apiKey,
        model: chatModel,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `种子：${seed}` },
        ],
        temperature: 0.9,
        top_p: 0.9,
        max_tokens: 900,
        thinking: { type: "disabled" },
        timeoutMs,
      });
      requestId = chatReqId ?? requestId;
      return content;
    };

    let storyZh = "";
    let storyEn = "";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const prompt = attempt === 1 ? system : systemRetry;
      const content = await callUpstream(prompt);

      const parsed = safeJsonParse(content);
      const rec = asRecord(parsed);
      const zhRaw = typeof rec?.storyZh === "string" ? rec.storyZh : "";
      const enRaw = typeof rec?.storyEn === "string" ? rec.storyEn : "";

      let nextZh = sanitizeStrictZhStory(clampText(zhRaw, 900));
      let nextEn = sanitizeStrictEnglishStory(clampText(enRaw, 900));

      let fellBackThisRound = false;
      if (!nextZh) {
        nextZh = fallbackStrictZhStory(seed);
        fellBackThisRound = true;
      }
      if (!nextEn) {
        nextEn = fallbackStrictEnglishStory(seed);
        fellBackThisRound = true;
      }

      const qZh = qualityCheckZh(nextZh);
      const qEn = qualityCheckEn(nextEn);
      const ok = qZh.ok && qEn.ok && !fellBackThisRound;

      storyZh = nextZh;
      storyEn = nextEn;

      if (ok) break;
      if (attempt === 2) {
        if (!qZh.ok) storyZh = fallbackStrictZhStory(seed);
        if (!qEn.ok) storyEn = fallbackStrictEnglishStory(seed);
        break;
      }
    }

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
