import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
            "radial-gradient(420px 420px at 30% 25%, rgba(255,90,165,0.85), transparent 60%), radial-gradient(380px 380px at 75% 35%, rgba(124,92,255,0.55), transparent 60%), linear-gradient(180deg, #fff6fb, #ffe7f3)",
        }}
      >
        <div
          style={{
            width: 360,
            height: 360,
            borderRadius: 84,
            background: "rgba(255,255,255,0.78)",
            border: "10px solid rgba(255,90,165,0.18)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 24px 60px rgba(255,63,150,0.22)",
          }}
        >
          <div
            style={{
              fontSize: 132,
              lineHeight: 1,
              color: "#ff2d89",
            }}
          >
            粉
          </div>
          <div style={{ fontSize: 132, lineHeight: 1, color: "#7c5cff" }}>
            粉
          </div>
        </div>
      </div>
    ),
    size,
  );
}

