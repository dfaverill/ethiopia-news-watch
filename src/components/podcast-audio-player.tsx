"use client";

import {
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface PodcastAudioPlayerProps {
  src: string;
  className?: string;
}

function clampTime(nextTime: number, duration: number | undefined) {
  if (!Number.isFinite(nextTime)) {
    return 0;
  }

  if (!Number.isFinite(duration ?? NaN)) {
    return Math.max(0, nextTime);
  }

  return Math.min(Math.max(0, nextTime), duration ?? 0);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const roundedSeconds = Math.floor(seconds);
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function PodcastAudioPlayer({
  src,
  className = "",
}: PodcastAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingPlayPromiseRef = useRef<Promise<void> | null>(null);
  const playRequestedRef = useRef(false);
  const progressInputId = useId();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const audioElement = audioRef.current;
    playRequestedRef.current = false;
    pendingPlayPromiseRef.current = null;
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadError(null);

    if (!audioElement) {
      return;
    }

    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement.load();
    setIsMuted(audioElement.muted);
  }, [src]);

  async function togglePlayback() {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    if (audioElement.paused) {
      playRequestedRef.current = true;
      setLoadError(null);
      setIsLoading(true);

      if (audioElement.networkState === HTMLMediaElement.NETWORK_EMPTY) {
        audioElement.load();
      }

      try {
        const playPromise = audioElement.play();

        if (playPromise) {
          pendingPlayPromiseRef.current = playPromise;
          await playPromise;
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Podcast playback failed to start.", error);
          setLoadError("Audio is taking longer than expected.");
        }
      } finally {
        pendingPlayPromiseRef.current = null;
        if (!audioElement.paused) {
          setIsLoading(false);
        }
      }
      return;
    }

    if (pendingPlayPromiseRef.current) {
      try {
        await pendingPlayPromiseRef.current;
      } catch {
        // Ignore any previously interrupted play attempt before pausing.
      }
    }

    playRequestedRef.current = false;
    setIsLoading(false);
    audioElement.pause();
  }

  function seekBy(seconds: number) {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    const nextTime = clampTime(
      audioElement.currentTime + seconds,
      Number.isFinite(audioElement.duration) ? audioElement.duration : undefined,
    );

    audioElement.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function handleScrub(nextTime: number) {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    const clampedTime = clampTime(
      nextTime,
      Number.isFinite(audioElement.duration) ? audioElement.duration : undefined,
    );

    audioElement.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }

  function toggleMute() {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    const nextMuted = !audioElement.muted;
    audioElement.muted = nextMuted;
    setIsMuted(nextMuted);
  }

  const progressMax = Number.isFinite(duration) && duration > 0 ? duration : 0;

  return (
    <div className={className}>
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        className="sr-only"
        onLoadStart={() => {
          setIsLoading(true);
          setLoadError(null);
        }}
        onPlay={() => {
          playRequestedRef.current = false;
          setIsPlaying(true);
          setIsLoading(false);
        }}
        onPause={() => {
          setIsPlaying(false);
          if (!playRequestedRef.current) {
            setIsLoading(false);
          }
        }}
        onEnded={() => {
          playRequestedRef.current = false;
          setIsPlaying(false);
          setIsLoading(false);
        }}
        onLoadedMetadata={(event) => {
          const nextDuration = Number.isFinite(event.currentTarget.duration)
            ? event.currentTarget.duration
            : 0;
          setDuration(nextDuration);
          setCurrentTime(event.currentTarget.currentTime);
          setIsMuted(event.currentTarget.muted);
        }}
        onLoadedData={() => setIsLoading(false)}
        onCanPlay={() => {
          playRequestedRef.current = false;
          setIsLoading(false);
        }}
        onWaiting={() => setIsLoading(true)}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          if (Number.isFinite(event.currentTarget.duration)) {
            setDuration(event.currentTarget.duration);
          }
        }}
        onVolumeChange={(event) => {
          setIsMuted(event.currentTarget.muted);
        }}
        onError={() => {
          playRequestedRef.current = false;
          setIsPlaying(false);
          setIsLoading(false);
          setLoadError("Audio is unavailable right now.");
        }}
      />

      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-[999px] bg-[#454545] px-5 py-4 text-white">
        <button
          type="button"
          onClick={() => {
            void togglePlayback();
          }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/10"
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
        >
          {isLoading && !isPlaying ? (
            <LoaderCircle className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="h-5 w-5 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={() => seekBy(-10)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/10"
          aria-label="Go back 10 seconds"
          title="Back ten seconds"
        >
          <RotateCcw className="h-4.5 w-4.5" />
        </button>

        <button
          type="button"
          onClick={() => seekBy(10)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/10"
          aria-label="Go forward 10 seconds"
          title="Skip ten seconds"
        >
          <RotateCw className="h-4.5 w-4.5" />
        </button>

        <div className="min-w-[88px] shrink-0 text-sm font-medium tabular-nums text-white/90">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <label htmlFor={progressInputId} className="sr-only">
          Seek audio
        </label>
        <input
          id={progressInputId}
          type="range"
          min={0}
          max={progressMax || 0}
          step="any"
          value={progressMax > 0 ? currentTime : 0}
          onChange={(event) => handleScrub(Number(event.target.value))}
          className="podcast-audio-player__range h-2 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-white/20"
          aria-label="Seek audio"
        />

        <button
          type="button"
          onClick={toggleMute}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/10"
          aria-label={isMuted ? "Unmute audio" : "Mute audio"}
        >
          {isMuted ? (
            <VolumeX className="h-4.5 w-4.5" />
          ) : (
            <Volume2 className="h-4.5 w-4.5" />
          )}
        </button>
        </div>
        {loadError ? (
          <p className="px-2 text-xs text-white/70">{loadError}</p>
        ) : null}
      </div>
    </div>
  );
}
