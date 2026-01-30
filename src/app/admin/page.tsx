"use client";

import { useMemo, useState } from "react";

type MemoryEntry = {
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

type ApiResponse =
  | { ok: true; memories: MemoryEntry[] }
  | { ok: false; error: string };

function formatLocalTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [memories, setMemories] = useState<MemoryEntry[]>([]);

  const canFetch = useMemo(() => token.trim().length > 0 && !busy, [token, busy]);

  type StoryGroupItem = {
    kind: "storyGroup";
    id: string;
    createdAt: string;
    seed: string;
    requestIds: string[];
    hasAudio: boolean;
    storyZh?: string;
    storyEn?: string;
  };

  type EntryItem = { kind: "entry"; entry: MemoryEntry };
  type Item = StoryGroupItem | EntryItem;

  const items = useMemo<Item[]>(() => {
    const groups = new Map<string, MemoryEntry[]>();
    for (const m of memories) {
      if ((m.kind || "story") === "chat") continue;
      const gid = m.generationId?.trim();
      if (!gid) continue;
      const arr = groups.get(gid) ?? [];
      arr.push(m);
      groups.set(gid, arr);
    }

    const seen = new Set<string>();
    const out: Item[] = [];

    for (const m of memories) {
      if ((m.kind || "story") !== "chat" && m.generationId?.trim()) {
        const gid = m.generationId.trim();
        if (seen.has(gid)) continue;
        seen.add(gid);
        const entries = groups.get(gid) ?? [m];

        const zh =
          entries.find((x) => x.lang === "zh" && (x.storyZh || x.story))?.storyZh ||
          entries.find((x) => x.lang === "zh" && (x.storyZh || x.story))?.story ||
          entries.find((x) => x.storyZh)?.storyZh ||
          undefined;
        const en =
          entries.find((x) => x.lang === "en" && (x.storyEn || x.story))?.storyEn ||
          entries.find((x) => x.lang === "en" && (x.storyEn || x.story))?.story ||
          entries.find((x) => x.storyEn)?.storyEn ||
          undefined;

        // Newer format writes a single story record with both fields populated.
        const single = entries.find((x) => x.storyZh && x.storyEn);
        const mergedZh = zh || single?.storyZh || undefined;
        const mergedEn = en || single?.storyEn || undefined;

        out.push({
          kind: "storyGroup",
          id: gid,
          createdAt: m.createdAt,
          seed: m.seed,
          requestIds: entries.map((x) => x.requestId).filter(Boolean) as string[],
          hasAudio: entries.some((x) => x.hasAudio),
          storyZh: mergedZh,
          storyEn: mergedEn,
        });
        continue;
      }

      out.push({ kind: "entry", entry: m });
    }

    return out;
  }, [memories]);

  const fetchMemories = async () => {
    if (!canFetch) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/memories?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      const data = (await res.json()) as ApiResponse;
      if (!data.ok) throw new Error(data.error);
      setMemories(data.memories);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "加载失败";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(memories, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell flex justify-center px-4 py-6">
      <main className="w-full max-w-[1000px]">
        <div className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur">
          <div className="text-lg font-semibold">成长记录（后台）</div>
          <div className="mt-1 text-sm text-black/60">
            需要在环境变量里设置 `STORY_ADMIN_TOKEN`，并在这里输入同样的 token。
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_140px_140px]">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="STORY_ADMIN_TOKEN"
              className="h-12 w-full rounded-2xl border border-black/10 bg-white/80 px-4 text-sm outline-none"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <input
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value || 0))}
              placeholder="limit"
              inputMode="numeric"
              className="h-12 w-full rounded-2xl border border-black/10 bg-white/80 px-4 text-sm outline-none"
            />
            <button
              type="button"
              onClick={fetchMemories}
              disabled={!canFetch}
              className="h-12 rounded-2xl bg-black text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "加载中..." : "加载"}
            </button>
          </div>

          {error ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-black/60">
              共 {memories.length} 条（按时间倒序；故事会按 generationId 合并展示）
            </div>
            <button
              type="button"
              onClick={downloadJson}
              disabled={memories.length === 0}
              className="rounded-2xl border border-black/10 bg-white/80 px-4 py-2 text-sm text-black/70 shadow-sm disabled:opacity-40"
            >
              下载 JSON
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          {items.map((it) => {
            if (it.kind === "storyGroup") {
              return (
                <section
                  key={`g-${it.id}`}
                  className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-black/80">
                      {formatLocalTime(it.createdAt)}
                    </div>
                    <div className="text-xs text-black/50">
                      故事（双语）{" · "}
                      {it.hasAudio ? "有语音" : "无语音"}
                      {it.requestIds.length ? ` · ${it.requestIds.join(" / ")}` : ""}
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                    <div className="text-xs font-semibold text-black/50">种子</div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-black/80">
                      {it.seed}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                      <div className="text-xs font-semibold text-black/50">中文</div>
                      <div className="mt-1 whitespace-pre-wrap break-words leading-7 text-black/80">
                        {it.storyZh || "（缺失）"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                      <div className="text-xs font-semibold text-black/50">English</div>
                      <div className="mt-1 whitespace-pre-wrap break-words leading-7 text-black/80">
                        {it.storyEn || "（缺失）"}
                      </div>
                    </div>
                  </div>
                </section>
              );
            }

            const m = it.entry;
            const kind = (m.kind || "story") === "chat" ? "对话" : "故事";
            return (
              <section
                key={m.id}
                className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-black/80">
                    {formatLocalTime(m.createdAt)}
                  </div>
                  <div className="text-xs text-black/50">
                    {kind}
                    {m.lang ? ` · ${m.lang}` : ""}
                    {" · "}
                    {m.hasAudio ? "有语音" : "无语音"}
                    {m.requestId ? ` · ${m.requestId}` : ""}
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                  <div className="text-xs font-semibold text-black/50">种子</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-black/80">
                    {m.seed}
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                  <div className="text-xs font-semibold text-black/50">
                    {(m.kind || "story") === "chat" ? "故事背景" : "故事"}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words leading-7 text-black/80">
                    {m.story}
                  </div>
                </div>

                {(m.kind || "story") === "chat" ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                      <div className="text-xs font-semibold text-black/50">孩子</div>
                      <div className="mt-1 whitespace-pre-wrap break-words leading-7 text-black/80">
                        {m.kidText || "（语音）"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm">
                      <div className="text-xs font-semibold text-black/50">海皮</div>
                      <div className="mt-1 whitespace-pre-wrap break-words leading-7 text-black/80">
                        {m.assistantText || ""}
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
