import { readMemories } from "@/lib/memories";
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

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "200");
  try {
    const memories = await readMemories({ limit });
    return NextResponse.json(
      { ok: true, memories },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read memories";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
