import React, { useMemo } from 'react';
import type { LyricLine, ColorPalette } from '../../types';
import { EmojiSticker } from './EmojiSticker';
import { WordElement } from './WordElement';

interface LineElementProps {
  line: LyricLine;
  currentTime: number;
  isActive: boolean;
  isPast: boolean;
  palette: ColorPalette;
  showEmojis?: boolean;
  styleMode: 'visual' | 'ship' | 'fisheye' | 'fisheye-visual';
}

export const LineElement: React.FC<LineElementProps> = ({
  line,
  currentTime,
  isActive,
  isPast,
  palette,
  showEmojis = true,
  styleMode,
}) => {
  const isVisualMode = styleMode === 'visual' || styleMode === 'fisheye-visual';

  // Find up to 2 distinct emojis for inactive line preview
  const linePreviewEmojis = useMemo(() => {
    if (!showEmojis) return [];
    const seen = new Set<string>();
    for (const w of line.words) {
      if (w.emoji && !seen.has(w.emoji)) {
        seen.add(w.emoji);
        if (seen.size >= 2) break;
      }
    }
    return Array.from(seen);
  }, [line.words, showEmojis]);

  const renderCenteredNoteSvg = (sizeClass: string) => (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${sizeClass} shrink-0 select-none`}
      aria-hidden="true"
    >
      <path d="M19 3v11.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h2V3h-4zm-9 4v8.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V11h3V7h-5z" />
    </svg>
  );

  // 1. Instrumental Intro / Solo Indicator
  if (line.isInstrumental || /^[♪♫♬🎵🎶•.\s-]+$/.test(line.text.trim())) {
    const duration = Math.max(0.1, line.endTime - line.startTime);
    const progress = isActive
      ? Math.min(1, Math.max(0, (currentTime - line.startTime) / duration))
      : isPast ? 1 : 0;
    const remainingSec = Math.max(0, Math.ceil(line.endTime - currentTime));

    if (isActive) {
      return (
        <div className="inline-flex flex-col items-center justify-center gap-3 px-7 py-4 rounded-3xl bg-zinc-900/75 border border-white/15 shadow-2xl select-none">
          <div className="flex items-center justify-center gap-3.5">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center border border-white/25 shadow-lg text-white"
              style={{
                backgroundColor: palette.highlight,
                boxShadow: `0 8px 22px -4px ${palette.highlight}80`,
              }}
            >
              {renderCenteredNoteSvg('w-6 h-6')}
            </div>
            <div className="flex items-center justify-center gap-2.5">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{
                    backgroundColor: palette.highlight,
                    animationDelay: `${dot * 200}ms`,
                    boxShadow: `0 0 12px ${palette.highlight}`,
                  }}
                />
              ))}
            </div>
            {remainingSec > 0 && duration >= 3.0 && (
              <span className="text-xs font-mono font-bold text-zinc-300 bg-white/10 px-2.5 py-1 rounded-full">
                {remainingSec}s
              </span>
            )}
          </div>
          {duration >= 3.0 && (
            <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${progress * 100}%`,
                  backgroundColor: palette.highlight,
                }}
              />
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        className="inline-flex items-center justify-center gap-2.5 opacity-40 select-none"
        style={{ color: palette.secondary }}
      >
        {renderCenteredNoteSvg('w-6 h-6 sm:w-7 sm:h-7')}
        <div className="flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-current" />
          <span className="w-2 h-2 rounded-full bg-current" />
          <span className="w-2 h-2 rounded-full bg-current" />
        </div>
      </div>
    );
  }

  // 2. Single-word unit (e.g. 'word' SyncMode or 1-word lyric line)
  if (line.words.length === 1) {
    return (
      <WordElement
        word={line.words[0]}
        isActive={isActive}
        isPast={isPast}
        palette={palette}
        showEmojis={showEmojis}
        styleMode={styleMode}
      />
    );
  }

  // 3. Multi-word Line / Phrase Unit
  // Determine adaptive typography size based on line length AND longest individual word length
  const charCount = line.text.length;
  let maxWordLen = 0;
  for (let i = 0; i < line.words.length; i++) {
    if (line.words[i].text.length > maxWordLen) {
      maxWordLen = line.words[i].text.length;
    }
  }
  const effectiveLen = Math.max(charCount, Math.round(maxWordLen * 1.85));

  const activeFontSizeClass =
    effectiveLen > 48
      ? 'text-xl sm:text-2xl md:text-3xl'
      : effectiveLen > 36
      ? 'text-xl sm:text-3xl md:text-4xl'
      : effectiveLen > 24
      ? 'text-2xl sm:text-4xl md:text-5xl'
      : effectiveLen > 15
      ? 'text-3xl sm:text-5xl md:text-6xl'
      : 'text-4xl sm:text-6xl md:text-7xl';

  const inactiveFontSizeClass =
    effectiveLen > 48
      ? 'text-base sm:text-xl md:text-2xl'
      : effectiveLen > 36
      ? 'text-lg sm:text-2xl md:text-3xl'
      : effectiveLen > 24
      ? 'text-xl sm:text-3xl md:text-4xl'
      : 'text-2xl sm:text-4xl md:text-5xl';

  if (isActive) {
    // Find which word inside this active line is currently being sung
    let activeWordIndex = line.words.findIndex(
      (w) => currentTime >= w.startTime && currentTime < w.endTime
    );
    if (activeWordIndex === -1) {
      if (currentTime < line.words[0].startTime) {
        activeWordIndex = 0;
      } else {
        activeWordIndex = line.words.length - 1;
      }
    }

    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-2.5 max-w-5xl px-4 text-center select-none">
        {line.words.map((word, wIdx) => {
          const isWordCurrent = wIdx === activeWordIndex;
          const isWordSung = wIdx < activeWordIndex;
          const hasWordEmoji = showEmojis && !!word.emoji;
          const isNoteToken = /^[♪♫♬🎵🎶]+$/.test(word.text.trim());

          // Subtle organic tilt for the cutout sticker pill (damped for long words)
          const rawTilt = ((word.text.charCodeAt(0) + wIdx) % 5) - 2; // -2deg to +2deg
          const tilt = word.text.length > 14 ? rawTilt * 0.35 : rawTilt;

          return (
            <span
              key={word.id}
              className="relative inline-flex items-center justify-center text-center gap-1.5 sm:gap-2 transition-transform duration-150 ease-out"
              style={{
                transform: isWordCurrent
                  ? `translateY(-4px) scale(${word.text.length > 16 ? 1.03 : 1.07})`
                  : isWordSung
                  ? 'translateY(0px) scale(1)'
                  : 'translateY(0px) scale(0.98)',
                zIndex: isWordCurrent ? 20 : 10,
              }}
            >
              {/* Non-layout-shifting Cutout Sticker Highlight Pill behind the active word */}
              {isWordCurrent && isVisualMode && (
                <span
                  className="pointer-events-none absolute -inset-x-2.5 sm:-inset-x-3.5 -inset-y-1 sm:-inset-y-1.5 rounded-xl sm:rounded-2xl border border-white/30 transition-all duration-150"
                  style={{
                    backgroundColor: palette.highlight,
                    transform: `rotate(${tilt}deg)`,
                    boxShadow: `0 10px 26px -4px ${palette.highlight}80, 0 4px 10px rgba(0,0,0,0.75)`,
                    zIndex: -1,
                  }}
                />
              )}

              {isNoteToken ? (
                <span
                  className="inline-flex items-center justify-center p-1"
                  style={{
                    color: isWordCurrent
                      ? isVisualMode
                        ? '#ffffff'
                        : palette.highlight
                      : isWordSung
                      ? '#ffffff'
                      : palette.primary,
                    opacity: isWordCurrent ? 1 : isWordSung ? 0.92 : 0.58,
                  }}
                >
                  {renderCenteredNoteSvg('w-8 h-8 sm:w-11 sm:h-11')}
                </span>
              ) : (
                <span
                  className={`${activeFontSizeClass} font-black uppercase tracking-tight leading-tight select-none transition-colors duration-150`}
                  style={{
                    color: isWordCurrent
                      ? isVisualMode
                        ? '#ffffff'
                        : palette.highlight
                      : isWordSung
                      ? '#ffffff'
                      : palette.primary,
                    opacity: isWordCurrent ? 1 : isWordSung ? 0.92 : 0.58,
                    textShadow: isWordCurrent
                      ? '0 2px 8px rgba(0,0,0,0.65)'
                      : '0 2px 10px rgba(0,0,0,0.85)',
                    WebkitFontSmoothing: 'antialiased',
                    MozOsxFontSmoothing: 'grayscale',
                    textRendering: 'geometricPrecision',
                  }}
                >
                  {word.text}
                </span>
              )}

              {hasWordEmoji && !isNoteToken && (
                <EmojiSticker
                  emoji={word.emoji!}
                  size={isWordCurrent ? 'md' : 'sm'}
                  bounce={isWordCurrent}
                  className={isWordCurrent ? 'opacity-100' : isWordSung ? 'opacity-85' : 'opacity-60'}
                />
              )}
            </span>
          );
        })}
      </div>
    );
  }

  // Inactive Line (Past or Upcoming on the 3D Wheel)
  return (
    <div
      className={`inline-flex flex-wrap items-center justify-center gap-2.5 max-w-4xl px-4 text-center select-none transition-all duration-200 ${
        isPast ? 'opacity-35' : 'opacity-70'
      }`}
      style={{
        color: isPast ? palette.secondary : palette.primary,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        textRendering: 'geometricPrecision',
      }}
    >
      <span className={`${inactiveFontSizeClass} font-extrabold uppercase tracking-tight leading-snug`}>
        {line.text.replace(/[♪♫♬]/g, '').trim() || line.text}
      </span>
      {isVisualMode &&
        linePreviewEmojis.map((em, idx) => (
          <EmojiSticker
            key={idx}
            emoji={em}
            size="sm"
            className={isPast ? 'opacity-40' : 'opacity-75'}
          />
        ))}
    </div>
  );
};
