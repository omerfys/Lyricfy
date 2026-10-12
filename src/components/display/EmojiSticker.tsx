import React, { useState } from 'react';

interface EmojiStickerProps {
  emoji: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  bounce?: boolean;
}

/**
 * Converts a unicode emoji sequence to a Twemoji CDN hex string
 */
export function getEmojiTwemojiUrl(emojiChar: string): string {
  const codePoints: string[] = [];
  for (let i = 0; i < emojiChar.length; i++) {
    const code = emojiChar.codePointAt(i);
    if (code !== undefined) {
      if (code > 0xffff) i++;
      // Skip variation selector 0xFE0F for standard single emojis
      if (code !== 0xfe0f) {
        codePoints.push(code.toString(16));
      }
    }
  }
  const hex = codePoints.join('-');
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${hex}.svg`;
}

/**
 * High-definition vector emoji sticker component.
 * Completely replaces ugly default Windows Segoe UI Emoji with
 * vibrant, razor-sharp vector artwork (Twemoji SVG).
 */
export const EmojiSticker: React.FC<EmojiStickerProps> = ({
  emoji,
  size = 'lg',
  className = '',
  bounce = false,
}) => {
  const [failedEmoji, setFailedEmoji] = useState<string | null>(null);
  const hasError = failedEmoji === emoji;

  // Dimension mapping based on size
  const sizeMap = {
    sm: 'w-6 h-6 sm:w-8 sm:h-8',
    md: 'w-9 h-9 sm:w-12 sm:h-12',
    lg: 'w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20',
    xl: 'w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24',
  };

  const svgUrl = getEmojiTwemojiUrl(emoji);

  if (hasError) {
    // Fallback: styled span if CDN is offline
    return (
      <span className={`inline-block select-none ${bounce ? 'animate-bounce' : ''} ${className}`}>
        {emoji}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center flex-none select-none pointer-events-none transform ${
        bounce ? 'animate-bounce' : ''
      } ${className}`}
      style={{ animationDuration: '0.85s' }}
    >
      <img
        src={svgUrl}
        alt={emoji}
        draggable={false}
        loading="eager"
        onError={() => setFailedEmoji(emoji)}
        className={`${sizeMap[size]} object-contain flex-none select-none filter drop-shadow`}
      />
    </span>
  );
};
