"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type GenerateEnResult =
  | {
      ok: true;
      story: string;
      lang: "en";
      generationId?: string;
      requestId?: string;
    }
  | {
      ok: false;
      error: string;
      requestId?: string;
    };

type GenerateBilingualResult =
  | {
      ok: true;
      generationId: string;
      seed: string;
      storyZh: string;
      storyEn: string;
      requestId?: string;
    }
  | {
      ok: false;
      error: string;
      requestId?: string;
    };

type TtsResult =
  | {
      ok: true;
      audioBase64: string;
      audioMime: string;
      lang: "zh" | "en";
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

function resampleLinear(input: Float32Array, inRate: number, outRate: number) {
  if (inRate === outRate) return input;
  const ratio = outRate / inRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const src = i / ratio;
    const idx = Math.floor(src);
    const frac = src - idx;
    const a = input[idx] ?? input[input.length - 1] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function audioBufferToWavBlob(
  audioBuffer: AudioBuffer,
  opts?: { targetSampleRate?: number; maxDurationSec?: number },
) {
  const targetSampleRate = opts?.targetSampleRate ?? 16000;
  const maxDurationSec = opts?.maxDurationSec ?? 8;
  const sampleRate = audioBuffer.sampleRate;
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  // Downmix to mono to reduce size.
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channelCount; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / channelCount;
  }

  let samples = resampleLinear(mono, sampleRate, targetSampleRate);
  const maxSamples = Math.max(1, Math.round(targetSampleRate * maxDurationSec));
  if (samples.length > maxSamples) {
    samples = samples.slice(0, maxSamples);
  }

  const bytesPerSample = 2;
  const blockAlign = 1 * bytesPerSample;
  const byteRate = targetSampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function audioBlobToWavBase64(blob: Blob) {
  const AnyWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = AnyWindow.AudioContext ?? AnyWindow.webkitAudioContext;
  if (!AudioContextCtor) throw new Error("当前浏览器不支持音频处理");

  const ctx = new AudioContextCtor();
  try {
    const arrayBuf = await withTimeout(blob.arrayBuffer(), 3000, "audio arrayBuffer");
    const audioBuffer = await withTimeout(
      ctx.decodeAudioData(arrayBuf.slice(0)),
      3500,
      "audio decode",
    );
    const wavBlob = audioBufferToWavBlob(audioBuffer, {
      targetSampleRate: 16000,
      maxDurationSec: 8,
    });
    const base64 = await withTimeout(blobToBase64(wavBlob), 3000, "wav encode");
    return { base64, mime: "audio/wav" };
  } finally {
    try {
      await ctx.close();
    } catch {
      // ignore
    }
  }
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

  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const timeoutMs = 500;

  try {
    const ctx = new AudioContextCtor();
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    if (ctx.state === "suspended") {
      await Promise.race([ctx.resume(), delay(timeoutMs)]);
    }
    void Promise.race([ctx.close(), delay(timeoutMs)]).catch(() => {
      // ignore
    });
  } catch {
    // ignore
  }
}

async function primeAudioElementForIOS(audio: HTMLAudioElement | null) {
  if (!audio) return;
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const timeoutMs = 800;

  // A tiny silent wav. Used to satisfy iOS autoplay restrictions during a user gesture.
  const silentWavDataUrl =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

  const prevSrc = audio.currentSrc || audio.src;
  const prevMuted = audio.muted;
  const prevVolume = audio.volume;

  try {
    audio.muted = true;
    audio.volume = 0;
    audio.src = silentWavDataUrl;
    audio.load();
    await Promise.race([audio.play(), delay(timeoutMs)]);
  } catch {
    // ignore
  } finally {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // ignore
    }
    audio.muted = prevMuted;
    audio.volume = prevVolume;
    if (prevSrc) {
      audio.src = prevSrc;
      try {
        audio.load();
      } catch {
        // ignore
      }
    }
  }
}

export default function StoryToy() {
  const [seed, setSeed] = useState("");
  const [generationId, setGenerationId] = useState<string>("");
  const [storyZh, setStoryZh] = useState<string>("");
  const [storyEn, setStoryEn] = useState<string>("");
  const [speakLang, setSpeakLang] = useState<"zh" | "en">("zh");
  const [audioUrlZh, setAudioUrlZh] = useState<string>("");
  const [audioUrlEn, setAudioUrlEn] = useState<string>("");
  const [enBusy, setEnBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  const [busySeconds, setBusySeconds] = useState(0);
  const [busyStage, setBusyStage] = useState<"story" | "tts">("story");
  const [conversationId, setConversationId] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [recording, setRecording] = useState(false);
  const [chatPhase, setChatPhase] = useState<
    "idle" | "recording" | "encoding" | "thinking" | "speaking"
  >("idle");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const systemUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingSpeakTextRef = useRef<string>("");
  const pendingSpeakLangRef = useRef<"zh" | "en">("zh");
  const hasPromptedMicRef = useRef(false);
  const speakOnGestureArmedRef = useRef(false);
  const pendingChatSpeakTextRef = useRef<string>("");
  const pendingChatSpeakLangRef = useRef<"zh" | "en">("zh");
  const chatSpeakOnGestureArmedRef = useRef(false);
  const pendingChatPlayUrlRef = useRef<string>("");
  const chatPlayOnGestureArmedRef = useRef(false);
  const keepAliveAudioCtxRef = useRef<AudioContext | null>(null);
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);
  const keepAliveGainRef = useRef<GainNode | null>(null);
  const chatPressingRef = useRef(false);
  const recordStopWatchdogRef = useRef<number | null>(null);
  const recordStopAttemptRef = useRef(0);
  const pressStartedAtRef = useRef<number>(0);
  const touchActiveRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cleanupZhUrlRef = useRef<string>("");
  const cleanupEnUrlRef = useRef<string>("");
  const chatCleanupUrlRef = useRef<string>("");
  const hasUserToggledShowTextRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const abortRecordingRef = useRef(false);
  const wakeLockRef = useRef<unknown>(null);

  const canSystemSpeak = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
    );
  }, []);

  const canGenerate = useMemo(() => seed.trim().length > 0 && !busy, [seed, busy]);

  const activeStory = useMemo(() => {
    return speakLang === "en" ? storyEn.trim() : storyZh.trim();
  }, [speakLang, storyZh, storyEn]);

  const activeAudioUrl = useMemo(() => {
    return speakLang === "en" ? audioUrlEn : audioUrlZh;
  }, [speakLang, audioUrlEn, audioUrlZh]);

  const shouldDefaultShowText = () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  };

  const isWeChat = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /micromessenger/i.test(navigator.userAgent);
  }, []);

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /ipad|iphone|ipod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    const setAppHeight = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        "--app-height",
        `${Math.round(height)}px`,
      );
      if (!hasUserToggledShowTextRef.current && !storyZh.trim() && !storyEn.trim()) {
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
  }, [storyZh, storyEn]);

  useEffect(() => {
    return () => {
      if (cleanupZhUrlRef.current) URL.revokeObjectURL(cleanupZhUrlRef.current);
      if (cleanupEnUrlRef.current) URL.revokeObjectURL(cleanupEnUrlRef.current);
      if (chatCleanupUrlRef.current) URL.revokeObjectURL(chatCleanupUrlRef.current);
      if (canSystemSpeak) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
      try {
        keepAliveOscRef.current?.stop();
      } catch {
        // ignore
      }
      keepAliveOscRef.current = null;
      try {
        void keepAliveAudioCtxRef.current?.close();
      } catch {
        // ignore
      }
      keepAliveAudioCtxRef.current = null;
      keepAliveGainRef.current = null;
    };
  }, [canSystemSpeak]);

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
    if (!isWeChat) return;
    const handler = () => {
      void primeAudioElementForIOS(audioRef.current);
      void primeAudioElementForIOS(chatAudioRef.current);
      void unlockAudioForIOS();
      void ensureAudioSession();
      if (canSystemSpeak) {
        try {
          window.speechSynthesis.getVoices();
        } catch {
          // ignore
        }
      }
    };
    document.addEventListener("WeixinJSBridgeReady", handler);
    return () => document.removeEventListener("WeixinJSBridgeReady", handler);
  }, [isWeChat, canSystemSpeak]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const stopSystemSpeak = () => {
    if (!canSystemSpeak) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    systemUtteranceRef.current = null;
  };

  const friendlyGenerateFailure = () => {
    return "小故事正在排队，等一下下～你也可以再点一次「开始」试试。";
  };

  const friendlyNeedTapSpeaker = () => {
    return "iPad 需要你点一下喇叭我才能开口哦～";
  };

  const createGenerationId = () => {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {
      // ignore
    }
    return `g_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  // Intentionally keep this helper unused for now. The app prefers single-call bilingual generation
  // for stability on iPad/WeChat. If needed later, it can be used as a fallback path.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loadEnglishStory = async (opts: { seed: string; generationId: string }) => {
    setEnBusy(true);
    try {
      const res = await fetch("/api/generate-en", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: opts.seed, generationId: opts.generationId }),
      });
      const rawText = await res.text();
      let data: GenerateEnResult;
      try {
        data = JSON.parse(rawText) as GenerateEnResult;
      } catch {
        throw new Error(rawText || `请求失败：${res.status} ${res.statusText}`);
      }
      if (!data.ok) throw new Error(data.error);
      setStoryEn(data.story);
    } catch (e) {
      console.warn("[/api/generate-en] failed", e);
      setStoryEn("");
    } finally {
      setEnBusy(false);
    }
  };

  const requestMicPermissionOnce = async () => {
    if (hasPromptedMicRef.current) return;
    hasPromptedMicRef.current = true;
    if (!navigator.mediaDevices?.getUserMedia) return;
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    try {
      const stream = (await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        delay(1500).then(() => null),
      ])) as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
  };

  const ensureAudioSession = async () => {
    const AnyWindow = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = AnyWindow.AudioContext ?? AnyWindow.webkitAudioContext;
    if (!AudioContextCtor) return false;

    let ctx = keepAliveAudioCtxRef.current;
    try {
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioContextCtor();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const osc = ctx.createOscillator();
        osc.frequency.value = 440;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        keepAliveAudioCtxRef.current = ctx;
        keepAliveOscRef.current = osc;
        keepAliveGainRef.current = gain;
      }
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      return true;
    } catch {
      return false;
    }
  };

  const addOneTimeGestureListener = (handler: () => void) => {
    const wrapped = () => {
      try {
        handler();
      } finally {
        window.removeEventListener("pointerdown", wrapped, true);
        window.removeEventListener("touchstart", wrapped, true);
        window.removeEventListener("click", wrapped, true);
      }
    };
    window.addEventListener("pointerdown", wrapped, { once: true, capture: true });
    window.addEventListener("touchstart", wrapped, { once: true, capture: true });
    window.addEventListener("click", wrapped, { once: true, capture: true });
  };

  const scheduleSpeakOnNextGesture = () => {
    if (!canSystemSpeak) return;
    if (speakOnGestureArmedRef.current) return;
    if (!pendingSpeakTextRef.current.trim()) return;
    speakOnGestureArmedRef.current = true;
    addOneTimeGestureListener(() => {
      speakOnGestureArmedRef.current = false;
      const text = pendingSpeakTextRef.current.trim();
      if (!text) return;
      void speakWithSystem(text, pendingSpeakLangRef.current);
    });
  };

  const scheduleChatSpeakOnNextGesture = () => {
    if (!canSystemSpeak) return;
    if (chatSpeakOnGestureArmedRef.current) return;
    if (!pendingChatSpeakTextRef.current.trim()) return;
    chatSpeakOnGestureArmedRef.current = true;
    addOneTimeGestureListener(() => {
      chatSpeakOnGestureArmedRef.current = false;
      const text = pendingChatSpeakTextRef.current.trim();
      if (!text) return;
      void speakChatWithSystem(text, pendingChatSpeakLangRef.current);
    });
  };

  const speakWithSystem = async (text: string, lang: "zh" | "en") => {
    if (!canSystemSpeak) return false;
    const t = text.trim();
    if (!t) return false;
    void unlockAudioForIOS();
    stopSystemSpeak();
    pendingSpeakTextRef.current = "";
    const utterance = new SpeechSynthesisUtterance(t);
    utterance.lang = lang === "en" ? "en-US" : "zh-CN";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => setPlaying(true);
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    systemUtteranceRef.current = utterance;
    try {
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      setPlaying(false);
      pendingSpeakTextRef.current = t;
      pendingSpeakLangRef.current = lang;
      scheduleSpeakOnNextGesture();
      return false;
    }
  };

  const speakChatWithSystem = async (text: string, lang: "zh" | "en") => {
    if (!canSystemSpeak) return false;
    const t = text.trim();
    if (!t) return false;
    void unlockAudioForIOS();
    stopSystemSpeak();
    pendingChatSpeakTextRef.current = "";
    const utterance = new SpeechSynthesisUtterance(t);
    utterance.lang = lang === "en" ? "en-US" : "zh-CN";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => setChatPhase("speaking");
    utterance.onend = () => setChatPhase("idle");
    utterance.onerror = () => setChatPhase("idle");
    systemUtteranceRef.current = utterance;
    try {
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      pendingChatSpeakTextRef.current = t;
      pendingChatSpeakLangRef.current = lang;
      scheduleChatSpeakOnNextGesture();
      return false;
    }
  };

  const scheduleChatPlayOnNextGesture = () => {
    if (chatPlayOnGestureArmedRef.current) return;
    if (!pendingChatPlayUrlRef.current.trim()) return;
    if (!chatAudioRef.current) return;
    chatPlayOnGestureArmedRef.current = true;
    addOneTimeGestureListener(() => {
      chatPlayOnGestureArmedRef.current = false;
      void (async () => {
        const audio = chatAudioRef.current;
        const url = pendingChatPlayUrlRef.current;
        if (!audio || !url) return;
        await primeAudioElementForIOS(audio);
        await ensureAudioSession();
        audio.src = url;
        audio.load();
        try {
          await unlockAudioForIOS();
          await audio.play();
        } catch {
          scheduleChatPlayOnNextGesture();
        }
      })();
    });
  };

  const stopChatAudio = () => {
    try {
      chatAudioRef.current?.pause();
      if (chatAudioRef.current) chatAudioRef.current.currentTime = 0;
    } catch {
      // ignore
    }
    pendingChatPlayUrlRef.current = "";
    pendingChatSpeakTextRef.current = "";
    setChatPhase("idle");
  };

  const beginHoldToRecord = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (touchActiveRef.current) return;
    if (chatBusy || chatSending || !navigator.mediaDevices) return;
    chatPressingRef.current = true;
    pressStartedAtRef.current = Date.now();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    void requestMicPermissionOnce();
    void startRecording();
  };

  const beginHoldToRecordTouch = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (chatBusy || chatSending || !navigator.mediaDevices) return;
    touchActiveRef.current = true;
    chatPressingRef.current = true;
    pressStartedAtRef.current = Date.now();
    void requestMicPermissionOnce();
    void startRecording();
    // Avoid generating synthetic mouse/click events that could interfere with hold-to-record.
    try {
      e.preventDefault();
    } catch {
      // ignore
    }
  };

  const endHoldToRecord = () => {
    chatPressingRef.current = false;
    const heldMs = Math.max(0, Date.now() - (pressStartedAtRef.current || 0));
    pressStartedAtRef.current = 0;

    // If recording has started (or recorder exists), releasing ends and sends.
    const recorder = mediaRecorderRef.current;
    const isActiveRecorder = Boolean(recorder && recorder.state !== "inactive");
    const minHoldMs = 200;
    if ((recording || isActiveRecorder) && heldMs >= minHoldMs) {
      stopRecordingAndSend();
      return;
    }
    // Short hold: cancel quietly to avoid accidental taps sending.
    if (recording || isActiveRecorder) stopRecordingNow();
  };

  const stopRecordingNow = () => {
    abortRecordingRef.current = true;
    setChatSending(false);
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
    setChatPhase("idle");
  };

  const stopRecordingAndSend = () => {
    abortRecordingRef.current = false;
    setChatSending(true);
    setChatPhase("encoding");

    recordStopAttemptRef.current += 1;
    const attemptId = recordStopAttemptRef.current;
    if (recordStopWatchdogRef.current) window.clearTimeout(recordStopWatchdogRef.current);
    recordStopWatchdogRef.current = window.setTimeout(() => {
      if (attemptId !== recordStopAttemptRef.current) return;
      // If MediaRecorder never fires onstop (seen on some iPhone/WeChat builds),
      // keep the convo moving instead of getting stuck on "sending".
      setChatSending(false);
      setChatPhase("thinking");
      void sendChat({ inputText: "（刚才声音没发出去，我再说一遍～）" });
    }, 3500);

    try {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          // Flush final chunk ASAP for short recordings (iOS/WeChat).
          recorder.requestData();
        } catch {
          // ignore
        }
        recorder.stop();
      } else {
        // No active recorder; fall back to a text nudge instead of getting stuck.
        if (recordStopWatchdogRef.current) window.clearTimeout(recordStopWatchdogRef.current);
        recordStopWatchdogRef.current = null;
        setChatSending(false);
        setChatPhase("thinking");
        void sendChat({ inputText: "（我没听到声音，你再说一遍～）" });
      }
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
    stopSystemSpeak();
    stopChatAudio();
    setSeed("");
    setGenerationId("");
    setStoryZh("");
    setStoryEn("");
    setSpeakLang("zh");
    setEnBusy(false);
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
    if (cleanupZhUrlRef.current) {
      URL.revokeObjectURL(cleanupZhUrlRef.current);
      cleanupZhUrlRef.current = "";
    }
    if (cleanupEnUrlRef.current) {
      URL.revokeObjectURL(cleanupEnUrlRef.current);
      cleanupEnUrlRef.current = "";
    }
    if (chatCleanupUrlRef.current) {
      URL.revokeObjectURL(chatCleanupUrlRef.current);
      chatCleanupUrlRef.current = "";
    }
    setAudioUrlZh("");
    setAudioUrlEn("");
    textareaRef.current?.focus();
  };

  const generate = async () => {
    if (!canGenerate) return;

    stopRecordingNow();
    stopSystemSpeak();
    setBusy(true);
    setBusySeconds(0);
    setBusyStage("story");
    setError("");
    if (!hasUserToggledShowTextRef.current) setShowText(shouldDefaultShowText());
    setPlaying(false);
    setSpeakLang("zh");
    setConversationId("");
    setChatMessages([]);
    setChatError("");
    if (audioRef.current) audioRef.current.pause();

    const newGenId = createGenerationId();
    setGenerationId(newGenId);
    setStoryZh("");
    setStoryEn("");
    setAudioUrlZh("");
    setAudioUrlEn("");
    if (cleanupZhUrlRef.current) {
      URL.revokeObjectURL(cleanupZhUrlRef.current);
      cleanupZhUrlRef.current = "";
    }
    if (cleanupEnUrlRef.current) {
      URL.revokeObjectURL(cleanupEnUrlRef.current);
      cleanupEnUrlRef.current = "";
    }

    // Prime audio permissions within the user gesture (iOS Safari).
    void requestMicPermissionOnce();
    await primeAudioElementForIOS(audioRef.current);
    void unlockAudioForIOS();
    if (canSystemSpeak) {
      try {
        window.speechSynthesis.getVoices();
      } catch {
        // ignore
      }
    }

    try {
      // Single-call bilingual generation to reduce network round-trips on iPad/WeChat.
      const res = await fetch("/api/generate-bilingual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed, generationId: newGenId }),
      });

      let data: GenerateBilingualResult;
      const rawText = await res.text();
      try {
        data = JSON.parse(rawText) as GenerateBilingualResult;
      } catch {
        throw new Error(rawText || `请求失败：${res.status} ${res.statusText}`);
      }
      if (!data.ok) throw new Error(data.error);

      setGenerationId(data.generationId || newGenId);
      setStoryZh(data.storyZh);
      setStoryEn(data.storyEn);
      if (!hasUserToggledShowTextRef.current) {
        try {
          if (window.matchMedia("(max-width: 480px)").matches) setShowText(true);
        } catch {
          // ignore
        }
      }
      setBusyStage("tts");
      try {
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ story: data.storyZh, lang: "zh" }),
        });

        const ttsText = await ttsRes.text();
        let ttsData: TtsResult;
        try {
          ttsData = JSON.parse(ttsText) as TtsResult;
        } catch {
          throw new Error(
            ttsText || `语音请求失败：${ttsRes.status} ${ttsRes.statusText}`,
          );
        }
        if (!ttsData.ok) throw new Error(ttsData.error);

        const url = base64ToObjectUrl(ttsData.audioBase64, ttsData.audioMime);
        if (cleanupZhUrlRef.current) URL.revokeObjectURL(cleanupZhUrlRef.current);
        cleanupZhUrlRef.current = url;
        setAudioUrlZh(url);

        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
          try {
            await audioRef.current.play();
            setPlaying(true);
          } catch (playErr) {
            setPlaying(false);
            console.warn("[audio.play] failed", playErr);
            pendingSpeakLangRef.current = "zh";
            const spoke = await speakWithSystem(data.storyZh, "zh");
            if (!spoke) {
              pendingSpeakTextRef.current = data.storyZh;
              scheduleSpeakOnNextGesture();
              setError(friendlyNeedTapSpeaker());
            }
          }
        }
      } catch (e) {
        console.warn("[/api/tts] failed", e);
        setAudioUrlZh("");
        pendingSpeakLangRef.current = "zh";
        const spoke = await speakWithSystem(data.storyZh, "zh");
        if (!spoke) {
          pendingSpeakTextRef.current = data.storyZh;
          scheduleSpeakOnNextGesture();
        }
        setError(spoke ? "我先用系统声音读给你听～" : friendlyNeedTapSpeaker());
      }
    } catch (e) {
      console.warn("[/api/generate] failed", e);
      setError(friendlyGenerateFailure());
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (activeAudioUrl && audio) {
      try {
        if (audio.paused || audio.currentSrc !== activeAudioUrl) {
          await unlockAudioForIOS();
          if (audio.currentSrc !== activeAudioUrl) {
            audio.src = activeAudioUrl;
            audio.load();
          }
          await audio.play();
          setPlaying(true);
        } else {
          audio.pause();
          setPlaying(false);
        }
      } catch (e) {
        setPlaying(false);
        if (activeStory.trim() && canSystemSpeak) {
          console.warn("[audio.play] failed (toggle)", e);
          pendingSpeakLangRef.current = speakLang;
          const spoke = await speakWithSystem(
            pendingSpeakTextRef.current || activeStory,
            speakLang,
          );
          if (!spoke) {
            scheduleSpeakOnNextGesture();
            setError(friendlyNeedTapSpeaker());
          }
        }
      }
      return;
    }

    if (speakLang === "en" && !storyEn.trim()) {
      if (enBusy) setError("英文故事还在变出来呢～等一下下。");
      return;
    }

    if (!activeStory.trim()) return;

    // Prefer server TTS (if configured). Fallback to system speak if TTS is unavailable/blocked.
    try {
      setError("");
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story: activeStory, lang: speakLang }),
      });
      const ttsText = await ttsRes.text();
      let ttsData: TtsResult;
      try {
        ttsData = JSON.parse(ttsText) as TtsResult;
      } catch {
        throw new Error(ttsText || `语音请求失败：${ttsRes.status} ${ttsRes.statusText}`);
      }
      if (!ttsData.ok) throw new Error(ttsData.error);

      const url = base64ToObjectUrl(ttsData.audioBase64, ttsData.audioMime);
      if (speakLang === "en") {
        if (cleanupEnUrlRef.current) URL.revokeObjectURL(cleanupEnUrlRef.current);
        cleanupEnUrlRef.current = url;
        setAudioUrlEn(url);
      } else {
        if (cleanupZhUrlRef.current) URL.revokeObjectURL(cleanupZhUrlRef.current);
        cleanupZhUrlRef.current = url;
        setAudioUrlZh(url);
      }

      if (audio) {
        audio.src = url;
        audio.load();
        await unlockAudioForIOS();
        await audio.play();
        setPlaying(true);
      }
    } catch {
      setPlaying(false);
      if (!canSystemSpeak) return;
      try {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          stopSystemSpeak();
          setPlaying(false);
          return;
        }
        pendingSpeakLangRef.current = speakLang;
        await speakWithSystem(pendingSpeakTextRef.current || activeStory, speakLang);
      } catch {
        setPlaying(false);
      }
    }
  };

  const pickRecordingMime = () => {
    const candidates = isIOS || isWeChat
      ? ["audio/mp4", "audio/mpeg", "audio/webm;codecs=opus", "audio/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
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
    if (recording || chatBusy || chatSending) return;
    setChatError("");
    try {
      // Prime audio permissions within the user gesture (iOS Safari).
      await primeAudioElementForIOS(chatAudioRef.current);
      await ensureAudioSession();
      void unlockAudioForIOS();
      if (canSystemSpeak) {
        try {
          window.speechSynthesis.getVoices();
        } catch {
          // ignore
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordedChunksRef.current = [];
      abortRecordingRef.current = false;
      const mimeType = pickRecordingMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      const hardStopMs = 8500;
      const hardStopId = window.setTimeout(() => {
        try {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
          }
        } catch {
          // ignore
        }
      }, hardStopMs);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        window.clearTimeout(hardStopId);
        if (recordStopWatchdogRef.current) window.clearTimeout(recordStopWatchdogRef.current);
        recordStopWatchdogRef.current = null;
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
        if (abortRecordingRef.current) {
          setChatSending(false);
          setChatPhase("idle");
          return;
        }
        if (!blob.size) {
          // Short press or iOS didn't flush data; still keep the conversation moving.
          try {
            setChatPhase("thinking");
            await sendChat({ inputText: "（没有录到声音）" });
          } finally {
            setChatSending(false);
          }
          return;
        }
        try {
          setChatPhase("encoding");
          try {
            const wav = await audioBlobToWavBase64(blob);
            setChatPhase("thinking");
            await sendChat({ inputAudioBase64: wav.base64, inputAudioMime: wav.mime });
          } catch {
            // Fallback: send original recording if decoding fails (common on iOS/WeChat for some codecs).
            const base64 = await withTimeout(blobToBase64(blob), 4500, "audio encode");
            const mime = recorder.mimeType || blob.type || "audio/mp4";
            setChatPhase("thinking");
            await sendChat({ inputAudioBase64: base64, inputAudioMime: mime });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "语音处理失败";
          setChatError(msg);
          setChatPhase("idle");
        } finally {
          setChatSending(false);
        }
      };
      recorder.start(100);
      setRecording(true);
      setChatPhase("recording");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "无法使用麦克风";
      setChatError(msg);
      setRecording(false);
      setChatPhase("idle");
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
    if (!chatAudioRef.current) return false;
    chatAudioRef.current.muted = false;
    chatAudioRef.current.volume = 1;
    chatAudioRef.current.src = url;
    chatAudioRef.current.load();
    try {
      await ensureAudioSession();
      await unlockAudioForIOS();
      await chatAudioRef.current.play();
      return true;
    } catch {
      return false;
    }
  };

  const sendChat = async (opts: {
    inputText?: string;
    inputAudioBase64?: string;
    inputAudioMime?: string;
  }) => {
    const storyForChat = speakLang === "en" ? storyEn.trim() : storyZh.trim();
    if (!storyForChat || chatBusy) return;
    const inputText = opts.inputText?.trim() || "";
    const inputAudioBase64 = opts.inputAudioBase64 || "";
    const inputAudioMime = opts.inputAudioMime || "";
    if (!inputText && !inputAudioBase64) return;

    setChatBusy(true);
    setChatError("");
    stopSystemSpeak();
    stopChatAudio();
    setChatPhase("thinking");

    if (inputText) {
      setChatMessages((prev) => [...prev, { role: "user", content: inputText }]);
    } else {
      setChatMessages((prev) => [...prev, { role: "user", content: "（语音）" }]);
    }

    try {
      const history = [...chatMessagesRef.current].slice(-8);
      const controller = new AbortController();
      const reqTimeoutMs = 16000;
      const tid = window.setTimeout(() => controller.abort(), reqTimeoutMs);
      let res: Response;
      try {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            conversationId: conversationId || undefined,
            seed,
            lang: speakLang,
            generationId: generationId || undefined,
            story: storyForChat,
            storyZh: storyZh || undefined,
            storyEn: storyEn || undefined,
            history,
            inputText: inputText || undefined,
            inputAudioBase64: inputAudioBase64 || undefined,
            inputAudioMime: inputAudioMime || undefined,
          }),
        });
      } finally {
        window.clearTimeout(tid);
      }
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
        const ok = await playChatAudio(data.assistantAudioBase64, data.assistantAudioMime);
        if (!ok) {
          pendingChatPlayUrlRef.current = chatCleanupUrlRef.current;
          scheduleChatPlayOnNextGesture();
          setChatPhase("idle");
          setChatError("轻点一下屏幕，海皮就开口啦～");

          if (canSystemSpeak) {
            pendingChatSpeakTextRef.current = data.assistantText;
            pendingChatSpeakLangRef.current = speakLang;
            const spoke = await speakChatWithSystem(data.assistantText, speakLang);
            if (!spoke) scheduleChatSpeakOnNextGesture();
          }
        }
      } else if (canSystemSpeak) {
        pendingChatSpeakTextRef.current = data.assistantText;
        pendingChatSpeakLangRef.current = speakLang;
        const spoke = await speakChatWithSystem(data.assistantText, speakLang);
        if (!spoke) {
          scheduleChatSpeakOnNextGesture();
          setChatError("轻点一下屏幕，海皮就开口啦～");
        }
      } else {
        setChatPhase("idle");
      }
    } catch (e) {
      console.warn("[/api/chat] failed", e);
      setChatError("海皮有点慢，我们再试一次～");
      setChatPhase("idle");
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

  const toggleSpeakLang = () => {
    const next = speakLang === "zh" ? "en" : "zh";
    stopSystemSpeak();
    try {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
    } catch {
      // ignore
    }
    setPlaying(false);
    setSpeakLang(next);

    // If the user explicitly switches language, try to start playback immediately
    // within the same user gesture (important on iOS/WeChat).
    if (next === "en") {
      if (!storyEn.trim()) {
        setError(enBusy ? "英文故事还在变出来呢～等一下下。" : "英文故事还没准备好～");
        return;
      }
      setError("");
      void (async () => {
        try {
          // Prefer server TTS for English to avoid system voice mismatches.
          const ttsRes = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ story: storyEn, lang: "en" }),
          });
          const ttsText = await ttsRes.text();
          let ttsData: TtsResult;
          try {
            ttsData = JSON.parse(ttsText) as TtsResult;
          } catch {
            throw new Error(ttsText || `语音请求失败：${ttsRes.status} ${ttsRes.statusText}`);
          }
          if (!ttsData.ok) throw new Error(ttsData.error);

          const url = base64ToObjectUrl(ttsData.audioBase64, ttsData.audioMime);
          if (cleanupEnUrlRef.current) URL.revokeObjectURL(cleanupEnUrlRef.current);
          cleanupEnUrlRef.current = url;
          setAudioUrlEn(url);

          const audio = audioRef.current;
          if (!audio) return;
          audio.src = url;
          audio.load();
          await ensureAudioSession();
          await unlockAudioForIOS();
          await audio.play();
          setPlaying(true);
        } catch (e) {
          console.warn("[toggleSpeakLang] EN play failed, falling back to system voice", e);
          pendingSpeakLangRef.current = "en";
          const spoke = await speakWithSystem(storyEn, "en");
          if (!spoke) {
            pendingSpeakTextRef.current = storyEn;
            scheduleSpeakOnNextGesture();
            setError(friendlyNeedTapSpeaker());
          }
        }
      })();
      return;
    }

    // Switching back to Chinese: try to play Chinese immediately if available.
    if (next === "zh" && storyZh.trim()) {
      setError("");
      void (async () => {
        try {
          if (audioUrlZh && audioRef.current) {
            audioRef.current.src = audioUrlZh;
            audioRef.current.load();
            await ensureAudioSession();
            await unlockAudioForIOS();
            await audioRef.current.play();
            setPlaying(true);
            return;
          }
        } catch {
          // ignore and fall back
        }
        pendingSpeakLangRef.current = "zh";
        const spoke = await speakWithSystem(storyZh, "zh");
        if (!spoke) {
          pendingSpeakTextRef.current = storyZh;
          scheduleSpeakOnNextGesture();
          setError(friendlyNeedTapSpeaker());
        }
      })();
    } else {
      setError("");
    }
  };

  return (
    <div className="app-shell relative flex items-stretch justify-center overflow-x-hidden overflow-y-auto bg-[radial-gradient(1200px_700px_at_30%_10%,rgba(255,90,165,0.40),transparent_60%),radial-gradient(900px_600px_at_70%_25%,rgba(124,92,255,0.22),transparent_60%),linear-gradient(180deg,#fff6fb,#ffe7f3_55%,#fff6fb)] px-[max(16px,env(safe-area-inset-left))] py-[max(16px,env(safe-area-inset-top))] md:px-[max(32px,env(safe-area-inset-left))] md:py-[max(28px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,90,165,0.50),transparent_60%)] blur-2xl" />
      <main className="relative w-full max-w-none pb-[max(18px,env(safe-area-inset-bottom))] max-[480px]:pb-[max(96px,env(safe-area-inset-bottom))] xl:max-w-[1400px] 2xl:max-w-[1600px]">
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
                {busyStage === "story"
                  ? busySeconds < 6
                    ? "海皮老师在编故事"
                    : busySeconds < 14
                      ? "故事快写好啦，别关页面哦"
                      : "故事有点长，我们一起等一下下"
                  : busySeconds < 6
                    ? "正在把故事变成声音"
                    : busySeconds < 14
                      ? "声音马上就来啦，别关页面哦"
                      : "网慢会久一点点，我们一起等一下下"}
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
        <div className="grid gap-4 max-[480px]:gap-3 md:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] md:gap-6 lg:grid-cols-[minmax(420px,520px)_minmax(0,1fr)] lg:gap-8">
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!activeStory.trim() && !activeAudioUrl}
                className="grid h-16 w-16 place-items-center rounded-3xl border border-black/5 bg-white/70 text-[color:var(--pink-600)] shadow-sm disabled:opacity-40 active:scale-[0.98] md:h-18 md:w-18 lg:h-20 lg:w-20"
                aria-label="播放或暂停"
              >
                <SpeakerIcon playing={playing} />
              </button>
              <button
                type="button"
                onClick={toggleSpeakLang}
                disabled={!storyZh.trim() && !storyEn.trim()}
                className={
                  "grid h-16 w-16 place-items-center rounded-3xl border border-black/5 bg-white/70 text-[color:var(--pink-600)] shadow-sm disabled:opacity-40 active:scale-[0.98] md:h-18 md:w-18 lg:h-20 lg:w-20"
                }
                aria-label={speakLang === "zh" ? "切换为英文朗读" : "切换为中文朗读"}
              >
                <span className="text-xl font-extrabold tracking-wide md:text-2xl lg:text-3xl">
                  {speakLang === "zh" ? "ABC" : "中"}
                </span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-3 rounded-2xl border border-black/5 bg-white/70 px-4 py-3 text-sm text-black/70">
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
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-black/45 md:text-sm">
                    中文
                  </div>
                  <div className="mt-2 whitespace-pre-wrap break-words">
                    {storyZh ? storyZh : "（还没有故事）"}
                  </div>
                </div>
                <div className="border-t border-black/5 pt-4">
                  <div className="text-xs font-semibold text-black/45 md:text-sm">
                    English
                  </div>
                  <div className="mt-2 whitespace-pre-wrap break-words">
                    {storyEn
                      ? storyEn
                      : enBusy
                        ? "（英文故事生成中…）"
                        : "（还没有英文故事）"}
                  </div>
                </div>
              </div>
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
                disabled={!activeStory.trim() && !activeAudioUrl}
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
                disabled={!activeStory.trim() && !activeAudioUrl}
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

          {activeStory ? (
            <div className="mt-4 rounded-3xl border border-black/5 bg-white/70 p-4 shadow-sm md:p-6 lg:p-8">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-black/75 md:text-base">
                  海皮老师聊一聊
                </div>
                <div className="text-xs text-black/45">
                  {chatPhase === "recording"
                    ? "录音中…"
                    : chatPhase === "encoding" || chatSending
                      ? "正在发送…"
                      : chatPhase === "thinking" || chatBusy
                        ? "海皮在想…"
                    : chatPhase === "speaking"
                      ? "海皮在说话…"
                      : ""}
                </div>
              </div>

              <div className="mt-3 max-h-[38vh] space-y-2 overflow-auto rounded-2xl border border-black/5 bg-white/70 p-3 max-[480px]:max-h-none max-[480px]:overflow-visible">
                {chatMessages.length === 0 ? (
                  <div className="text-sm text-black/55">
                    按住下面按钮说话，松开就发给海皮老师。
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
                <div className="mt-3 rounded-2xl border border-black/5 bg-white/70 px-4 py-3 text-sm text-black/70">
                  {chatError}
                </div>
              ) : null}

              {chatPhase === "encoding" || chatPhase === "thinking" || chatBusy || chatSending ? (
                <div className="mt-3 rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm text-black/70">
                  <div className="flex items-center justify-between">
                    <div>
                      {chatPhase === "encoding" || chatSending
                        ? "我在把声音发给海皮…"
                        : "海皮在想一个好玩的问题…"}
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--pink-500)] [animation-delay:0ms]" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--lav-500)] [animation-delay:150ms]" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-[color:var(--pink-400)] [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-3">
                <button
                  type="button"
                  disabled={chatBusy || chatSending || !navigator.mediaDevices}
                  onPointerDown={(e) => beginHoldToRecord(e)}
                  onPointerUp={() => endHoldToRecord()}
                  onPointerCancel={() => {
                    chatPressingRef.current = false;
                    pressStartedAtRef.current = 0;
                    stopRecordingNow();
                  }}
                  onTouchStart={(e) => beginHoldToRecordTouch(e)}
                  onTouchEnd={() => {
                    endHoldToRecord();
                    // Let pointer events work again after this touch sequence.
                    window.setTimeout(() => {
                      touchActiveRef.current = false;
                    }, 0);
                  }}
                  onTouchCancel={() => {
                    touchActiveRef.current = false;
                    chatPressingRef.current = false;
                    pressStartedAtRef.current = 0;
                    stopRecordingNow();
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-full touch-none select-none rounded-3xl bg-[linear-gradient(135deg,var(--pink-500),var(--lav-500))] px-6 py-5 text-center text-base font-semibold text-white shadow-[0_14px_30px_rgba(255,63,150,0.28)] disabled:opacity-40 active:scale-[0.99] md:text-lg"
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

        <audio
          ref={chatAudioRef}
          playsInline
          preload="auto"
          className="hidden"
          onPlay={() => setChatPhase("speaking")}
          onEnded={() => setChatPhase("idle")}
          onPause={() => setChatPhase("idle")}
        />
      </main>
    </div>
  );
}
