import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type MemoryEntry = {
  id: string;
  createdAt: string;
  seed: string;
  story: string;
  requestId?: string;
  hasAudio: boolean;
  userAgent?: string;
  ip?: string;
};

function getLogPath() {
  return (
    process.env.STORY_LOG_PATH?.trim() ||
    path.join(process.cwd(), "data", "memories.jsonl")
  );
}

export async function appendMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt">,
) {
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

