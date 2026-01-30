import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type MemoryEntry = {
  id: string;
  createdAt: string;
  kind?: "story" | "chat";
  lang?: "zh" | "en";
  generationId?: string;
  seed: string;
  story: string;
  storyZh?: string;
  storyEn?: string;
  requestId?: string;
  hasAudio: boolean;
  conversationId?: string;
  kidText?: string;
  assistantText?: string;
  userAgent?: string;
  ip?: string;
};

function getLogPath() {
  return (
    process.env.STORY_LOG_PATH?.trim() ||
    path.join(process.cwd(), "data", "memories.jsonl")
  );
}

function getRemoteBaseUrl() {
  const raw = process.env.STORY_REMOTE_LOG_URL?.trim();
  if (!raw) return;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function getRemoteToken() {
  const raw = process.env.STORY_REMOTE_LOG_TOKEN?.trim();
  return raw || undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function appendMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt">,
) {
  const remoteBaseUrl = getRemoteBaseUrl();
  const remoteToken = getRemoteToken();
  if (remoteBaseUrl && remoteToken) {
    const res = await fetchWithTimeout(
      `${remoteBaseUrl}/append`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${remoteToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(entry),
      },
      Number(process.env.STORY_REMOTE_LOG_TIMEOUT_MS ?? "2000"),
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Remote log failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
      );
    }
    return (await res.json()) as MemoryEntry;
  }

  const fullPath = getLogPath();
  await mkdir(path.dirname(fullPath), { recursive: true });

  const record: MemoryEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };

  await appendFile(fullPath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readMemories(opts?: { limit?: number }) {
  const limitRaw = opts?.limit ?? 200;
  const limit = Math.max(1, Math.min(1000, Math.trunc(limitRaw)));

  const remoteBaseUrl = getRemoteBaseUrl();
  const remoteToken = getRemoteToken();
  if (remoteBaseUrl && remoteToken) {
    const res = await fetchWithTimeout(
      `${remoteBaseUrl}/memories?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${remoteToken}` },
        cache: "no-store",
      },
      Number(process.env.STORY_REMOTE_LOG_TIMEOUT_MS ?? "2000"),
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Remote read failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
      );
    }
    const data = (await res.json()) as unknown;
    if (
      !data ||
      typeof data !== "object" ||
      !("ok" in data) ||
      (data as { ok?: unknown }).ok !== true
    ) {
      throw new Error("Remote read returned invalid response");
    }
    return ((data as { memories?: unknown }).memories as MemoryEntry[]) ?? [];
  }

  const fullPath = getLogPath();

  try {
    const text = await readFile(fullPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const records: MemoryEntry[] = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (records.length >= limit) break;
      try {
        const parsed = JSON.parse(lines[i]) as MemoryEntry;
        if (!parsed || typeof parsed !== "object") continue;
        records.push(parsed);
      } catch {
        // ignore bad line
      }
    }
    return records;
  } catch {
    return [];
  }
}
