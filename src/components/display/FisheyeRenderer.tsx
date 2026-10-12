import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { LyricLine, ColorPalette, ParallaxConfig, SyncMode } from '../../types';
import { getDisplayUnits } from '../../services/lyricsService';
import { LineElement } from './LineElement';

interface FisheyeRendererProps {
  lines: LyricLine[];
  currentTime: number;
  palette: ColorPalette;
  parallax: ParallaxConfig;
  syncMode?: SyncMode;
  withVisuals?: boolean;
}

export const FisheyeRenderer: React.FC<FisheyeRendererProps> = ({
  lines,
  currentTime,
  palette,
  parallax,
  syncMode = 'line',
  withVisuals = false,
}) => {
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
  const [smoothIdx, setSmoothIdx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const smoothIdxRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartSmoothIdxRef = useRef(0);
  const animFrameRef = useRef<number>(null);

  // Transform lines into display units based on SyncMode ('line' | 'phrase' | 'word')
  const units = useMemo(() => getDisplayUnits(lines, syncMode), [lines, syncMode]);

  // Find active unit index locked to exact timestamps
  const activeUnitIdx = useMemo(() => {
    if (units.length === 0) return 0;
    const idx = units.findIndex(u => currentTime >= u.startTime && currentTime < u.endTime);
    if (idx !== -1) return idx;

    const nextIdx = units.findIndex(u => u.startTime > currentTime);
    return nextIdx !== -1 ? Math.max(0, nextIdx - 1) : Math.max(0, units.length - 1);
  }, [units, currentTime]);

  const rowSpacing = syncMode === 'word' ? 90 : 112;

  // Responsive spring interpolation back to activeUnitIdx when not dragging
  useEffect(() => {
    if (isDragging) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let current = smoothIdxRef.current;
    const target = activeUnitIdx;

    const lerpLoop = () => {
      if (isDraggingRef.current) return;
      const diff = target - current;
      if (Math.abs(diff) > 0.003) {
        current += diff * 0.18; // Smooth spring glide back to active lyric
        smoothIdxRef.current = current;
        setSmoothIdx(current);
        animFrameRef.current = requestAnimationFrame(lerpLoop);
      } else {
        current = target;
        smoothIdxRef.current = target;
        setSmoothIdx(target);
      }
    };

    animFrameRef.current = requestAnimationFrame(lerpLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [activeUnitIdx, isDragging]);

  // Left-click vertical drag-to-browse handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || units.length === 0) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartYRef.current = e.clientY;
    dragStartSmoothIdxRef.current = smoothIdxRef.current;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, [units.length]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current || units.length === 0) return;
    const deltaY = e.clientY - dragStartYRef.current;
    const nextIdx = Math.max(
      0,
      Math.min(
        units.length - 1,
        dragStartSmoothIdxRef.current - deltaY / (rowSpacing * 0.85)
      )
    );
    smoothIdxRef.current = nextIdx;
    setSmoothIdx(nextIdx);
  }, [units.length, rowSpacing]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  // Interactive 3D Mouse Parallax
  useEffect(() => {
    if (!parallax.mouseParallax) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      setMouseOffset({
        x: (e.clientX / innerWidth - 0.5) * 2,
        y: (e.clientY / innerHeight - 0.5) * 2,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [parallax.mouseParallax]);

  const sensitivity = (parallax.sensitivity / 100) * 14;
  const tiltX = -mouseOffset.y * sensitivity;
  const tiltY = mouseOffset.x * sensitivity;

  // Window of visible units around the current position
  const windowRadius = syncMode === 'word' ? 5 : 4;
  const visibleIndices: number[] = [];
  const startIdx = Math.max(0, Math.floor(smoothIdx) - windowRadius);
  const endIdx = Math.min(units.length - 1, Math.ceil(smoothIdx) + windowRadius);

  for (let i = startIdx; i <= endIdx; i++) {
    visibleIndices.push(i);
  }

  // Fisheye Lens Curvature radius
  const curvatureFactor = (parallax.lensCurvature || 65) / 100;
  const radius = 310 / Math.max(0.4, curvatureFactor);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      className="relative w-full h-full flex items-center justify-center overflow-hidden perspective-container select-none px-4 cursor-grab active:cursor-grabbing touch-none"
      style={{
        background: `radial-gradient(circle at ${50 + mouseOffset.x * 20}% ${50 + mouseOffset.y * 20}%, ${palette.highlight}16 0%, #000000 75%)`,
      }}
    >
      {/* Ambient Radial Depth Glow in the Background */}
      <div
        className="pointer-events-none absolute w-[650px] h-[650px] rounded-full blur-[120px] opacity-25"
        style={{
          backgroundColor: palette.highlight,
          transform: `translate(${mouseOffset.x * 30}px, ${mouseOffset.y * 30}px)`,
        }}
      />

      {/* Seamless, Borderless Fullscreen Fisheye 3D Stage */}
      <div
        className="relative w-full max-w-6xl h-full flex items-center justify-center preserve-3d transition-transform duration-75 ease-out pointer-events-none"
        style={{
          transform: `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
        }}
      >
        {/* Vertical Column with Convex Lens Shader Curvature */}
        <div className="relative w-full h-full flex flex-col items-center justify-center preserve-3d">
          {visibleIndices.map((i) => {
            const unit = units[i];
            const delta = i - smoothIdx;
            const yPixels = delta * rowSpacing;

            // Convex Spherical Lens Arc Math:
            const angle = Math.max(-1.45, Math.min(1.45, yPixels / radius));
            const cosAngle = Math.cos(angle);
            const sinAngle = Math.sin(angle);

            const zDepth = (cosAngle - 1.0) * radius * 1.3 + 85;
            const unitScale = Math.max(0.5, cosAngle * 1.15);
            const rotX = -sinAngle * 40;

            const isUnitActive = i === activeUnitIdx;
            const isUnitPast = i < activeUnitIdx;
            const opacity = isUnitActive ? 1.0 : Math.max(0.14, Math.pow(cosAngle, 2.3));

            return (
              <div
                key={`unit-${unit.lineIndex}-${unit.startTime}`}
                className="absolute flex items-center justify-center transition-opacity duration-150 preserve-3d w-full"
                style={{
                  transform: `translate3d(0px, ${yPixels * 0.92}px, ${zDepth}px) rotateX(${rotX}deg) scale(${unitScale})`,
                  opacity,
                  backfaceVisibility: 'hidden',
                  WebkitFontSmoothing: 'antialiased',
                  zIndex: isUnitActive ? 30 : 10 - Math.min(9, Math.floor(Math.abs(delta))),
                }}
              >
                <LineElement
                  line={unit}
                  currentTime={currentTime}
                  isActive={isUnitActive}
                  isPast={isUnitPast}
                  palette={palette}
                  showEmojis={withVisuals && parallax.showEmojis}
                  styleMode={withVisuals ? 'fisheye-visual' : 'fisheye'}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
