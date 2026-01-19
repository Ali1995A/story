type ZhipuChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ZhipuChatOptions = {
  apiKey: string;
  model: string;
  messages: ZhipuChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
};

export async function zhipuChatCompletions(opts: ZhipuChatOptions) {
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.9,
      top_p: opts.top_p ?? 0.9,
      max_tokens: opts.max_tokens ?? 600,
    }),
  });

  const requestId = res.headers.get("x-request-id") ?? undefined;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Zhipu chat failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
    );
  }

  const data = (await res.json()) as unknown;
  const content =
    getNestedString(data, ["choices", "0", "message", "content"]) ??
    getNestedString(data, ["choices", "0", "delta", "content"]) ??
    getNestedString(data, ["data", "choices", "0", "message", "content"]);

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Zhipu chat returned empty content");
  }

  return { content: content.trim(), requestId };
}

export type ZhipuTtsOptions = {
  apiKey: string;
  endpoint: string;
  model: string;
  input: string;
  voice?: string;
  format?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return;
  return value as Record<string, unknown>;
}

function getNested(value: unknown, path: string[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    const record = asRecord(cur);
    if (!record) {
      if (Array.isArray(cur)) {
        const idx = Number(key);
        if (!Number.isFinite(idx)) return undefined;
        cur = cur[idx];
        continue;
      }
      return undefined;
    }
    cur = record[key];
  }
  return cur;
}

function getNestedString(value: unknown, path: string[]) {
  const v = getNested(value, path);
  return typeof v === "string" ? v : undefined;
}

function extractAudioFromJson(payload: unknown): { audioBase64?: string; mime?: string } {
  const audioBase64 =
    getNestedString(payload, ["audio"]) ??
    getNestedString(payload, ["data", "audio"]) ??
    getNestedString(payload, ["data", "data", "audio"]) ??
    getNestedString(payload, ["choices", "0", "audio"]) ??
    getNestedString(payload, ["data", "choices", "0", "audio"]);

  const mime =
    getNestedString(payload, ["mime"]) ??
    getNestedString(payload, ["data", "mime"]) ??
    getNestedString(payload, ["data", "data", "mime"]) ??
    getNestedString(payload, ["content_type"]) ??
    getNestedString(payload, ["data", "content_type"]);

  return { audioBase64, mime };
}

export async function zhipuTts(opts: ZhipuTtsOptions) {
  const res = await fetch(opts.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      input: opts.input,
      voice: opts.voice,
      format: opts.format ?? "mp3",
    }),
  });

  const requestId = res.headers.get("x-request-id") ?? undefined;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Zhipu TTS failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
    );
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("audio/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      audioBase64: buf.toString("base64"),
      audioMime: contentType.split(";")[0] || "audio/mpeg",
      requestId,
    };
  }

  const json = (await res.json()) as unknown;
  const extracted = extractAudioFromJson(json);
  if (!extracted.audioBase64) {
    throw new Error("Zhipu TTS returned no audio");
  }

  return {
    audioBase64: extracted.audioBase64,
    audioMime: extracted.mime ?? "audio/mpeg",
    requestId,
  };
}
