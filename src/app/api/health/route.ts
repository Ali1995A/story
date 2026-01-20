import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getTokenFromRequest(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1]) return m[1].trim();
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get("token")?.trim();
  return tokenFromQuery || "";
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: Request) {
  const adminToken = process.env.STORY_ADMIN_TOKEN?.trim() || "";
  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: "Missing env: STORY_ADMIN_TOKEN" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const token = getTokenFromRequest(req);
  if (!token || token !== adminToken) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const required = ["ZHIPU_API_KEY"];
  const missing = required.filter((k) => !(process.env[k]?.trim()));

  const remoteUrl = process.env.STORY_REMOTE_LOG_URL?.trim() || "";
  const remoteToken = process.env.STORY_REMOTE_LOG_TOKEN?.trim() || "";
  const remoteConfigured = Boolean(remoteUrl && remoteToken);

  let remoteHealth: { ok: boolean; status?: number; error?: string } | undefined;
  if (remoteConfigured) {
    const base = remoteUrl.endsWith("/") ? remoteUrl.slice(0, -1) : remoteUrl;
    try {
      const res = await fetchWithTimeout(`${base}/healthz`, 2000);
      remoteHealth = { ok: res.ok, status: res.status };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Remote health check failed";
      remoteHealth = { ok: false, error: msg };
    }
  }

  return NextResponse.json(
    {
      ok: missing.length === 0,
      missing,
      remote: {
        configured: remoteConfigured,
        url: remoteConfigured ? remoteUrl : undefined,
        health: remoteHealth,
      },
      voice: {
        model: process.env.ZHIPU_VOICE_MODEL?.trim() || "glm-4-voice",
        endpoint:
          process.env.ZHIPU_VOICE_ENDPOINT?.trim() ||
          "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      },
      tts: {
        model: process.env.ZHIPU_TTS_MODEL?.trim() || undefined,
        endpoint:
          process.env.ZHIPU_TTS_ENDPOINT?.trim() ||
          "https://open.bigmodel.cn/api/paas/v4/audio/speech",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

