import { zhipuChatCompletions } from "@/lib/zhipu";
import { appendMemory } from "@/lib/memories";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type OkResponse = {
  ok: true;
  story: string;
  lang: "zh";
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

function sanitizeStrictStory(story: string) {
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

function fallbackStrictStory(seed: string) {
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

  // Keep 6-10 sentences.
  const count = Math.max(6, Math.min(10, 6 + (seed.length % 5)));
  return lines.slice(0, count).join("");
}

function rewriteTemplateEnding(story: string, seed: string) {
  const s = story.replace(/\s+$/g, "");
  const templateRe = /晚安我的宝贝[，,]\s*做一个甜甜的梦[。.!！]*$/;
  const sleepyTailRe =
    /(晚安|做一个甜甜的梦|进入梦乡|睡吧|闭上眼|做个美梦|安心睡|快去睡)[。.!！]*$/;
  if (!templateRe.test(s) && !sleepyTailRe.test(s)) return story;

  const without = s.replace(templateRe, "").replace(sleepyTailRe, "").replace(/\s+$/g, "");
  const endings = [
    "好啦故事先收进口袋我们继续去探险。",
    "谢谢你听到这里下一次我们再遇见新朋友。",
    "魔法火花飞走了我们也挥挥手说再见。",
    "故事先停在这里小伙伴们一起开开心心回家。",
    "如果你愿意我们下次再去森林里找宝藏。",
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
  let generationIdForLog: string | undefined;

  try {
    const apiKey = requireEnv("ZHIPU_API_KEY");
    const chatModel = process.env.ZHIPU_CHAT_MODEL?.trim() || "glm-4.7";
    // TTS is handled by /api/tts to avoid long single requests on serverless.

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
        { ok: false, error: "请输入一些字符" },
        { status: 400 },
      );
    }

    const system = [
      "你是一个给5岁儿童讲故事的讲述者",
      "输入是小朋友随便敲键盘得到的乱码随机文字表情",
      "请把这些字符当作种子联想到形象与情节编一个非常温柔非常安全的儿童故事",
      "只输出故事正文不要输出任何分析推理过程或步骤",
      "正文不得包含任何规则说明不得包含标题不得包含列表不得包含编号不得换行不得输出空行",
      "",
      "输出格式强约束",
      "故事正文只能出现中文汉字和这些中文标点",
      "句号。逗号，问号？感叹号！",
      "除此之外一律禁止",
      "禁止空格",
      "禁止英文",
      "禁止数字",
      "禁止表情",
      "禁止引号",
      "禁止括号",
      "禁止书名号",
      "禁止冒号",
      "禁止分号",
      "禁止破折号",
      "禁止省略号",
      "禁止任何特殊符号",
      "",
      "句子结构强约束",
      "全文只能有六到十句",
      "短句为主",
      "每句只说一件事",
      "每句尽量不超过十五个字",
      "每句必须用句号结尾",
      "",
      "语言风格",
      "适合朗读",
      "语气温暖",
      "节奏轻快",
      "用五岁孩子能懂的词",
      "多用叠词和拟声词例如软软圆圆啾啾咕噜",
      "不要幼稚说教",
      "不是睡前故事不要催眠不要劝睡不要出现晚安做梦闭眼等内容",
      "结尾用继续冒险挥手再见约好下次等轻快收束且不要固定模板句式",
      "",
      "内容元素",
      "必须至少包含以下元素中的三项",
      "森林",
      "小动物",
      "拟人化角色",
      "简单魔法或道具",
      "动画感角色",
      "",
      "情节逻辑",
      "情节必须清楚",
      "起因是一个小问题或小愿望",
      "经过是一段轻快的寻找或尝试",
      "结果是解决了问题并带来开心的小收获",
      "全程逻辑连贯不要跳戏",
      "",
      "安全要求",
      "全程安全温柔",
      "不能出现恐怖暴力血腥成人内容",
      "不能出现受伤",
      "不能出现吵架升级",
      "不能出现追杀",
      "不能出现惩罚",
      "",
      "叙述方式",
      "不能出现任何直接对话格式",
      "不要用引号",
      "不要一问一答",
      "如果需要表达说话用转述句例如小兔告诉大家它很开心",
      "",
      "优先级",
      "如果无法同时满足所有要求",
      "优先保证只用允许字符和标点",
      "其次保证六到十句且每句句号结尾",
      "再次保证每句尽量不超过十五个字",
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

    const raw = rewriteTemplateEnding(clampText(content.replace(/\r\n/g, "\n"), 700), seed);
    let story = sanitizeStrictStory(raw);
    if (!story) {
      console.warn("[/api/generate] strict sanitize produced empty story; using fallback", {
        requestId,
      });
      story = fallbackStrictStory(seed);
    }
    storyForLog = story;
    const ipFromHeaders =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    try {
      await appendMemory({
        kind: "story",
        lang: "zh",
        generationId: generationIdForLog,
        seed: seedForLog,
        story: storyForLog,
        storyZh: storyForLog,
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
        lang: "zh",
        generationId: generationIdForLog,
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
