import { useState, useEffect, useRef, useCallback } from 'react';
import type { 
  DisplayStyle, 
  SyncMode,
  MediaTrack, 
  LyricLine, 
  ColorPalette, 
  ParallaxConfig,
  MediaSourceMode
} from './types';
import { PRESET_THEMES, extractPaletteFromImage } from './utils/palette';
import { parseLRC, fetchLyricsFromLRCLIB, formatPlainLyricsProportionally } from './services/lyricsService';
import { subscribeToMediaStream, pollWindowsMediaSessions, fetchCoverArt } from './services/mediaService';
import { FloatingControlWidget } from './components/controls/FloatingControlWidget';
import { VisualRenderer } from './components/display/VisualRenderer';
import { ShipRenderer } from './components/display/ShipRenderer';
import { FisheyeRenderer } from './components/display/FisheyeRenderer';
import { SettingsDrawer } from './components/modals/SettingsDrawer';

export function App() {
  // Display style
  const [styleMode, setStyleMode] = useState<DisplayStyle>('fisheye-visual');

  // Lyric sync & granularity mode (defaults to 'line' = 100% exact LRC line sync + live word highlight)
  const [syncMode, setSyncMode] = useState<SyncMode>('line');

  // Source selection mode (Auto, Spotify, YouTube Music)
  const [sourceMode, setSourceMode] = useState<MediaSourceMode>('auto');

  // Palette & Colors (Auto Sync enabled so theme adapts to album cover art automatically)
  const [palette, setPalette] = useState<ColorPalette>({
    ...PRESET_THEMES[0].palette,
    autoSync: true,
  });

  // Parallax Settings
  const [parallax, setParallax] = useState<ParallaxConfig>({
    sensitivity: 75,
    mouseParallax: true,
    autoDrift: true,
    lensCurvature: 75,
    showEmojis: true,
    showScanlines: false,
    chromaticAberration: false,
    stickerStyle: 'cutout',
  });

  // Active track & lyrics
  const [track, setTrack] = useState<MediaTrack>({
    title: 'Müzik Bekleniyor...',
    artist: 'Spotify veya YouTube Music',
    album: '',
    duration: 180,
    position: 0,
    isPlaying: false,
    source: 'windows',
  });

  const [currentLrcText, setCurrentLrcText] = useState<string>(
    '[00:00.00] Spotify veya YouTube Music üzerinden bir şarkı başlatın'
  );
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);

  const lastLiveSignatureRef = useRef<string>('');
  const lastLiveDurationRef = useRef<number>(0);

  // UI States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Time tracking refs
  const playbackBaseTimeRef = useRef(0);
  const playbackStartTimestampRef = useRef(0);
  const isPlayingRef = useRef(false);
  const animationFrameRef = useRef<number>(null);

  // Parse lyrics whenever LRC text changes
  useEffect(() => {
    const parsed = parseLRC(currentLrcText, track.duration);
    setLines(parsed);
  }, [currentLrcText, track.duration]);

  // Handle Auto Sync Palette extraction from Album Cover Art (with deterministic song fallback)
  useEffect(() => {
    if (!palette.autoSync) return;
    let cancelled = false;
    const seed = `${track.title} ${track.artist}`;

    extractPaletteFromImage(track.coverArt || '', seed).then(extracted => {
      if (!cancelled && extracted) {
        setPalette(extracted);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [palette.autoSync, track.coverArt, track.title, track.artist]);

  // Zero-Latency Real-Time Media Stream (SSE Push + Phase-Locked Loop Clock)
  useEffect(() => {
    let isMounted = true;

    const handleUpdate = (result: { activeTrack: MediaTrack | null; allSessions: MediaTrack[] }) => {
      if (!isMounted) return;

      const active = result.activeTrack;
      if (!active) return;

      const signature = `${active.title}__${active.artist}`;
      const isTrackChanged = signature !== lastLiveSignatureRef.current;
      const isDurationUpdated =
        !isTrackChanged &&
        active.duration > 15 &&
        Math.abs(active.duration - lastLiveDurationRef.current) > 4;

      // If track changed, fetch fresh lyrics and cover art immediately
      if (isTrackChanged) {
        lastLiveSignatureRef.current = signature;
        lastLiveDurationRef.current = active.duration;

        // Reset lyrics immediately to loading state so previous song doesn't linger
        setCurrentLrcText(`[00:00.00] ${active.title}\n[00:02.00] ${active.artist}\n[00:04.00] (Sözler yükleniyor...)`);

        // Clear old coverArt first, then fetch new cover art
        setTrack(prev => ({
          ...prev,
          title: active.title,
          artist: active.artist,
          album: active.album,
          duration: active.duration,
          isPlaying: active.isPlaying,
          source: active.source,
          coverArt: undefined,
        }));

        fetchCoverArt(active.title, active.artist).then(art => {
          if (art && isMounted && lastLiveSignatureRef.current === signature) {
            setTrack(prev => ({ ...prev, coverArt: art }));
          }
        });

        // Smart Multi-Candidate Duration-Matched Lyrics Fetch
        fetchLyricsFromLRCLIB(active.title, active.artist, active.duration).then(lyrics => {
          if (isMounted && lastLiveSignatureRef.current === signature) {
            if (lyrics && lyrics.syncedLyrics) {
              setCurrentLrcText(lyrics.syncedLyrics);
            } else if (lyrics && lyrics.plainLyrics) {
              setCurrentLrcText(formatPlainLyricsProportionally(lyrics.plainLyrics, active.duration));
            } else {
              setCurrentLrcText(`[00:00.00] ${active.title}\n[00:02.00] ${active.artist}\n[00:05.00] (Bu şarkı için senkron söz bulunamadı)`);
            }
          }
        });
      } else {
        if (isDurationUpdated) {
          lastLiveDurationRef.current = active.duration;
          fetchLyricsFromLRCLIB(active.title, active.artist, active.duration).then(lyrics => {
            if (isMounted && lastLiveSignatureRef.current === signature) {
              if (lyrics && lyrics.syncedLyrics) {
                setCurrentLrcText(lyrics.syncedLyrics);
              } else if (lyrics && lyrics.plainLyrics) {
                setCurrentLrcText(formatPlainLyricsProportionally(lyrics.plainLyrics, active.duration));
              }
            }
          });
        }
        setTrack(prev => ({
          ...prev,
          title: active.title,
          artist: active.artist,
          album: active.album,
          duration: active.duration,
          isPlaying: active.isPlaying,
          source: active.source,
        }));
      }

      // Zero-Latency Phase-Locked Loop (PLL) Clock Synchronization:
      const nowPerf = performance.now();
      const localEstimatedTime = isPlayingRef.current
        ? playbackBaseTimeRef.current + (nowPerf - playbackStartTimestampRef.current) / 1000
        : playbackBaseTimeRef.current;

      const drift = active.position - localEstimatedTime;
      const playStateChanged = active.isPlaying !== isPlayingRef.current;

      if (isTrackChanged || playStateChanged || !active.isPlaying || Math.abs(drift) > 0.18) {
        // Instant snap on track change, play/pause, or seek (> 180ms jump)
        playbackBaseTimeRef.current = active.position;
        playbackStartTimestampRef.current = nowPerf;
        setCurrentTime(active.position);
      } else if (Math.abs(drift) > 0.015) {
        // Fast PLL phase lock (corrects 45% of drift with zero visual stutter)
        playbackBaseTimeRef.current += drift * 0.45;
      }

      isPlayingRef.current = active.isPlaying;
      setIsPlaying(active.isPlaying);
    };

    // 1. Initial immediate poll
    pollWindowsMediaSessions(sourceMode).then(handleUpdate);

    // 2. Subscribe to real-time SSE stream for 0ms latency push
    const unsubscribe = subscribeToMediaStream(sourceMode, handleUpdate);

    // 3. Backup poll interval (in case SSE reconnects)
    const backupInterval = setInterval(async () => {
      const res = await pollWindowsMediaSessions(sourceMode);
      handleUpdate(res);
    }, 200);

    return () => {
      isMounted = false;
      unsubscribe();
      clearInterval(backupInterval);
    };
  }, [sourceMode]);

  // High-precision 60fps/120fps Sub-second Timeline Interpolator
  useEffect(() => {
    const loop = () => {
      if (isPlaying) {
        const elapsed = (performance.now() - playbackStartTimestampRef.current) / 1000;
        const newTime = playbackBaseTimeRef.current + elapsed;
        setCurrentTime(Math.min(track.duration || 9999, Math.max(0, newTime)));
      }
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, track.duration]);

  // Toggle Fullscreen
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Keyboard Shortcuts for instant sync calibration and fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === '[' || e.key === '{') {
        e.preventDefault();
        setOffsetMs(prev => prev - 50);
      } else if (e.key === ']' || e.key === '}') {
        e.preventDefault();
        setOffsetMs(prev => prev + 50);
      } else if (e.key === '0') {
        setOffsetMs(0);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleFullscreen]);

  const calibratedTime = Math.max(0, currentTime + offsetMs / 1000);

  return (
    <div 
      className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans select-none"
      style={{ backgroundColor: palette.background }}
    >
      {/* Draggable Glassmorphism Floating Control Widget */}
      {!isFullscreen && (
        <FloatingControlWidget
          currentStyle={styleMode}
          onStyleChange={setStyleMode}
          syncMode={syncMode}
          onSyncModeChange={setSyncMode}
          track={track}
          sourceMode={sourceMode}
          onSelectSourceMode={setSourceMode}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          palette={palette}
          offsetMs={offsetMs}
          onAdjustOffset={(delta) => setOffsetMs(prev => prev + delta)}
        />
      )}

      {/* Fullscreen Exit Floating Button */}
      {isFullscreen && (
        <button
          onClick={handleToggleFullscreen}
          className="absolute top-4 right-4 z-50 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs backdrop-blur-md transition-all flex items-center gap-1.5 cursor-pointer"
        >
          Tam Ekrandan Çık (Esc)
        </button>
      )}

      {/* Main Kinetic Parallax Lyrics Stage (100% Fullscreen, Pure Lyrics) */}
      <main className="relative w-full h-full overflow-hidden flex items-center justify-center">
        {styleMode === 'visual' && (
          <VisualRenderer
            lines={lines}
            currentTime={calibratedTime}
            palette={palette}
            parallax={parallax}
            syncMode={syncMode}
          />
        )}

        {styleMode === 'ship' && (
          <ShipRenderer
            lines={lines}
            currentTime={calibratedTime}
            palette={palette}
            parallax={parallax}
            syncMode={syncMode}
          />
        )}

        {styleMode === 'fisheye' && (
          <FisheyeRenderer
            lines={lines}
            currentTime={calibratedTime}
            palette={palette}
            parallax={parallax}
            syncMode={syncMode}
            withVisuals={false}
          />
        )}

        {styleMode === 'fisheye-visual' && (
          <FisheyeRenderer
            lines={lines}
            currentTime={calibratedTime}
            palette={palette}
            parallax={parallax}
            syncMode={syncMode}
            withVisuals={true}
          />
        )}
      </main>

      {/* Settings Drawer */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        palette={palette}
        onChangePalette={setPalette}
        parallax={parallax}
        onChangeParallax={setParallax}
        coverArt={track.coverArt}
      />
    </div>
  );
}

export default App;
