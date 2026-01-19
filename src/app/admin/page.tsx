"use client";

import { useMemo, useState } from "react";

type MemoryEntry = {
  id: string;
  createdAt: string;
  seed: string;
  story: string;
  requestId?: string;
  hasAudio: boolean;
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
              共 {memories.length} 条（按时间倒序）
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
          {memories.map((m) => (
            <section
              key={m.id}
              className="rounded-3xl border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-black/80">
                  {formatLocalTime(m.createdAt)}
                </div>
                <div className="text-xs text-black/50">
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
                <div className="text-xs font-semibold text-black/50">故事</div>
                <div className="mt-1 whitespace-pre-wrap break-words leading-7 text-black/80">
                  {m.story}
                </div>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

