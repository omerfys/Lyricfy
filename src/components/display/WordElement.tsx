import React, { useMemo } from 'react';
import type { LyricWord, ColorPalette } from '../../types';
import { EmojiSticker } from './EmojiSticker';

interface WordElementProps {
  word: LyricWord;
  isActive: boolean;
  isPast: boolean;
  palette: ColorPalette;
  showEmojis?: boolean;
  chromaticAberration?: boolean;
  styleMode: 'visual' | 'ship' | 'fisheye' | 'fisheye-visual';
  scale?: number;
  rotation?: number;
}

export const WordElement: React.FC<WordElementProps> = ({
  word,
  isActive,
  isPast,
  palette,
  showEmojis = true,
  chromaticAberration = false,
  styleMode,
  scale = 1,
  rotation,
}) => {
  // Stable organic tilt angle per word
  const defaultTilt = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < word.text.length; i++) hash += word.text.charCodeAt(i);
    return ((hash % 7) - 3); // between -3deg and +3deg
  }, [word.text]);

  const tiltAngle = rotation !== undefined ? rotation : defaultTilt;
  const hasEmoji = showEmojis && !!word.emoji;
  const isVisualMode = styleMode === 'visual' || styleMode === 'fisheye-visual';
  const isMusicNoteOnly = /^[♪♫♬🎵🎶•.\s-]+$/.test(word.text.trim());

  // Adaptive font sizing based on word length so long/hyphenated words scale down proportionally
  const wordLen = word.text.length;
  const activeSizeClass =
    wordLen > 24
      ? 'text-lg sm:text-2xl md:text-3xl'
      : wordLen > 18
      ? 'text-xl sm:text-3xl md:text-4xl'
      : wordLen > 13
      ? 'text-2xl sm:text-4xl md:text-5xl'
      : wordLen > 8
      ? 'text-3xl sm:text-5xl md:text-6xl'
      : 'text-4xl sm:text-6xl md:text-7xl';

  const inactiveSizeClass =
    wordLen > 24
      ? 'text-base sm:text-xl md:text-2xl'
      : wordLen > 18
      ? 'text-lg sm:text-2xl md:text-3xl'
      : wordLen > 13
      ? 'text-xl sm:text-3xl md:text-4xl'
      : wordLen > 9
      ? 'text-2xl sm:text-4xl md:text-5xl'
      : 'text-3xl sm:text-5xl md:text-6xl';

  // Slightly reduce scale multiplier for very long words so they never overflow the viewport
  const adaptiveScale = wordLen > 20 ? scale * 0.92 : wordLen > 14 ? scale * 0.96 : scale;
  const adaptiveTilt = wordLen > 18 ? tiltAngle * 0.4 : tiltAngle;

  const renderCenteredNoteIcon = (sizeClass: string) => (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${sizeClass} shrink-0 select-none`}
      aria-hidden="true"
    >
      <path d="M19 3v11.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h2V3h-4zm-9 4v8.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V11h3V7h-5z" />
    </svg>
  );

  if (isActive) {
    if (isVisualMode) {
      // Iconic Verci / Sticker Cutout Badge - Razor-Sharp Typography & Optically Centered Note Icon
      return (
        <div
          className={`inline-flex items-center justify-center text-center gap-3 sm:gap-4 max-w-[92vw] ${
            isMusicNoteOnly
              ? 'w-16 h-16 sm:w-20 sm:h-20 p-0'
              : wordLen > 18
              ? 'px-5 sm:px-6 py-2 sm:py-3'
              : 'px-6 sm:px-8 py-2.5 sm:py-3.5'
          } rounded-2xl select-none sticker-badge font-black tracking-tight border border-white/25`}
          style={{
            backgroundColor: palette.highlight,
            color: '#ffffff',
            transform: `scale(${adaptiveScale * 1.14}) rotate(${adaptiveTilt}deg)`,
            boxShadow: `0 14px 32px -4px ${palette.highlight}70, 0 6px 14px -2px rgba(0,0,0,0.8)`,
            textShadow: chromaticAberration
              ? '-2px 0 1px rgba(0,255,255,0.7), 2px 0 1px rgba(255,0,80,0.7)'
              : '0 2px 4px rgba(0,0,0,0.4)',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            textRendering: 'geometricPrecision',
            backfaceVisibility: 'hidden',
            willChange: 'transform',
            transition: 'transform 0.12s cubic-bezier(0.2, 0.9, 0.3, 1.2), background-color 0.2s ease',
          }}
        >
          {isMusicNoteOnly ? (
            renderCenteredNoteIcon('w-9 h-9 sm:w-11 sm:h-11 drop-shadow')
          ) : (
            <span className={`${activeSizeClass} font-black uppercase tracking-tighter leading-tight text-center whitespace-nowrap select-none`}>
              {word.text}
            </span>
          )}
          {hasEmoji && !isMusicNoteOnly && (
            <EmojiSticker
              emoji={word.emoji!}
              size={wordLen > 16 ? 'md' : 'lg'}
              bounce={true}
              className="ml-1 shrink-0"
            />
          )}
        </div>
      );
    } else {
      // Clean Fisheye Active Word - High Contrast Typography & Vector Emoji
      return (
        <div
          className="inline-flex items-center justify-center text-center gap-3 sm:gap-4 max-w-[92vw] font-black tracking-tight select-none"
          style={{
            color: palette.highlight,
            transform: `scale(${adaptiveScale * 1.22})`,
            textShadow: chromaticAberration
              ? `-2px 0 0 rgba(0,255,255,0.8), 2px 0 0 rgba(255,0,80,0.8), 0 2px 10px rgba(0,0,0,0.9)`
              : `0 2px 10px rgba(0,0,0,0.95)`,
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            textRendering: 'geometricPrecision',
            backfaceVisibility: 'hidden',
            willChange: 'transform',
            transition: 'all 0.12s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          {isMusicNoteOnly ? (
            renderCenteredNoteIcon('w-10 h-10 sm:w-14 sm:h-14 drop-shadow-lg')
          ) : (
            <span className={`${activeSizeClass} font-black uppercase tracking-tighter leading-tight text-center whitespace-nowrap`}>
              {word.text}
            </span>
          )}
          {hasEmoji && !isMusicNoteOnly && (
            <EmojiSticker
              emoji={word.emoji!}
              size={wordLen > 16 ? 'md' : 'lg'}
              bounce={false}
              className="ml-1 shrink-0"
            />
          )}
        </div>
      );
    }
  }

  // Past word (sung already, scrolled up)
  if (isPast) {
    return (
      <div
        className="inline-flex items-center justify-center text-center gap-2 max-w-[90vw] select-none font-extrabold opacity-40 transition-all duration-300"
        style={{
          color: palette.secondary,
          transform: `scale(${adaptiveScale * 0.9})`,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'geometricPrecision',
          backfaceVisibility: 'hidden',
        }}
      >
        {isMusicNoteOnly ? (
          renderCenteredNoteIcon('w-8 h-8 sm:w-10 sm:h-10')
        ) : (
          <span className={`${inactiveSizeClass} uppercase tracking-tight leading-tight text-center whitespace-nowrap font-bold`}>
            {word.text}
          </span>
        )}
        {hasEmoji && isVisualMode && !isMusicNoteOnly && (
          <EmojiSticker
            emoji={word.emoji!}
            size="sm"
            className="opacity-40 shrink-0"
          />
        )}
      </div>
    );
  }

  // Upcoming word (future, below)
  return (
    <div
      className="inline-flex items-center justify-center text-center gap-2 max-w-[90vw] select-none font-extrabold opacity-75 transition-all duration-200"
      style={{
        color: palette.primary,
        transform: `scale(${adaptiveScale * 0.95})`,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        textRendering: 'geometricPrecision',
        backfaceVisibility: 'hidden',
      }}
    >
      {isMusicNoteOnly ? (
        renderCenteredNoteIcon('w-8 h-8 sm:w-10 sm:h-10')
      ) : (
        <span className={`${inactiveSizeClass} uppercase tracking-tight leading-tight text-center whitespace-nowrap font-bold`}>
          {word.text}
        </span>
      )}
      {hasEmoji && isVisualMode && !isMusicNoteOnly && (
        <EmojiSticker
          emoji={word.emoji!}
          size="sm"
          className="opacity-70 shrink-0"
        />
      )}
    </div>
  );
};
