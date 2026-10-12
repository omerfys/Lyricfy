import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { LyricLine, ColorPalette, ParallaxConfig, SyncMode } from '../../types';
import { getDisplayUnits } from '../../services/lyricsService';
import { LineElement } from './LineElement';

interface ShipRendererProps {
  lines: LyricLine[];
  currentTime: number;
  palette: ColorPalette;
  parallax: ParallaxConfig;
  syncMode?: SyncMode;
}

export const ShipRenderer: React.FC<ShipRendererProps> = ({
  lines,
  currentTime,
  palette,
  parallax,
  syncMode = 'line',
}) => {
  const [driftOffset, setDriftOffset] = useState({ x: 0, y: 0 });
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

  const rowSpacing = syncMode === 'word' ? 88 : 112;

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
    let t = 0;
    const loop = () => {
      t += 0.015;
      if (parallax.autoDrift) {
        setDriftOffset({
          x: Math.sin(t * 0.8) * 18,
          y: Math.cos(t * 0.5) * 12,
        });
      }
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [parallax.autoDrift]);

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

  const sensitivity = (parallax.sensitivity / 100) * 12;
  const baseRotX = 14 + (-mouseOffset.y * sensitivity);
  const baseRotY = -18 + (mouseOffset.x * sensitivity);

  const windowRadius = syncMode === 'word' ? 5 : 4;
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
      className="relative w-full h-full flex items-center justify-center overflow-hidden perspective-container select-none px-6 cursor-grab active:cursor-grabbing touch-none"
      style={{
        background: `radial-gradient(circle at 35% 45%, ${palette.highlight}18 0%, #000000 80%)`,
      }}
    >
      {/* 3D Drifting Wall */}
      <div
        className="relative w-full max-w-6xl h-[620px] flex items-center justify-center preserve-3d transition-transform duration-100 ease-out pointer-events-none"
        style={{
          transform: `perspective(1200px) rotateX(${baseRotX}deg) rotateY(${baseRotY}deg) rotateZ(2deg) translate3d(${driftOffset.x}px, ${driftOffset.y}px, 0)`,
        }}
      >
        <div className="relative w-full h-full flex flex-col items-center justify-center preserve-3d">
          {visibleIndices.map((i) => {
            const unit = units[i];
            const delta = i - smoothIdx;
            const yOffset = delta * rowSpacing;
            const xShift = delta * 24;

            const isUnitActive = i === activeUnitIdx;
            const isUnitPast = i < activeUnitIdx;

            const zOffset = isUnitActive ? 75 : -Math.abs(delta) * 55;
            const scale = isUnitActive ? 1.1 : Math.max(0.7, 1 - Math.abs(delta) * 0.1);
            const opacity = isUnitActive ? 1 : Math.max(0.15, 0.72 - Math.abs(delta) * 0.16);

            return (
              <div
                key={`unit-${unit.lineIndex}-${unit.startTime}`}
                className="absolute flex items-center justify-center transition-opacity duration-150 preserve-3d w-full"
                style={{
                  transform: `translate3d(${xShift}px, ${yOffset}px, ${zOffset}px) scale(${scale})`,
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
                  styleMode="ship"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
