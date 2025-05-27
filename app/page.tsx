"use client"; // Add this directive at the top for Next.js App Router

import React, { useState, useRef, useEffect, useCallback } from 'react'; // Corrected import for hooks
import Head from 'next/head';

// ... (rest of the I. TYPES AND INTERFACES - no changes needed here)
interface LoudnessMetrics {
  integratedLUFS: number;
  truePeakDBTP: number;
}

interface PlatformTarget {
  id: string;
  name: string;
  targetLUFS: number;
  targetPeakDBTP: number;
  bitrateRecommendation?: string;
  processedMetrics?: LoudnessMetrics;
  gainAdjustmentDB?: number;
  willBeLimited?: boolean;
}

interface OriginalAudioInfo extends LoudnessMetrics {
  fileName: string;
  duration: number;
  sampleRate: number;
  audioBuffer?: AudioBuffer;
}

// ... (rest of the II. CONSTANTS - no changes needed here)
const PLATFORM_TARGETS_DATA: Omit<PlatformTarget, 'processedMetrics' | 'gainAdjustmentDB' | 'willBeLimited'>[] = [
  { id: 'spotify', name: 'Spotify', targetLUFS: -14, targetPeakDBTP: -1, bitrateRecommendation: "Upload high-quality (e.g., WAV/FLAC), they'll transcode to Opus/AAC. Target -14 LUFS." },
  { id: 'apple', name: 'Apple Music', targetLUFS: -16, targetPeakDBTP: -1, bitrateRecommendation: "Upload high-quality (e.g., ALAC/WAV/FLAC). Target -16 LUFS." },
  { id: 'youtube', name: 'YouTube', targetLUFS: -14, targetPeakDBTP: -1, bitrateRecommendation: "Upload high-quality. Target -14 LUFS." },
  { id: 'soundcloud', name: 'SoundCloud', targetLUFS: -10, targetPeakDBTP: -0.5, bitrateRecommendation: "Less aggressive normalization. Can handle louder masters. Target around -8 to -13 LUFS." },
  { id: 'tidal', name: 'Tidal (HiFi)', targetLUFS: -14, targetPeakDBTP: -1, bitrateRecommendation: "Lossless (FLAC/ALAC) preferred. Target -14 LUFS for most content." },
];

// ... (rest of the III. HELPER COMPONENTS & FUNCTIONS - LoudnessBar, formatDB, formatLUFS - no changes needed here)
interface LoudnessBarProps {
  value: number;
  target?: number;
  max: number;
  min: number;
  unit: string;
  label: string;
  isOriginal?: boolean;
}

const LoudnessBar: React.FC<LoudnessBarProps> = ({ value, target, max, min, unit, label, isOriginal = false }) => {
  const range = max - min;
  const validValue = isFinite(value) ? value : min;
  const percentage = Math.max(0, Math.min(100, ((validValue - min) / range) * 100));
  const targetPercentage = (target !== undefined && isFinite(target)) ? Math.max(0, Math.min(100, ((target - min) / range) * 100)) : undefined;

  let barColor = "bg-gray-600";
  if (isFinite(value)) {
    if (unit === "LUFS") {
      if (isOriginal) {
         if (value > -10) barColor = "bg-red-500";
         else if (value > -13) barColor = "bg-yellow-500";
         else if (value < -18) barColor = "bg-sky-400";
         else barColor = "bg-green-500";
      } else {
          if (target !== undefined) {
            if (Math.abs(value - target) < 0.5) barColor = "bg-green-500";
            else if (value > target) barColor = "bg-yellow-500";
            else barColor = "bg-sky-400";
            if (value > target + 1.5) barColor = "bg-red-500";
          }
      }
    } else if (unit === "dBFS" || unit === "dBTP") {
      if (isOriginal) {
        if (value > -0.1) barColor = "bg-red-700";
        else if (value > -1.0) barColor = "bg-red-500";
        else if (value > -2.0) barColor = "bg-yellow-500";
        else barColor = "bg-green-500";
      } else {
         if (target !== undefined) {
            if (value > target) barColor = "bg-red-500";
            else if (value > target - 0.5) barColor = "bg-yellow-500";
            else barColor = "bg-green-500";
         }
      }
    }
  }

  return (
    <div className="my-2">
      <div className="flex justify-between text-xs mb-0.5 text-gray-300">
        <span>{label}: {isFinite(value) ? value.toFixed(1) : "N/A"} {unit}</span>
        {target !== undefined && isFinite(target) && <span>Target: {target.toFixed(1)} {unit}</span>}
      </div>
      <div className="w-full bg-gray-700 rounded-full h-4 relative overflow-hidden shadow-inner">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
          style={{ width: `${percentage}%` }}
        ></div>
        {targetPercentage !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-1 bg-white opacity-70 transform -translate-x-1/2"
            style={{ left: `${targetPercentage}%` }}
            title={`Target: ${target?.toFixed(1)} ${unit}`}
          >
            <div className="h-full w-px bg-white mx-auto"></div>
          </div>
        )}
      </div>
    </div>
  );
};

const formatDB = (value: number | undefined): string => (value === undefined || !isFinite(value)) ? "N/A" : `${value.toFixed(1)} dB`;
const formatLUFS = (value: number | undefined): string => (value === undefined || !isFinite(value)) ? "N/A" : `${value.toFixed(1)} LUFS`;

// IV. MAIN COMPONENT
const LoudnessAnalyzerPage: React.FC = () => {
  // A. STATE
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [originalAudioInfo, setOriginalAudioInfo] = useState<OriginalAudioInfo | null>(null);
  const [platformAnalyses, setPlatformAnalyses] = useState<PlatformTarget[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activePlayerKey, setActivePlayerKey] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize AudioContext on component mount (client-side only)
  useEffect(() => {
    // The "use client" directive ensures this runs on the client
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    return () => {
      currentSourceNodeRef.current?.stop();
      currentSourceNodeRef.current?.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []); // Empty dependency array means this runs once on mount and cleans up on unmount

  // B. EFFECTS: Process audio file when it changes
  useEffect(() => {
    if (audioFile && audioContextRef.current) {
      analyzeAudioFile(audioFile, audioContextRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [audioFile]); // Added analyzeAudioFile to dependencies if it's not memoized, or ensure it's stable.
                  // For simplicity here, assuming analyzeAudioFile changes rarely or is memoized.
                  // Or pass audioContextRef.current into analyzeAudioFile if that's the main dependency.

  // C. HANDLERS
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    stopPlayback();
    const file = event.target.files?.[0];
    if (file) {
      setAudioFile(file);
      setError(null);
      setOriginalAudioInfo(null);
      setPlatformAnalyses([]);
    } else {
      setAudioFile(null);
    }
  };

  const stopPlayback = useCallback(() => {
    if (currentSourceNodeRef.current) {
      try {
        currentSourceNodeRef.current.stop();
      } catch (e) {
        // Ignore
      }
      currentSourceNodeRef.current.disconnect();
      currentSourceNodeRef.current = null;
    }
    setActivePlayerKey(null);
  }, []);

  const playAudio = useCallback((buffer: AudioBuffer, gainDB: number = 0, playerKey: string) => {
    if (!audioContextRef.current || !buffer || audioContextRef.current.state === 'suspended') {
       // Attempt to resume context if suspended (e.g., by browser auto-play policy)
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().then(() => {
          // Retry playAudio after resume
          // This is a common pattern, but for simplicity, we'll just log here.
          // A more robust solution might involve queueing the play action.
          console.log("AudioContext resumed. Please try playing again.");
        });
        return;
      }
      console.warn("AudioContext not ready or buffer missing.");
      return;
    }


    stopPlayback();

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;

    const gainNode = audioContextRef.current.createGain();
    const linearGain = isFinite(gainDB) ? Math.pow(10, gainDB / 20) : 1;
    gainNode.gain.setValueAtTime(linearGain, audioContextRef.current.currentTime);

    source.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    source.start();

    currentSourceNodeRef.current = source;
    setActivePlayerKey(playerKey);

    source.onended = () => {
      if (currentSourceNodeRef.current === source) {
        setActivePlayerKey(null);
        currentSourceNodeRef.current = null;
      }
    };
  }, [stopPlayback]);


  // D. AUDIO PROCESSING LOGIC (Simplified for client-side)
  const calculateSimulatedLUFS = (buffer: AudioBuffer): number => {
    let sumOfSquares = 0;
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) {
      sumOfSquares += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sumOfSquares / channelData.length);
    if (rms === 0) return -Infinity;
    return 20 * Math.log10(rms);
  };

  const calculateSimulatedPeakDBFS = (buffer: AudioBuffer): number => {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const absValue = Math.abs(data[i]);
        if (absValue > peak) {
          peak = absValue;
        }
      }
    }
    if (peak === 0) return -Infinity;
    return 20 * Math.log10(peak);
  };

  // analyzeAudioFile should ideally be memoized with useCallback if it's a dependency of useEffect
  // or its dependencies need to be carefully managed.
  // For now, we'll keep it as a regular function for simplicity, but be mindful of re-renders.
  const analyzeAudioFile = async (file: File, audioCtx: AudioContext) => {
    setIsLoading(true);
    setError(null);
    setOriginalAudioInfo(null);
    setPlatformAnalyses([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      // It's good practice to check if audioCtx is still valid (not closed)
      if (audioCtx.state === 'closed') {
          console.warn("AudioContext was closed before decoding could start.");
          // Potentially re-initialize or handle this state.
          // For now, we'll throw an error.
          throw new Error("AudioContext is closed.");
      }
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const originalLUFS = calculateSimulatedLUFS(audioBuffer);
      const originalPeak = calculateSimulatedPeakDBFS(audioBuffer);

      const initialInfo: OriginalAudioInfo = {
        fileName: file.name,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        integratedLUFS: originalLUFS,
        truePeakDBTP: originalPeak,
        audioBuffer: audioBuffer,
      };
      setOriginalAudioInfo(initialInfo);

      const analyses: PlatformTarget[] = PLATFORM_TARGETS_DATA.map(platform => {
        let gainAdjustmentDB = platform.targetLUFS - originalLUFS;
        let peakAfterLoudnessNormalization = originalPeak + gainAdjustmentDB;
        let willBeLimited = false;

        if (peakAfterLoudnessNormalization > platform.targetPeakDBTP) {
          willBeLimited = true;
          const peakReductionNeeded = peakAfterLoudnessNormalization - platform.targetPeakDBTP;
          gainAdjustmentDB -= peakReductionNeeded;
        }
        
        const finalProcessedLUFS = originalLUFS + gainAdjustmentDB;
        const finalProcessedPeak = originalPeak + gainAdjustmentDB;

        return {
          ...platform,
          gainAdjustmentDB: gainAdjustmentDB,
          processedMetrics: {
            integratedLUFS: finalProcessedLUFS,
            truePeakDBTP: finalProcessedPeak,
          },
          willBeLimited,
        };
      });

      setPlatformAnalyses(analyses);

    } catch (e: any) {
      console.error("Error processing audio:", e);
      setError(`Failed to process audio: ${e.message || "Unsupported format or corrupted file."}`);
    } finally {
      setIsLoading(false);
    }
  };
  // E. JSX RENDER (no changes needed in the JSX structure itself)
  return (
    <>
      <Head>
        <title>Audio Loudness Analyzer</title>
        <meta name="description" content="Analyze your audio track's loudness for streaming platforms." />
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-purple-900 text-white p-4 md:p-8 font-sans">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
            Audio Loudness Analyzer
          </h1>
          <p className="text-lg text-gray-300 mt-2">
            Upload your track. See how it might sound on popular streaming platforms.
          </p>
        </header>

        <div className="max-w-lg mx-auto mb-10 bg-gray-800 bg-opacity-70 p-6 rounded-xl shadow-2xl backdrop-filter backdrop-blur-md">
          <label htmlFor="audioUpload" className="block text-xl font-semibold text-purple-300 mb-3 text-center">
            Upload Your Audio File
          </label>
          <input
            type="file"
            id="audioUpload"
            accept="audio/mpeg, audio/wav, audio/aac, audio/ogg, audio/flac, audio/mp4, .m4a"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-300 file:mr-4 file:py-3 file:px-6 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-r file:from-purple-500 file:to-pink-500 file:text-white hover:file:from-purple-600 hover:file:to-pink-600 cursor-pointer transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {isLoading && <p className="text-yellow-300 mt-4 text-center animate-pulse">Analyzing audio, please wait...</p>}
          {error && <p className="text-red-300 mt-4 text-center bg-red-800 bg-opacity-50 p-3 rounded-lg">{error}</p>}
        </div>

        {originalAudioInfo && (
          <section className="mb-12 p-6 bg-gray-800 bg-opacity-70 rounded-xl shadow-2xl backdrop-filter backdrop-blur-md max-w-3xl mx-auto">
            <h2 className="text-3xl font-semibold text-purple-300 mb-5 text-center border-b-2 border-purple-500 pb-3">Original Track Analysis</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mb-5 text-sm text-gray-200">
              <p><strong className="text-gray-400">File:</strong> {originalAudioInfo.fileName}</p>
              <p><strong className="text-gray-400">Duration:</strong> {originalAudioInfo.duration.toFixed(2)}s</p>
              <p><strong className="text-gray-400">Sample Rate:</strong> {originalAudioInfo.sampleRate} Hz</p>
              <p><strong className="text-gray-400">Channels:</strong> {originalAudioInfo.audioBuffer?.numberOfChannels}</p>
            </div>
            
            <LoudnessBar 
              label="Original Integrated Loudness (RMS-based)" 
              value={originalAudioInfo.integratedLUFS} 
              min={-40} max={0} unit="LUFS" isOriginal={true}
            />
            <LoudnessBar 
              label="Original Peak Level (Sample Peak)" 
              value={originalAudioInfo.truePeakDBTP} 
              min={-20} max={0} unit="dBFS" isOriginal={true}
            />

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                        audioContextRef.current.resume().then(() => {
                           if (originalAudioInfo.audioBuffer) playAudio(originalAudioInfo.audioBuffer, 0, 'original');
                        });
                    } else if (originalAudioInfo.audioBuffer) {
                         playAudio(originalAudioInfo.audioBuffer, 0, 'original');
                    }
                }}
                disabled={isLoading || !originalAudioInfo.audioBuffer || activePlayerKey === 'original'}
                className={`px-8 py-3 rounded-lg font-semibold transition-all duration-300 ease-in-out shadow-lg transform hover:scale-105
                  ${activePlayerKey === 'original' 
                    ? 'bg-green-500 hover:bg-green-600 text-white ring-2 ring-green-300' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'} 
                  disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed disabled:transform-none`}
              >
                {activePlayerKey === 'original' ? 'Playing Original...' : 'Play Original Track'}
              </button>
            </div>
          </section>
        )}

        {platformAnalyses.length > 0 && originalAudioInfo && (
          <section>
            <h2 className="text-3xl font-semibold text-purple-300 mb-8 text-center border-b-2 border-purple-500 pb-3">Streaming Platform Simulations</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {platformAnalyses.map((platform) => (
                <div key={platform.id} className="bg-gray-800 bg-opacity-70 p-5 rounded-xl shadow-2xl backdrop-filter backdrop-blur-md flex flex-col justify-between transition-all duration-300 hover:shadow-purple-500/30">
                  <div>
                    <h3 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-2">{platform.name}</h3>
                    <p className="text-xs text-gray-400 mb-3">Target: {formatLUFS(platform.targetLUFS)}, {formatDB(platform.targetPeakDBTP)} Peak</p>
                    
                    <LoudnessBar
                      label="Est. Loudness After Normalization"
                      value={platform.processedMetrics?.integratedLUFS ?? 0}
                      target={platform.targetLUFS}
                      min={-30} max={-5} unit="LUFS"
                    />
                    <LoudnessBar
                      label="Est. Peak After Normalization"
                      value={platform.processedMetrics?.truePeakDBTP ?? 0}
                      target={platform.targetPeakDBTP}
                      min={-12} max={0} unit="dBFS"
                    />

                    <p className="text-sm mt-4">
                      <strong className="text-gray-300">Simulated Gain Change:</strong> 
                      <span className={`font-semibold ${ (platform.gainAdjustmentDB ?? 0) > 0.1 ? 'text-green-400' : (platform.gainAdjustmentDB ?? 0) < -0.1 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {formatDB(platform.gainAdjustmentDB)}
                      </span>
                    </p>
                    {platform.willBeLimited && (
                      <p className="text-sm text-yellow-300 mt-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline mr-1" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.216 3.031-1.742 3.031H4.42c-1.526 0-2.492-1.697-1.742-3.031l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1.75-5.5a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z" clipRule="evenodd" />
                        </svg>
                        Track likely limited to meet peak target. Effective LUFS may be lower than platform target.
                      </p>
                    )}
                     {platform.bitrateRecommendation && <p className="text-xs text-gray-500 mt-3 italic">Tip: {platform.bitrateRecommendation}</p>}
                  </div>
                  <button
                    onClick={() => {
                        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                            audioContextRef.current.resume().then(() => {
                                if (originalAudioInfo?.audioBuffer) playAudio(originalAudioInfo.audioBuffer, platform.gainAdjustmentDB ?? 0, platform.id);
                            });
                        } else if (originalAudioInfo?.audioBuffer) {
                             playAudio(originalAudioInfo.audioBuffer, platform.gainAdjustmentDB ?? 0, platform.id);
                        }
                    }}
                    disabled={isLoading || !originalAudioInfo?.audioBuffer || activePlayerKey === platform.id}
                    className={`mt-5 w-full px-4 py-3 rounded-lg font-semibold transition-all duration-300 ease-in-out shadow-md transform hover:scale-105
                      ${activePlayerKey === platform.id 
                        ? 'bg-green-500 hover:bg-green-600 text-white ring-2 ring-green-300' 
                        : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white'} 
                      disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed disabled:transform-none`}
                  >
                    {activePlayerKey === platform.id ? `Playing on ${platform.name}...` : `Play ${platform.name} Sim`}
                  </button>
                </div>
              ))}
            </div>
            {activePlayerKey && activePlayerKey !== 'original' && (
              <div className="text-center mt-10">
                <button
                    onClick={stopPlayback}
                    className="px-10 py-3 rounded-lg font-semibold bg-red-600 hover:bg-red-700 text-white text-lg shadow-xl transition-all duration-300 transform hover:scale-105"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 inline mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12H3M12 21V3" transform="rotate(45 12 12) scale(0.8)"/>
                    </svg>
                    Stop All Audio
                </button>
              </div>
            )}
          </section>
        )}
        
        {!audioFile && !isLoading && (
            <div className="text-center text-gray-400 mt-20">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-purple-400 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <p className="text-xl">Ready to analyze your masterpiece?</p>
                <p>Upload an audio file to begin.</p>
            </div>
        )}

        <footer className="text-center mt-16 py-8 border-t border-gray-700">
          <p className="text-sm text-gray-400">
            Loudness Analyzer v0.2.1 - For educational and illustrative purposes.
          </p>
          <p className="text-xs text-gray-500 mt-2 max-w-2xl mx-auto">
            <strong>Disclaimer:</strong> Loudness (LUFS) and Peak (dBTP) measurements are highly simplified (RMS-based and sample peak respectively) and are NOT standard-compliant or broadcast accurate. They provide a basic estimation only. Always use professional metering tools and your ears for final mastering decisions. Platform processing algorithms are complex and proprietary; this tool simulates normalization via gain adjustment.
          </p>
        </footer>
      </div>
    </>
  );
};

export default LoudnessAnalyzerPage;
