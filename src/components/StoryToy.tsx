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

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatResult =
  | {
      ok: true;
      conversationId: string;
      assistantText: string;
      assistantAudioBase64?: string;
      assistantAudioMime?: string;
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

async function blobToBase64(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
  const [busySeconds, setBusySeconds] = useState(0);
  const [conversationId, setConversationId] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [recording, setRecording] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cleanupUrlRef = useRef<string>("");
  const chatCleanupUrlRef = useRef<string>("");
  const hasUserToggledShowTextRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const abortRecordingRef = useRef(false);
  const wakeLockRef = useRef<unknown>(null);

  const canGenerate = useMemo(() => seed.trim().length > 0 && !busy, [seed, busy]);

  const shouldDefaultShowText = () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  };

  useEffect(() => {
    const setAppHeight = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.round(height)}px`,
      );
      if (!hasUserToggledShowTextRef.current) {
        setShowText(shouldDefaultShowText());
      }
    };
    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    window.visualViewport?.addEventListener("resize", setAppHeight);
    window.visualViewport?.addEventListener("scroll", setAppHeight);
    return () => {
      window.removeEventListener("resize", setAppHeight);
      window.visualViewport?.removeEventListener("resize", setAppHeight);
      window.visualViewport?.removeEventListener("scroll", setAppHeight);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupUrlRef.current) URL.revokeObjectURL(cleanupUrlRef.current);
      if (chatCleanupUrlRef.current) URL.revokeObjectURL(chatCleanupUrlRef.current);
    };
  }, []);

  useEffect(() => {
    setBusySeconds(0);
    if (!busy) return;

    const id = window.setInterval(() => {
      setBusySeconds((s) => s + 1);
    }, 1000);

    const AnyNavigator = navigator as unknown as {
      wakeLock?: { request: (type: "screen") => Promise<unknown> };
    };
    AnyNavigator.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        wakeLockRef.current = sentinel;
      })
      .catch(() => {
        // ignore (unsupported or denied)
      });

    return () => {
      window.clearInterval(id);
      const sentinel = wakeLockRef.current as { release?: () => Promise<void> } | null;
      wakeLockRef.current = null;
      sentinel?.release?.().catch(() => {
        // ignore
      });
    };
  }, [busy]);

  useEffect(() => {
    const shouldWarn = busy || chatBusy || recording;
    if (!shouldWarn) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy, chatBusy, recording]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const stopRecordingNow = () => {
    abortRecordingRef.current = true;
    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // ignore
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setRecording(false);
  };

  const stopRecordingAndSend = () => {
    abortRecordingRef.current = false;
    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    return () => {
      stopRecordingNow();
    };
  }, []);

  const resetAll = () => {
    stopRecordingNow();
    setSeed("");
    setStory("");
    setError("");
    setPlaying(false);
    hasUserToggledShowTextRef.current = false;
    setShowText(shouldDefaultShowText());
    setConversationId("");
    setChatMessages([]);
    setChatError("");
    setChatBusy(false);
    setRecording(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (chatAudioRef.current) {
      chatAudioRef.current.pause();
      chatAudioRef.current.currentTime = 0;
    }
    if (cleanupUrlRef.current) {
      URL.revokeObjectURL(cleanupUrlRef.current);
      cleanupUrlRef.current = "";
    }
    if (chatCleanupUrlRef.current) {
      URL.revokeObjectURL(chatCleanupUrlRef.current);
      chatCleanupUrlRef.current = "";
    }
    setAudioUrl("");
    textareaRef.current?.focus();
  };

  const generate = async () => {
    if (!canGenerate) return;

    stopRecordingNow();
    setBusy(true);
    setBusySeconds(0);
    setError("");
    if (!hasUserToggledShowTextRef.current) setShowText(shouldDefaultShowText());
    setPlaying(false);
    setConversationId("");
    setChatMessages([]);
    setChatError("");
    if (audioRef.current) audioRef.current.pause();

    await unlockAudioForIOS();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed }),
      });

      let data: GenerateResult;
      const rawText = await res.text();
      try {
        data = JSON.parse(rawText) as GenerateResult;
      } catch {
        throw new Error(rawText || `请求失败：${res.status} ${res.statusText}`);
      }
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

  const pickRecordingMime = () => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
    ];
    for (const c of candidates) {
      try {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
          return c;
        }
      } catch {
        // ignore
      }
    }
    return "";
  };

  const startRecording = async () => {
    if (recording || chatBusy) return;
    setChatError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordedChunksRef.current = [];
      abortRecordingRef.current = false;
      const mimeType = pickRecordingMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        streamRef.current = null;
        mediaRecorderRef.current = null;

        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType });
        recordedChunksRef.current = [];
        if (!blob.size || abortRecordingRef.current) return;
        const base64 = await blobToBase64(blob);
        await sendChat({ inputAudioBase64: base64, inputAudioMime: blob.type });
      };
      recorder.start(250);
      setRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "无法使用麦克风";
      setChatError(msg);
      setRecording(false);
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }
  };

  const playChatAudio = async (base64: string, mime: string) => {
    const url = base64ToObjectUrl(base64, mime || "audio/wav");
    if (chatCleanupUrlRef.current) URL.revokeObjectURL(chatCleanupUrlRef.current);
    chatCleanupUrlRef.current = url;
    if (!chatAudioRef.current) return;
    chatAudioRef.current.src = url;
    chatAudioRef.current.load();
    try {
      await unlockAudioForIOS();
      await chatAudioRef.current.play();
    } catch {
      // ignore
    }
  };

  const sendChat = async (opts: { inputText?: string; inputAudioBase64?: string; inputAudioMime?: string }) => {
    if (!story.trim() || chatBusy) return;
    const inputText = opts.inputText?.trim() || "";
    const inputAudioBase64 = opts.inputAudioBase64 || "";
    const inputAudioMime = opts.inputAudioMime || "";
    if (!inputText && !inputAudioBase64) return;

    setChatBusy(true);
    setChatError("");

    if (inputText) {
      setChatMessages((prev) => [...prev, { role: "user", content: inputText }]);
    } else {
      setChatMessages((prev) => [...prev, { role: "user", content: "（语音）" }]);
    }

    try {
      const history = [...chatMessagesRef.current].slice(-10);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          seed,
          story,
          history,
          inputText: inputText || undefined,
          inputAudioBase64: inputAudioBase64 || undefined,
          inputAudioMime: inputAudioMime || undefined,
        }),
      });
      const rawText = await res.text();
      let data: ChatResult;
      try {
        data = JSON.parse(rawText) as ChatResult;
      } catch {
        throw new Error(rawText || `请求失败：${res.status} ${res.statusText}`);
      }
      if (!data.ok) throw new Error(data.error);

      setConversationId(data.conversationId);
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.assistantText }]);
      if (data.assistantAudioBase64 && data.assistantAudioMime) {
        await playChatAudio(data.assistantAudioBase64, data.assistantAudioMime);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "对话失败";
      setChatError(msg);
    } finally {
      setChatBusy(false);
    }
  };

  const tapInput = () => {
    const el = textareaRef.current;
    el?.focus();
    // WeChat iOS webview sometimes needs a nudge to avoid being hidden by the keyboard.
    if (el && typeof el.scrollIntoView === "function") {
      requestAnimationFrame(() => {
        try {
          el.scrollIntoView({ block: "center" });
        } catch {
          // ignore
        }
      });
    }
  };

  return (
    <div className="app-shell relative flex items-stretch justify-center overflow-hidden bg-[radial-gradient(1200px_700px_at_30%_10%,rgba(255,90,165,0.40),transparent_60%),radial-gradient(900px_600px_at_70%_25%,rgba(124,92,255,0.22),transparent_60%),linear-gradient(180deg,#fff6fb,#ffe7f3_55%,#fff6fb)] px-[max(16px,env(safe-area-inset-left))] py-[max(16px,env(safe-area-inset-top))] md:px-[max(32px,env(safe-area-inset-left))] md:py-[max(28px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,90,165,0.50),transparent_60%)] blur-2xl" />
      <main className="relative w-full max-w-none pb-[max(18px,env(safe-area-inset-bottom))] xl:max-w-[1400px] 2xl:max-w-[1600px]">
        {busy ? (
          <div className="absolute inset-0 z-50 flex items-center justify-center px-4 py-6">
            <div className="absolute inset-0 bg-white/55 backdrop-blur-sm" />
            <div className="relative w-full max-w-[560px] rounded-3xl border border-black/10 bg-white/80 p-6 text-center shadow-[0_22px_60px_rgba(0,0,0,0.12)]">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-[linear-gradient(135deg,var(--pink-500),var(--lav-500))] text-3xl text-white shadow-[0_14px_30px_rgba(255,63,150,0.28)]">
                ✨
              </div>
              <div className="mt-4 text-lg font-semibold text-black/80">
                正在变魔法…
              </div>
              <div className="mt-2 text-sm text-black/60">
                {busySeconds < 6
                  ? "海皮老师在编故事"
                  : busySeconds < 14
                    ? "马上就好，别关页面哦"
                    : "如果网慢会久一点点，我们一起等一下下"}
              </div>
              <div className="mt-4 flex items-center justify-center gap-2">
                <div className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--pink-500)] [animation-delay:0ms]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--lav-500)] [animation-delay:150ms]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--pink-400)] [animation-delay:300ms]" />
              </div>
              <div className="mt-5 text-xs text-black/50">
                请不要关闭或切换页面
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] md:gap-6 lg:grid-cols-[minmax(420px,520px)_minmax(0,1fr)] lg:gap-8">
          <div className="rounded-3xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5 shadow-[var(--shadow)] backdrop-blur md:flex md:flex-col md:p-6 lg:p-8">
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
            className="mt-4 w-full rounded-3xl border border-black/5 bg-white/70 p-4 text-left shadow-sm active:scale-[0.99] md:p-5"
            onClick={tapInput}
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
                className="min-h-[64px] w-full resize-none bg-transparent text-lg leading-7 outline-none placeholder:text-black/30 md:min-h-[88px] md:text-xl md:leading-8 lg:min-h-[104px] lg:text-2xl lg:leading-9"
                aria-label="随便输入"
              />
            </div>
          </button>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={!canGenerate}
              className="group relative flex h-16 flex-1 items-center justify-center gap-3 rounded-3xl bg-[linear-gradient(135deg,var(--pink-500),var(--lav-500))] text-white shadow-[0_14px_30px_rgba(255,63,150,0.28)] disabled:opacity-40 md:h-18 lg:h-20"
              aria-label="生成故事"
            >
              <span className={busy ? "animate-pulse" : ""}>
                <SparkleIcon />
              </span>
              <span className="text-base font-semibold tracking-wide md:text-lg lg:text-xl">
                {busy ? "..." : "开始"}
              </span>
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioUrl}
              className="grid h-16 w-16 place-items-center rounded-3xl border border-black/5 bg-white/70 text-[color:var(--pink-600)] shadow-sm disabled:opacity-40 active:scale-[0.98] md:h-18 md:w-18 lg:h-20 lg:w-20"
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

          <div className="rounded-3xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5 shadow-[var(--shadow)] backdrop-blur md:flex md:flex-col md:p-6 lg:p-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(255,90,165,0.22),rgba(124,92,255,0.18))] text-[color:var(--pink-600)]">
                <span className="text-2xl" aria-hidden="true">
                  ♪
                </span>
              </div>
              <div className="text-sm font-medium text-black/70 md:text-base lg:text-lg">
                点击右侧喇叭听故事
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                hasUserToggledShowTextRef.current = true;
                setShowText((v) => !v);
              }}
              className="rounded-2xl border border-black/5 bg-white/70 px-4 py-2 text-sm text-black/70 shadow-sm active:scale-[0.99]"
              aria-label="显示或隐藏文字"
            >
              Aa
            </button>
          </div>

          {showText ? (
            <div className="mt-4 overflow-auto rounded-3xl border border-black/5 bg-white/70 p-4 text-[15px] leading-7 text-black/80 md:flex-1 md:p-6 md:text-lg md:leading-9 lg:p-8 lg:text-xl lg:leading-10">
              {story ? story : "（还没有故事）"}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-3 md:flex-1 md:content-center md:gap-6">
              <button
                type="button"
                onClick={tapInput}
                className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center shadow-sm active:scale-[0.99] md:p-6 lg:p-8"
                aria-label="点：回到输入"
              >
                <div className="text-2xl" aria-hidden="true">
                  👆
                </div>
                <div className="mt-2 text-xs text-black/55 md:text-sm lg:text-base">点</div>
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate}
                className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center shadow-sm disabled:opacity-40 active:scale-[0.99] md:p-6 lg:p-8"
                aria-label="变：再生成一次"
              >
                <div className="text-2xl" aria-hidden="true">
                  ✨
                </div>
                <div className="mt-2 text-xs text-black/55 md:text-sm lg:text-base">变</div>
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!audioUrl}
                className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center shadow-sm disabled:opacity-40 active:scale-[0.99] md:p-6 lg:p-8"
                aria-label="听：播放或暂停"
              >
                <div className="text-2xl" aria-hidden="true">
                  🔊
                </div>
                <div className="mt-2 text-xs text-black/55 md:text-sm lg:text-base">听</div>
              </button>
            </div>
          )}

          {showText ? (
            <div className="mt-4 hidden grid-cols-3 gap-3 md:grid md:gap-6">
              <button
                type="button"
                onClick={tapInput}
                className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center shadow-sm active:scale-[0.99] lg:p-6"
                aria-label="点：回到输入"
              >
                <div className="text-2xl" aria-hidden="true">
                  👆
                </div>
                <div className="mt-2 text-xs text-black/55 md:text-sm lg:text-base">
                  点
                </div>
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate}
                className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center shadow-sm disabled:opacity-40 active:scale-[0.99] lg:p-6"
                aria-label="变：再生成一次"
              >
                <div className="text-2xl" aria-hidden="true">
                  ✨
                </div>
                <div className="mt-2 text-xs text-black/55 md:text-sm lg:text-base">
                  变
                </div>
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!audioUrl}
                className="rounded-3xl border border-black/5 bg-white/60 p-4 text-center shadow-sm disabled:opacity-40 active:scale-[0.99] lg:p-6"
                aria-label="听：播放或暂停"
              >
                <div className="text-2xl" aria-hidden="true">
                  🔊
                </div>
                <div className="mt-2 text-xs text-black/55 md:text-sm lg:text-base">
                  听
                </div>
              </button>
            </div>
          ) : null}

          {story ? (
            <div className="mt-4 rounded-3xl border border-black/5 bg-white/70 p-4 shadow-sm md:p-6 lg:p-8">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-black/75 md:text-base">
                  海皮老师聊一聊
                </div>
                <div className="text-xs text-black/45">
                  {chatBusy ? "思考中…" : recording ? "录音中…" : ""}
                </div>
              </div>

              <div className="mt-3 max-h-[38vh] space-y-2 overflow-auto rounded-2xl border border-black/5 bg-white/70 p-3">
                {chatMessages.length === 0 ? (
                  <div className="text-sm text-black/55">
                    你可以按下麦克风说话，或者打字问海皮老师关于这个故事的问题。
                  </div>
                ) : null}

                {chatMessages.map((m, idx) => (
                  <div
                    key={`${m.role}-${idx}`}
                    className={
                      m.role === "assistant"
                        ? "rounded-2xl bg-[rgba(255,90,165,0.10)] px-3 py-2 text-[15px] leading-7 text-black/80"
                        : "rounded-2xl bg-black/5 px-3 py-2 text-[15px] leading-7 text-black/80"
                    }
                  >
                    <div className="text-[11px] font-semibold text-black/45">
                      {m.role === "assistant" ? "海皮" : "孩子"}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                ))}
              </div>

              {chatError ? (
                <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {chatError}
                </div>
              ) : null}

              <div className="mt-3">
                <button
                  type="button"
                  disabled={chatBusy || !navigator.mediaDevices}
                  onPointerDown={(e) => {
                    if (chatBusy) return;
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      // ignore
                    }
                    void startRecording();
                  }}
                  onPointerUp={() => stopRecordingAndSend()}
                  onPointerCancel={() => stopRecordingNow()}
                  onPointerLeave={() => {
                    if (recording) stopRecordingNow();
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-full select-none rounded-3xl bg-[linear-gradient(135deg,var(--pink-500),var(--lav-500))] px-6 py-5 text-center text-base font-semibold text-white shadow-[0_14px_30px_rgba(255,63,150,0.28)] disabled:opacity-40 active:scale-[0.99] md:text-lg"
                  aria-label="按住说话，松开发送"
                >
                  {recording ? "松开我，海皮开口" : "按住我，说给海皮听"}
                </button>
                <div className="mt-2 text-center text-xs text-black/50">
                  按住说话，松开发送（需要麦克风权限）
                </div>
              </div>
            </div>
          ) : null}
          </div>
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

        <audio ref={chatAudioRef} playsInline preload="auto" className="hidden" />
      </main>
    </div>
  );
}
