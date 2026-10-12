import React, { useState } from 'react';
import type { MediaTrack } from '../../types';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  ChevronUp, 
  ChevronDown, 
  Clock, 
  Disc3,
  SkipForward,
  SkipBack
} from 'lucide-react';

interface PlayerControlsProps {
  track: MediaTrack;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onNextSong?: () => void;
  onPrevSong?: () => void;
  offsetMs: number;
  onAdjustOffset: (deltaMs: number) => void;
  isLiveTracking: boolean;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  track,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  onNextSong,
  onPrevSong,
  offsetMs,
  onAdjustOffset,
  isLiveTracking,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const duration = Math.max(track.duration || 180, 1);
  const progressPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  return (
    <div
      className={`relative z-40 w-full transition-all duration-300 border-t border-white/10 bg-black/85 backdrop-blur-2xl select-none px-4 sm:px-6 ${
        isCollapsed ? 'py-1.5' : 'py-3.5'
      }`}
    >
      {/* Collapse / Expand Toggle Tab */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -top-6 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-t-md bg-zinc-900 border-t border-x border-white/10 text-zinc-400 hover:text-white flex items-center gap-1 text-[11px] font-medium"
      >
        {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <span>{isCollapsed ? 'Show Controls' : 'Hide Controls'}</span>
      </button>

      {/* Mini Progress Bar when collapsed */}
      {isCollapsed ? (
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2 truncate max-w-sm">
            <span className="font-semibold text-white truncate">{track.title}</span>
            <span>•</span>
            <span className="truncate">{track.artist}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>{formatTime(currentTime)}</span>
            <span>/</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 max-w-6xl mx-auto">
          {/* Main Controls Row */}
          <div className="flex items-center justify-between gap-4">
            {/* Song Meta & Cover */}
            <div className="flex items-center gap-3 min-w-0 max-w-[320px]">
              <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-zinc-800 flex-none border border-white/10 shadow-md">
                {track.coverArt ? (
                  <img
                    src={track.coverArt}
                    alt={track.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-500">
                    <Disc3 className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
                  </div>
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold text-white truncate leading-snug">
                  {track.title}
                </span>
                <span className="text-xs text-zinc-400 truncate">
                  {track.artist}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                    track.source === 'spotify' 
                      ? 'bg-green-500/20 text-green-400' 
                      : track.source === 'youtube'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-zinc-700/50 text-zinc-300'
                  }`}>
                    {track.source}
                  </span>
                  {isLiveTracking && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Live
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Playback Buttons */}
            <div className="flex items-center gap-3">
              {onPrevSong && (
                <button
                  onClick={onPrevSong}
                  title="Previous Song"
                  className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={onTogglePlay}
                title={isPlaying ? 'Pause' : 'Play'}
                className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-lg shadow-white/20 transition-all"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              {onNextSong && (
                <button
                  onClick={onNextSong}
                  title="Next Song"
                  className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Sync Offset Calibration */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-900/90 px-3 py-1.5 rounded-full border border-white/10 shadow-inner">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span className="font-medium text-zinc-300">Senkron:</span>
              <button
                onClick={() => onAdjustOffset(-200)}
                title="-200ms geciktir/öne al"
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono transition-colors"
              >
                -200ms
              </button>
              <button
                onClick={() => onAdjustOffset(-50)}
                title="[-50ms] Klavye kısayolu: ["
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono transition-colors"
              >
                -50ms
              </button>
              <span className={`font-mono text-xs font-bold px-1.5 ${offsetMs === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {offsetMs >= 0 ? `+${offsetMs}` : offsetMs}ms
              </span>
              <button
                onClick={() => onAdjustOffset(50)}
                title="[+50ms] Klavye kısayolu: ]"
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono transition-colors"
              >
                +50ms
              </button>
              <button
                onClick={() => onAdjustOffset(200)}
                title="+200ms"
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-mono transition-colors"
              >
                +200ms
              </button>
              {offsetMs !== 0 && (
                <button
                  onClick={() => onAdjustOffset(-offsetMs)}
                  title="Sıfırla (0)"
                  className="p-1 hover:text-white text-zinc-400 hover:bg-zinc-800 rounded transition-colors ml-0.5"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Time Scrubber Bar */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-zinc-400 w-11 text-right">
              {formatTime(currentTime)}
            </span>
            <div className="relative flex-1 h-2 bg-zinc-800 rounded-full cursor-pointer group flex items-center">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={currentTime}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-pink-400 rounded-full transition-all group-hover:brightness-110"
                style={{ width: `${progressPercent}%` }}
              />
              <div
                className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-md -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs font-mono text-zinc-400 w-11">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
