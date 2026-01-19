import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(140px 140px at 30% 25%, rgba(255,90,165,0.9), transparent 60%), radial-gradient(140px 140px at 70% 30%, rgba(124,92,255,0.55), transparent 60%), linear-gradient(180deg, #fff6fb, #ffe7f3)",
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 34,
            background: "rgba(255,255,255,0.80)",
            border: "6px solid rgba(255,90,165,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 18px 44px rgba(255,63,150,0.22)",
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -2,
            color: "#ff2d89",
          }}
        >
          粉粉
        </div>
      </div>
    ),
    size,
  );
}

