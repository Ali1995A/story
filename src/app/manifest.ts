import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "粉粉故事机",
    short_name: "故事机",
    description: "小朋友乱按键盘也能变成故事和声音。",
    start_url: "/",
    display: "standalone",
    background_color: "#fff6fb",
    theme_color: "#ff5aa5",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

