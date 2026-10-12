import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { DisplayStyle, MediaTrack, MediaSourceMode, ColorPalette, SyncMode } from '../../types';
import { 
  GripVertical, 
  ChevronDown, 
  ChevronUp, 
  Palette, 
  Maximize2, 
  Minimize2, 
  Sparkles, 
  Box, 
  Eye, 
  Layers,
  Clock,
  RotateCcw,
  AlignCenter
} from 'lucide-react';

interface FloatingControlWidgetProps {
  currentStyle: DisplayStyle;
  onStyleChange: (style: DisplayStyle) => void;
  syncMode: SyncMode;
  onSyncModeChange: (mode: SyncMode) => void;
  track: MediaTrack | null;
  sourceMode: MediaSourceMode;
  onSelectSourceMode: (mode: MediaSourceMode) => void;
  onOpenSettings: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  palette: ColorPalette;
  offsetMs: number;
  onAdjustOffset: (delta: number) => void;
}

export const FloatingControlWidget: React.FC<FloatingControlWidgetProps> = ({
  currentStyle,
  onStyleChange,
  syncMode,
  onSyncModeChange,
  track,
  sourceMode,
  onSelectSourceMode,
  onOpenSettings,
  isFullscreen,
  onToggleFullscreen,
  palette,
  offsetMs,
  onAdjustOffset,
}) => {
  // Expansion state with smooth animation
  const [isExpanded, setIsExpanded] = useState(false);

  // Dragging coordinates
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    // Default top-right corner placement
    const initialX = typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 380) : 24;
    return { x: initialX, y: 24 };
  });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });

  const widgetRef = useRef<HTMLDivElement>(null);

  // Keep widget within screen bounds on resize
  useEffect(() => {
    const handleResize = () => {
      if (!widgetRef.current) return;
      const rect = widgetRef.current.getBoundingClientRect();
      setPosition(prev => ({
        x: Math.min(Math.max(16, prev.x), window.innerWidth - rect.width - 16),
        y: Math.min(Math.max(16, prev.y), window.innerHeight - rect.height - 16),
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Pointer drag event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from header or grip handle, not from buttons/inputs
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position.x,
      startY: position.y,
    };

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || !widgetRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.mouseX;
    const deltaY = e.clientY - dragStartRef.current.mouseY;

    const rect = widgetRef.current.getBoundingClientRect();
    const newX = Math.min(Math.max(12, dragStartRef.current.startX + deltaX), window.innerWidth - rect.width - 12);
    const newY = Math.min(Math.max(12, dragStartRef.current.startY + deltaY), window.innerHeight - rect.height - 12);

    setPosition({ x: newX, y: newY });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }, []);

  const styles: { id: DisplayStyle; label: string; icon: React.ReactNode }[] = [
    { id: 'fisheye-visual', label: 'Fisheye Visual', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'fisheye', label: 'Fisheye CRT', icon: <Eye className="w-3.5 h-3.5" /> },
    { id: 'visual', label: 'Visual', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'ship', label: 'Ship 3D', icon: <Box className="w-3.5 h-3.5" /> },
  ];

  const sourceButtons: { id: MediaSourceMode; label: string }[] = [
    { id: 'auto', label: 'Oto' },
    { id: 'spotify', label: 'Spotify' },
    { id: 'youtube', label: 'YT Music' },
  ];

  return (
    <div
      ref={widgetRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      className={`fixed z-50 transition-[width,height,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none cursor-grab active:cursor-grabbing ${
        isExpanded ? 'w-[340px] sm:w-[370px]' : 'w-auto'
      }`}
    >
      {/* Glassmorphism Acrylic Card Container */}
      <div
        className="relative overflow-hidden rounded-2xl backdrop-blur-2xl bg-black/60 border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.7)] text-white transition-all duration-300"
        style={{
          boxShadow: `0 20px 50px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.25)`,
        }}
      >
        {/* Glow Accent Ambient Light behind Glass */}
        <div
          className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl opacity-25"
          style={{ backgroundColor: palette.highlight }}
        />

        {/* Compact Header Bar (Always Visible, Acts as Drag Handle) */}
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white/5 border-b border-white/10">
          {/* Drag Handle & Branding (NO Verci Edition) */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-zinc-500 hover:text-zinc-300 cursor-grab transition-colors flex-none">
              <GripVertical className="w-4 h-4" />
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <img
                src="./lyricfy_logo_icon.svg"
                alt="Lyricfy"
                className="w-6 h-6 rounded-lg flex-none object-contain drop-shadow-md pointer-events-none"
              />
              <span className="font-extrabold text-sm tracking-tight text-white flex-none">
                Lyricfy
              </span>
            </div>

            {/* Live Track Pill in Collapsed View */}
            {!isExpanded && track?.title && (
              <div
                title={track.title}
                className="flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/10 text-zinc-200 truncate max-w-[150px]"
              >
                <span className="truncate">{track.title}</span>
              </div>
            )}
          </div>

          {/* Quick Expand / Collapse Pill Button */}
          <div className="flex items-center gap-1 flex-none">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              title={isExpanded ? 'Küçült' : 'Menüyü Genişlet'}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white transition-all cursor-pointer flex items-center gap-1 text-xs"
            >
              {isExpanded ? (
                <>
                  <span className="text-[10px] font-semibold px-1 hidden sm:inline">Kapat</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span className="text-[10px] font-semibold px-1 hidden sm:inline">Kontroller</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Smooth Expandable Body (Accordion Expansion) */}
        <div
          className={`transition-[max-height,opacity,padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
            isExpanded ? 'max-h-[560px] opacity-100 p-3.5' : 'max-h-0 opacity-0 p-0 pointer-events-none'
          }`}
        >
          <div className="flex flex-col gap-3">
            {/* 1. Müzik Kaynağı (Source Mode Switcher) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                <span>Kaynak</span>
                {track?.title && (
                  <span
                    title={`${track.title} - ${track.artist}`}
                    className="text-[10px] text-zinc-300 font-semibold truncate max-w-[180px] normal-case"
                  >
                    {track.title}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                {sourceButtons.map(sb => {
                  const isSelected = sourceMode === sb.id;
                  return (
                    <button
                      key={sb.id}
                      onClick={() => onSelectSourceMode(sb.id)}
                      className={`flex items-center justify-center py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-white/20 text-white shadow-sm border border-white/20'
                          : 'text-zinc-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <span className="text-[11px]">{sb.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 1.5 Söz Akış & Senkron Modu (Smart Line vs Phrase vs Single Word) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                <span className="flex items-center gap-1">
                  <AlignCenter className="w-3 h-3" />
                  <span>Söz Akışı</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-semibold">
                  {syncMode === 'line' ? 'Tam Senkron' : syncMode === 'phrase' ? 'İfade Grubu' : 'Tek Kelime'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                {([
                  { id: 'line', label: 'Satır + Vurgu' },
                  { id: 'phrase', label: '2-3 Kelime' },
                  { id: 'word', label: 'Tek Kelime' },
                ] as { id: SyncMode; label: string }[]).map(sm => {
                  const isSel = syncMode === sm.id;
                  return (
                    <button
                      key={sm.id}
                      onClick={() => onSyncModeChange(sm.id)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        isSel
                          ? 'bg-white/20 text-white shadow-sm border border-white/20'
                          : 'text-zinc-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {sm.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Görsel Stil Seçici (Visualizer Modes) */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                Görsel Stil
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {styles.map(s => {
                  const isActive = currentStyle === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => onStyleChange(s.id)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                        isActive
                          ? 'bg-white/20 text-white border-white/30 shadow-md'
                          : 'bg-white/5 text-zinc-400 border-white/5 hover:bg-white/10 hover:text-zinc-200'
                      }`}
                    >
                      <span style={{ color: isActive ? palette.highlight : undefined }}>
                        {s.icon}
                      </span>
                      <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. İnce Senkron Ayarı (Quick Sync Tuning) */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/10 text-xs">
              <div className="flex items-center gap-1.5 text-zinc-400">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-semibold text-[11px]">Senkron:</span>
                <span className={`font-mono font-bold text-[11px] ${offsetMs === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {offsetMs >= 0 ? `+${offsetMs}` : offsetMs}ms
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onAdjustOffset(-50)}
                  title="-50ms (Kısayol: [)"
                  className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-zinc-200 text-[10px] font-mono transition-colors"
                >
                  -50
                </button>
                <button
                  onClick={() => onAdjustOffset(50)}
                  title="+50ms (Kısayol: ])"
                  className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-zinc-200 text-[10px] font-mono transition-colors"
                >
                  +50
                </button>
                {offsetMs !== 0 && (
                  <button
                    onClick={() => onAdjustOffset(-offsetMs)}
                    title="Sıfırla (Kısayol: 0)"
                    className="p-1 rounded bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* 4. Hızlı Aksiyon Araçları (Actions) */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
                title="Renk ve Parallax Ayarları"
              >
                <Palette className="w-3.5 h-3.5" />
                <span className="text-[11px]">Tema</span>
              </button>

              <button
                onClick={onToggleFullscreen}
                className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 transition-all cursor-pointer"
                title="Tam Ekran (F)"
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                <span className="text-[11px]">{isFullscreen ? 'Normal' : 'Tam Ekran'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
