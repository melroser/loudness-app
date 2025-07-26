"use client";

import { useState, useRef, useEffect, ChangeEvent } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { motion } from "framer-motion";

interface WavePoint {
  time: number;
  peak: number;
}
interface LufsPoint {
  time: number;
  lufs: number;
}
interface AnalysisResult {
  lufs: number;
  peakDb: number;
  dynRange: number;
  waveformData: WavePoint[];
  lufsData: LufsPoint[];
}

type Platform = "Original" | "Spotify" | "Apple Music" | "Tidal" | "SoundCloud";

const PLATFORM_TARGETS: Record<Platform, number | null> = {
  Original: null,
  Spotify: -14,
  "Apple Music": -16,
  Tidal: -14,
  SoundCloud: -8,
};

const THEMES: Record<Platform, { bg: string; text: string; btn: string; btnHover: string; textAccent: string; sliderAccent: string }> = {
  Original: {
    bg: "bg-gray-300",
    text: "text-gray-900",
    btn: "bg-gray-400",
    btnHover: "hover:bg-gray-500",
    textAccent: "text-gray-800",
    sliderAccent: "accent-gray-700",
  },
  Spotify: {
    bg: "bg-green-900",
    text: "text-white",
    btn: "bg-green-600",
    btnHover: "hover:bg-green-500",
    textAccent: "text-green-300",
    sliderAccent: "accent-green-500",
  },
  "Apple Music": {
    bg: "bg-red-800",
    text: "text-white",
    btn: "bg-red-600",
    btnHover: "hover:bg-red-500",
    textAccent: "text-red-300",
    sliderAccent: "accent-red-500",
  },
  Tidal: {
    bg: "bg-neutral-900",
    text: "text-white",
    btn: "bg-neutral-700",
    btnHover: "hover:bg-neutral-600",
    textAccent: "text-neutral-300",
    sliderAccent: "accent-neutral-400",
  },
  SoundCloud: {
    bg: "bg-orange-700",
    text: "text-white",
    btn: "bg-orange-400",
    btnHover: "hover:bg-orange-200",
    textAccent: "text-orange-300",
    sliderAccent: "accent-orange-300",
  },
};

export default function LoudnessLab() {
  const [fileName, setFileName] = useState<string>("");
  const [audioURL, setAudioURL] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [platform, setPlatform] = useState<Platform>("Original");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  /*–––––– PLATFORM GAIN ––––––*/
  useEffect(() => {
    if (!analysis) return;
    const target = PLATFORM_TARGETS[platform];
    const diffDb = target === null ? 0 : target - analysis.lufs;
    const gain = Math.pow(10, diffDb / 20);
    gainNodeRef.current?.gain.setTargetAtTime(gain, ctxRef.current!.currentTime, 0.01);
  }, [platform, analysis]);

  /*–––––– TIME LISTENERS ––––––*/
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const t = () => setCurrentTime(a.currentTime);
    const m = () => setDuration(a.duration);
    a.addEventListener("timeupdate", t);
    a.addEventListener("loadedmetadata", m);
    return () => {
      a.removeEventListener("timeupdate", t);
      a.removeEventListener("loadedmetadata", m);
    };
  }, [audioURL]);

  /*–––––– FILE HANDLER ––––––*/
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const arrayBuffer = await file.arrayBuffer();
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    ctxRef.current = ctx;

    /*–– Analysis ––*/
    const ch = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const win = 0.1; // seconds
    const winSamples = Math.floor(sampleRate * win);

    let sumSq = 0;
    let peakAbs = 0;
    const waveform: WavePoint[] = [];
    const lufsArr: LufsPoint[] = [];

    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      sumSq += s * s;
      peakAbs = Math.max(peakAbs, Math.abs(s));

      if (i % winSamples === 0) {
        /* peak */
        let segPeak = 0;
        let segSum = 0;
        for (let j = 0; j < winSamples && i + j < ch.length; j++) {
          const v = ch[i + j];
          segPeak = Math.max(segPeak, Math.abs(v));
          segSum += v * v;
        }
        waveform.push({ time: i / sampleRate, peak: segPeak });
        const segMean = segSum / winSamples;
        const segLufs = -0.691 + 10 * Math.log10(segMean + 1e-12);
        lufsArr.push({ time: i / sampleRate, lufs: segLufs });
      }
    }

    const meanSq = sumSq / ch.length;
    const lufs = -0.691 + 10 * Math.log10(meanSq + 1e-12);
    const peakDb = 20 * Math.log10(peakAbs + 1e-12);
    const dynRange = peakDb - lufs;

    setAnalysis({ lufs, peakDb, dynRange, waveformData: waveform, lufsData: lufsArr });

    /*–– Player ––*/
    const url = URL.createObjectURL(file);
    setAudioURL(url);
    const audio = new Audio(url);
    const src = ctx.createMediaElementSource(audio);
    const gainNode = ctx.createGain();
    src.connect(gainNode).connect(ctx.destination);
    audioRef.current = audio;
    gainNodeRef.current = gainNode;

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  /*–––––– Controls ––––––*/
  const togglePlay = async () => {
    if (!audioRef.current || !ctxRef.current) return;

    if (ctxRef.current.state === "suspended") {
      await ctxRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      try {
        await audioRef.current.play();
      } catch (error) {
        console.error("Playback failed:", error);
        return;
      }
    }
    setIsPlaying(!isPlaying);
  };

  const seek = (t: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  /*–––––– Parallax Hero ––––––*/
  useEffect(() => {
    const h = () => document.documentElement.style.setProperty("--hero-offset", `${window.scrollY * 0.4}px`);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const theme = THEMES[platform];
  const diffDb = analysis && PLATFORM_TARGETS[platform] != null ? +(PLATFORM_TARGETS[platform]! - analysis.lufs).toFixed(1) : 0;
  const explainer = platform === "Original"
    ? "No loudness normalisation applied – raw file playback."
    : `Track ${diffDb > 0 ? "boosted" : "attenuated"} ${Math.abs(diffDb)} dB to hit ${PLATFORM_TARGETS[platform]} LUFS (${platform}).`;

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme.bg} ${theme.text}`}>      
      {/* ––––– Hero ––––– */}
      <section className="relative overflow-hidden pb-16">
        <motion.h1
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className={`text-4xl md:text-6xl font-extrabold text-center pt-24 ${theme.textAccent}`}
          style={{ translateY: "calc(var(--hero-offset,0px) * -1)" }}
        >
          Loudness Lab
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-center mt-3 text-lg max-w-xl mx-auto"
        >
          Upload your track and preview how streaming platforms reshape its loudness.
        </motion.p>
        <div className="mt-8 flex justify-center">
          <label className={`px-6 py-3 rounded-lg cursor-pointer font-semibold text-sm ${theme.btn} ${theme.btnHover}`}>
            Choose Audio File
            <input type="file" accept="audio/*" className="hidden" onChange={handleFile} />
          </label>
        </div>
        {fileName && <p className="text-center text-sm mt-2 opacity-80">Selected: {fileName}</p>}
      </section>

      {/* ––––– Analysis Section ––––– */}
      {analysis && (
        <section className="px-4 md:px-12 lg:px-24 py-12 space-y-14">
          {/* Platform Selector */}
          <div className="flex flex-wrap justify-center gap-3">
            {(Object.keys(PLATFORM_TARGETS) as Platform[]).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`px-4 py-2 rounded-full font-medium transition active:scale-95 ${
                  platform === p ? theme.btn : "bg-white/20 dark:bg-white/10 hover:bg-white/30"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Player */}
          <div className="max-w-3xl mx-auto bg-white/20 dark:bg-white/10 rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${theme.btn} ${theme.btnHover}`}
              >
                {isPlaying ? "❚❚" : "▶"}
              </button>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={(e) => seek(Number(e.target.value))}
                className={`w-full ${theme.sliderAccent}`}
              />
              <span className="w-24 text-right text-xs tabular-nums shrink-0">
                {Math.floor(currentTime)} / {Math.floor(duration)}s
              </span>
            </div>
            <label className={`self-end text-xs cursor-pointer ${theme.textAccent}`}>
              Upload New Track
              <input type="file" accept="audio/*" className="hidden" onChange={handleFile} />
            </label>
          </div>

          {/* Explainer */}
          <p className="text-center text-sm italic opacity-80">{explainer}</p>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Integrated LUFS", value: analysis.lufs.toFixed(1) },
              { label: "True Peak dBFS", value: analysis.peakDb.toFixed(1) },
              { label: "Dyn Range", value: analysis.dynRange.toFixed(1) },
              { label: "Gain dB", value: diffDb.toFixed(1) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/20 dark:bg-white/10 rounded-xl p-4 text-center">
                <h3 className={`text-sm font-semibold mb-1 ${theme.textAccent}`}>{label}</h3>
                <p className="text-2xl font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {/* Waveform Chart */}
          <div className="bg-white/20 dark:bg-white/10 rounded-xl p-5">
            <h3 className={`text-sm font-semibold mb-3 ${theme.textAccent}`}>Waveform Peak</h3>
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={analysis.waveformData}
                  onClick={(e: any) => e && e.activeLabel != null && seek(e.activeLabel)}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid stroke="#555" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#ccc" }}
                    tickFormatter={(v) => `${Math.round(v)}s`}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 0.5, 1]}
                    tick={{ fill: "#ccc" }}
                  />
                  <Tooltip
                    formatter={(v: number) => v.toFixed(2)}
                    labelFormatter={(l) => `${Math.round(l)}s`}
                    contentStyle={{ background: "#1f2937", border: "none" }}
                  />
                  <Line type="monotone" dataKey="peak" stroke="#ffffff" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center mt-1 opacity-70">Tap / hover to seek & inspect</p>
          </div>

          {/* LUFS Chart */}
          <div className="bg-white/20 dark:bg-white/10 rounded-xl p-5">
            <h3 className={`text-sm font-semibold mb-3 ${theme.textAccent}`}>LUFS over Time</h3>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={analysis.lufsData}
                  onClick={(e: any) => e && e.activeLabel != null && seek(e.activeLabel)}
                  margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                >
                  <CartesianGrid stroke="#555" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#ccc" }}
                    tickFormatter={(v) => `${Math.round(v)}s`}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[-60, 0]}
                    ticks={[-60, -40, -20, 0]}
                    tick={{ fill: "#ccc" }}
                  />
                  <Tooltip
                    formatter={(v: number) => v.toFixed(1) + " dB"}
                    labelFormatter={(l) => `${Math.round(l)}s`}
                    contentStyle={{ background: "#1f2937", border: "none" }}
                  />
                  <Line type="monotone" dataKey="lufs" stroke="#06b6d4" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center mt-1 opacity-70">Tap / hover to seek & inspect</p>
          </div>
        </section>
      )}

      <footer className="text-center text-xs py-6 opacity-70">© {new Date().getFullYear()} Devs.Miami</footer>
    </div>
  );
}

