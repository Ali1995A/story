"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type GenerateResult =
  | {
      ok: true;
      story: string;
      audioBase64?: string;
      audioMime?: string;
      requestId?: string;
    }
  | {
      ok: false;
      error: string;
      requestId?: string;
    };

function base64ToObjectUrl(base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
      <path
        fill="currentColor"
        d="M12 1l1.6 5.1L19 8l-5.4 1.9L12 15l-1.6-5.1L5 8l5.4-1.9L12 1zm8 9l.9 2.9 3.1 1.1-3.1 1.1L20 18l-.9-2.9-3.1-1.1 3.1-1.1L20 10zM4 10l.9 2.9L8 14l-3.1 1.1L4 18l-.9-2.9L0 14l3.1-1.1L4 10z"
      />
    </svg>
  );
}

function SpeakerIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
      <path
        fill="currentColor"
        d="M3 10v4c0 1.1.9 2 2 2h3l5 4V4L8 8H5c-1.1 0-2 .9-2 2zm13.5 2c0-1.8-1-3.4-2.5-4.2v8.4c1.5-.8 2.5-2.4 2.5-4.2zm2.5 0c0 3-1.7 5.6-4.2 6.9l.9 1.5C19.3 18.8 21.5 15.6 21.5 12S19.3 5.2 15.7 3.6l-.9 1.5C17.3 6.4 19 9 19 12z"
      />
      {playing ? (
        <path
          fill="currentColor"
          d="M7.2 8.8a1 1 0 0 1 1.4 0l7.6 7.6a1 1 0 1 1-1.4 1.4L7.2 10.2a1 1 0 0 1 0-1.4z"
        />
      ) : null}
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path
        fill="currentColor"
        d="M12 6V3L8 7l4 4V8c2.8 0 5 2.2 5 5a5 5 0 0 1-9.7 1.7l-1.9.6A7 7 0 0 0 19 13c0-3.9-3.1-7-7-7z"
      />
    </svg>
  );
}

async function unlockAudioForIOS() {
  const AnyWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = AnyWindow.AudioContext ?? AnyWindow.webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    const ctx = new AudioContextCtor();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    if (ctx.state === "suspended") await ctx.resume();
    await ctx.close();
  } catch {
    // ignore
  }
}

export default function StoryToy() {
  const [seed, setSeed] = useState("");
  const [story, setStory] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cleanupUrlRef = useRef<string>("");

  const canGenerate = useMemo(() => seed.trim().length > 0 && !busy, [seed, busy]);

  useEffect(() => {
    const setAppHeight = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${window.innerHeight}px`,
      );
    };
    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    return () => window.removeEventListener("resize", setAppHeight);
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupUrlRef.current) URL.revokeObjectURL(cleanupUrlRef.current);
    };
  }, []);

  const resetAll = () => {
    setSeed("");
    setStory("");
    setError("");
    setPlaying(false);
    setShowText(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (cleanupUrlRef.current) {
      URL.revokeObjectURL(cleanupUrlRef.current);
      cleanupUrlRef.current = "";
    }
    setAudioUrl("");
    textareaRef.current?.focus();
  };

  const generate = async () => {
    if (!canGenerate) return;

    setBusy(true);
    setError("");
    setShowText(false);
    setPlaying(false);
    if (audioRef.current) audioRef.current.pause();

    await unlockAudioForIOS();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed }),
      });

      const data = (await res.json()) as GenerateResult;
      if (!data.ok) throw new Error(data.error);

      setStory(data.story);
      if (data.audioBase64 && data.audioMime) {
        const url = base64ToObjectUrl(data.audioBase64, data.audioMime);
        if (cleanupUrlRef.current) URL.revokeObjectURL(cleanupUrlRef.current);
        cleanupUrlRef.current = url;
        setAudioUrl(url);

        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
          try {
            await audioRef.current.play();
            setPlaying(true);
          } catch {
            setPlaying(false);
          }
        }
      } else {
        setError("已生成故事文字，但没有拿到语音（检查 ZHIPU_TTS_MODEL / ZHIPU_TTS_ENDPOINT）");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "生成失败";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;

    try {
      if (audio.paused) {
        await unlockAudioForIOS();
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
      }
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className="app-shell relative flex items-stretch justify-center overflow-hidden bg-[radial-gradient(1200px_700px_at_30%_10%,rgba(255,90,165,0.40),transparent_60%),radial-gradient(900px_600px_at_70%_25%,rgba(124,92,255,0.22),transparent_60%),linear-gradient(180deg,#fff6fb,#ffe7f3_55%,#fff6fb)] px-[max(16px,env(safe-area-inset-left))] py-[max(16px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,90,165,0.50),transparent_60%)] blur-2xl" />
      <main className="relative flex w-full max-w-[520px] flex-col gap-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        <div className="rounded-3xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--pink-400),var(--lav-500))] text-white shadow-[0_10px_25px_rgba(255,90,165,0.25)]">
                <SparkleIcon />
              </div>
              <div className="flex flex-col">
                <div className="text-base font-semibold tracking-tight">
                  粉粉故事机
                </div>
                <div className="text-xs text-black/50">输入乱七八糟也没关系</div>
              </div>
            </div>
            <button
              type="button"
              onClick={resetAll}
              className="grid h-11 w-11 place-items-center rounded-2xl border border-black/5 bg-white/70 text-black/70 shadow-sm active:scale-[0.98]"
              aria-label="重置"
            >
              <ResetIcon />
            </button>
          </div>

          <button
            type="button"
            className="mt-4 w-full rounded-3xl border border-black/5 bg-white/70 p-4 text-left shadow-sm active:scale-[0.99]"
            onClick={() => textareaRef.current?.focus()}
            aria-label="输入"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,90,165,0.18),rgba(124,92,255,0.14))] text-[color:var(--pink-600)]">
                <span className="text-2xl" aria-hidden="true">
                  ⌨︎
                </span>
              </div>
              <textarea
                ref={textareaRef}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                rows={2}
                inputMode="text"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="···"
                className="min-h-[64px] w-full resize-none bg-transparent text-lg leading-7 outline-none placeholder:text-black/30"
                aria-label="随便输入"
              />
            </div>
          </button>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={!canGenerate}
              className="group relative flex h-16 flex-1 items-center justify-center gap-3 rounded-3xl bg-[linear-gradient(135deg,var(--pink-500),var(--lav-500))] text-white shadow-[0_14px_30px_rgba(255,63,150,0.28)] disabled:opacity-40"
              aria-label="生成故事"
            >
              <span className={busy ? "animate-pulse" : ""}>
                <SparkleIcon />
              </span>
              <span className="text-base font-semibold tracking-wide">
                {busy ? "..." : "开始"}
              </span>
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioUrl}
              className="grid h-16 w-16 place-items-center rounded-3xl border border-black/5 bg-white/70 text-[color:var(--pink-600)] shadow-sm disabled:opacity-40 active:scale-[0.98]"
              aria-label="播放或暂停"
            >
              <SpeakerIcon playing={playing} />
            </button>
          </div>

          {error ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,90,165,0.22),rgba(124,92,255,0.18))] text-[color:var(--pink-600)]">
                <span className="text-2xl" aria-hidden="true">
                  ♪
                </span>
              </div>
              <div className="text-sm font-medium text-black/70">
                点击右侧喇叭听故事
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowText((v) => !v)}
              className="rounded-2xl border border-black/5 bg-white/70 px-4 py-2 text-sm text-black/70 shadow-sm active:scale-[0.99]"
              aria-label="显示或隐藏文字"
            >
              Aa
            </button>
          </div>

          {showText ? (
            <div className="mt-4 rounded-3xl border border-black/5 bg-white/70 p-4 text-[15px] leading-7 text-black/80">
              {story ? story : "（还没有故事）"}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center">
                <div className="text-2xl" aria-hidden="true">
                  👆
                </div>
                <div className="mt-2 text-xs text-black/55">点</div>
              </div>
              <div className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center">
                <div className="text-2xl" aria-hidden="true">
                  ✨
                </div>
                <div className="mt-2 text-xs text-black/55">变</div>
              </div>
              <div className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center">
                <div className="text-2xl" aria-hidden="true">
                  🔊
                </div>
                <div className="mt-2 text-xs text-black/55">听</div>
              </div>
            </div>
          )}
        </div>

        <audio
          ref={audioRef}
          playsInline
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      </main>
    </div>
  );
}
