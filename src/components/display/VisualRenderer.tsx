import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { LyricLine, ColorPalette, ParallaxConfig, SyncMode } from '../../types';
import { getDisplayUnits } from '../../services/lyricsService';
import { LineElement } from './LineElement';

interface VisualRendererProps {
  lines: LyricLine[];
  currentTime: number;
  palette: ColorPalette;
  parallax: ParallaxConfig;
  syncMode?: SyncMode;
}

export const VisualRenderer: React.FC<VisualRendererProps> = ({
  lines,
  currentTime,
  palette,
  parallax,
  syncMode = 'line',
}) => {
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });
  const [smoothIdx, setSmoothIdx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const smoothIdxRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartSmoothIdxRef = useRef(0);
  const animFrameRef = useRef<number>(null);

  const units = useMemo(() => getDisplayUnits(lines, syncMode), [lines, syncMode]);

  const activeUnitIdx = useMemo(() => {
    if (units.length === 0) return 0;
    const idx = units.findIndex(u => currentTime >= u.startTime && currentTime < u.endTime);
    if (idx !== -1) return idx;

    const nextIdx = units.findIndex(u => u.startTime > currentTime);
    return nextIdx !== -1 ? Math.max(0, nextIdx - 1) : Math.max(0, units.length - 1);
  }, [units, currentTime]);

  const rowSpacing = syncMode === 'word' ? 95 : 115;

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
        current += diff * 0.18;
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

  const sensitivity = (parallax.sensitivity / 100) * 15;
  const rotateY = mouseOffset.x * sensitivity;
  const rotateX = -mouseOffset.y * sensitivity;

  const windowRadius = syncMode === 'word' ? 4 : 3;
  const visibleIndices: number[] = [];
  const startIdx = Math.max(0, Math.floor(smoothIdx) - windowRadius);
  const endIdx = Math.min(units.length - 1, Math.ceil(smoothIdx) + windowRadius);

  for (let i = startIdx; i <= endIdx; i++) {
    visibleIndices.push(i);
  }

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden perspective-container select-none px-4 cursor-grab active:cursor-grabbing touch-none"
      style={{
        background: `radial-gradient(circle at 50% 50%, ${palette.highlight}14 0%, #000000 75%)`,
      }}
    >
      {/* 3D Tilting Parallax Plane */}
      <div
        className="w-full max-w-6xl h-[640px] flex items-center justify-center transition-transform duration-75 ease-out preserve-3d pointer-events-none"
        style={{
          transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
        }}
      >
        <div className="relative w-full h-full flex flex-col items-center justify-center preserve-3d">
          {visibleIndices.map((i) => {
            const unit = units[i];
            const delta = i - smoothIdx;
            const yOffset = delta * rowSpacing;

            const isUnitActive = i === activeUnitIdx;
            const isUnitPast = i < activeUnitIdx;

            const zOffset = isUnitActive ? 45 : -Math.abs(delta) * 35;
            const scale = isUnitActive ? 1.06 : Math.max(0.75, 1 - Math.abs(delta) * 0.1);
            const opacity = isUnitActive ? 1 : Math.max(0.18, 0.72 - Math.abs(delta) * 0.16);

            return (
              <div
                key={`unit-${unit.lineIndex}-${unit.startTime}`}
                className="absolute flex items-center justify-center transition-opacity duration-150 preserve-3d text-center w-full"
                style={{
                  transform: `translate3d(0px, ${yOffset}px, ${zOffset}px) scale(${scale})`,
                  opacity,
                  backfaceVisibility: 'hidden',
                  WebkitFontSmoothing: 'antialiased',
                  zIndex: isUnitActive ? 20 : 10 - Math.min(9, Math.floor(Math.abs(delta))),
                }}
              >
                <LineElement
                  line={unit}
                  currentTime={currentTime}
                  isActive={isUnitActive}
                  isPast={isUnitPast}
                  palette={palette}
                  showEmojis={parallax.showEmojis}
                  styleMode="visual"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
