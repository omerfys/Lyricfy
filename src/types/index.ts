export type DisplayStyle = 'visual' | 'ship' | 'fisheye' | 'fisheye-visual';

export type SyncMode = 'line' | 'phrase' | 'word';

export type MediaSourceMode = 'auto' | 'spotify' | 'youtube';

export interface LyricWord {
  id: string;
  text: string;
  cleanText: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  emoji?: string;
  isSticker?: boolean;
}

export interface LyricLine {
  lineIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  words: LyricWord[];
  isInstrumental?: boolean;
}

export interface MediaTrack {
  title: string;
  artist: string;
  album?: string;
  duration: number; // seconds
  position: number; // seconds
  isPlaying: boolean;
  source: 'spotify' | 'youtube' | 'windows' | 'demo';
  coverArt?: string;
}

export interface ColorPalette {
  primary: string;    // base lyric text
  highlight: string;  // sticker / active word
  secondary: string;  // dimmed past/future words
  background: string; // backdrop dark
  autoSync: boolean;
}

export interface ParallaxConfig {
  sensitivity: number; // 0 to 100
  mouseParallax: boolean;
  autoDrift: boolean;
  lensCurvature: number; // for fisheye/CRT
  showEmojis: boolean;
  showScanlines: boolean; // CRT TV scanlines
  chromaticAberration: boolean; // CRT RGB split
  stickerStyle: 'neon-box' | 'cutout' | 'minimal';
}

export interface DemoSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverArt: string;
  lrc: string;
  audioUrl?: string;
  accentColor: string;
}
