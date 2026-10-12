import type { LyricLine, LyricWord, SyncMode } from '../types';
import { getEmojiForWord } from '../data/emojiDictionary';

/**
 * Parses timestamp string "[mm:ss.xx]" or "mm:ss.xx" to seconds
 */
export function parseTimestamp(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const minutes = parseFloat(match[1]);
  const seconds = parseFloat(match[2]);
  return minutes * 60 + seconds;
}

/**
 * Calculates syllable count estimate for timing weighting (Turkish & Multilingual aware)
 */
export function estimateSyllables(word: string): number {
  const clean = word.toLowerCase();
  const vowels = clean.match(/[aeiouyöüıâêîôûàèìòùáéíóú]/gi);
  if (!vowels) {
    const letters = clean.replace(/[^a-zçğışöü]/gi, '');
    return Math.max(1, Math.floor(letters.length / 3));
  }
  return Math.max(1, vowels.length);
}

/**
 * Relative vocal weight of a word within a line (including musical barline breath after commas)
 */
function getWordVocalWeight(token: string, isLast: boolean): number {
  const syl = estimateSyllables(token);
  let weight = 0.25 + syl * 0.85;
  // Mid-line comma/semicolon marks a musical barline / clause breath
  if (!isLast && /[,;:—–-]$/.test(token)) {
    weight += 1.45;
  } else if (!isLast && /[.!?]$/.test(token)) {
    weight += 1.65;
  }
  // Final word holds through the end of the vocal phrase
  if (isLast) {
    weight += 0.55;
  }
  return weight;
}

/**
 * Extracts a flat chronological array of all words from parsed lines
 */
export function getAllWords(lines: LyricLine[]): LyricWord[] {
  const words: LyricWord[] = [];
  for (const line of lines) {
    for (const word of line.words) {
      words.push(word);
    }
  }
  return words;
}

/**
 * Analyzes all lines in the song to detect the true vocal tempo (median seconds per syllable)
 */
function detectSongSyllablePace(parsedLines: { startTime: number; text: string }[]): number {
  const paces: number[] = [];

  for (let i = 0; i < parsedLines.length - 1; i++) {
    const gap = parsedLines[i + 1].startTime - parsedLines[i].startTime;
    // Sample consecutive vocal lines (up to 8.5s gap)
    if (gap >= 1.2 && gap <= 8.5) {
      const tokens = parsedLines[i].text.split(/\s+/).filter(Boolean);
      const syls = tokens.reduce((acc, t) => acc + estimateSyllables(t), 0);
      if (syls >= 3) {
        paces.push((gap * 0.90) / syls);
      }
    }
  }

  if (paces.length === 0) return 0.28;
  paces.sort((a, b) => a - b);
  const mid = Math.floor(paces.length / 2);
  const median = paces.length % 2 !== 0 ? paces[mid] : (paces[mid - 1] + paces[mid]) / 2;

  // Support everything from fast rap (0.12s/syl) to slow groovy/ballad tracks (0.62s/syl)
  return Math.max(0.12, Math.min(0.62, median));
}

/**
 * Creates an instrumental indicator line (for intros and mid-song solos)
 */
function createInstrumentalLine(index: number, startTime: number, endTime: number): LyricLine {
  return {
    lineIndex: index,
    startTime,
    endTime,
    text: '♪ • • •',
    isInstrumental: true,
    words: [
      {
        id: `inst-${index}`,
        text: '♪ • • •',
        cleanText: '',
        startTime,
        endTime,
        emoji: '🎵',
        isSticker: false,
      },
    ],
  };
}

/**
 * Formats unsynced plain lyrics proportionally across track duration based on syllable density
 */
export function formatPlainLyricsProportionally(plainLyrics: string, trackDuration: number): string {
  const rawLines = plainLyrics
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) return '';

  const validDur = trackDuration && trackDuration > 25 ? trackDuration : 180;
  const introOffset = Math.min(10, validDur * 0.06);
  const activeSpan = validDur * 0.86;

  const lineWeights = rawLines.map(line => {
    const tokens = line.split(/\s+/).filter(Boolean);
    const syls = tokens.reduce((acc, t) => acc + estimateSyllables(t), 0);
    return Math.max(2, syls + 2);
  });

  const totalWeight = lineWeights.reduce((a, b) => a + b, 0);
  let cursor = introOffset;

  return rawLines
    .map((line, idx) => {
      const sec = cursor;
      const share = (lineWeights[idx] / Math.max(1, totalWeight)) * activeSpan;
      cursor += share;
      const mm = Math.floor(sec / 60).toString().padStart(2, '0');
      const ss = (sec % 60).toFixed(2).padStart(5, '0');
      return `[${mm}:${ss}] ${line}`;
    })
    .join('\n');
}

/**
 * Parses LRC string (Standard or Enhanced word-by-word) into structured LyricLine[]
 * with Adaptive Song Tempo Analysis and Instrumental Intro/Solo handling.
 */
export function parseLRC(lrcText: string, totalTrackDuration?: number): LyricLine[] {
  if (!lrcText || !lrcText.trim()) return [];

  const rawLines = lrcText.split('\n');
  const parsedLines: { startTime: number; text: string; rawWords?: { time: number; text: string }[] }[] = [];

  const timeRegex = /\[(\d{2}:\d{2}(?:\.\d{2,3})?)\]/g;
  const enhancedWordRegex = /<(\d{2}:\d{2}(?:\.\d{2,3})?)>([^<]+)/g;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const lastMatch = matches[matches.length - 1];
    const time = parseTimestamp(lastMatch[1]);
    const textPart = trimmed.slice(lastMatch.index! + lastMatch[0].length).trim();

    if (!textPart) {
      parsedLines.push({
        startTime: time,
        text: '',
      });
      continue;
    }

    const wordMatches = [...textPart.matchAll(enhancedWordRegex)];
    if (wordMatches.length > 0) {
      const rawWords = wordMatches
        .map(wm => ({
          time: parseTimestamp(wm[1]),
          text: wm[2].trim(),
        }))
        .filter(w => w.text.length > 0);

      parsedLines.push({
        startTime: time,
        text: textPart.replace(/<\d{2}:\d{2}(?:\.\d{2,3})?>/g, '').trim(),
        rawWords,
      });
    } else {
      parsedLines.push({
        startTime: time,
        text: textPart,
      });
    }
  }

  parsedLines.sort((a, b) => a.startTime - b.startTime);

  const nonEmptyLines = parsedLines.filter(l => l.text.length > 0);
  if (nonEmptyLines.length === 0) return [];

  const songSyllablePace = detectSongSyllablePace(nonEmptyLines);
  const result: LyricLine[] = [];
  let lineCounter = 0;

  if (nonEmptyLines[0].startTime >= 3.0) {
    result.push(createInstrumentalLine(lineCounter++, 0, nonEmptyLines[0].startTime));
  }

  for (let i = 0; i < parsedLines.length; i++) {
    const current = parsedLines[i];
    if (!current.text) continue;

    const nextTime =
      i < parsedLines.length - 1
        ? parsedLines[i + 1].startTime
        : totalTrackDuration && totalTrackDuration > current.startTime
        ? totalTrackDuration
        : current.startTime + 4.5;

    const lineGap = Math.max(0.4, nextTime - current.startTime);
    const rawTokens = current.text.split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) continue;

    const totalSyllables = rawTokens.reduce((acc, t) => acc + estimateSyllables(t), 0);

    // Allow up to 1.65x the song's median syllable pace before declaring an instrumental break
    const naturalVocalCeiling = Math.max(2.0, totalSyllables * (songSyllablePace * 1.65) + rawTokens.length * 0.22);
    const vocalSpan = Math.min(lineGap * 0.94, naturalVocalCeiling);

    const hasLongInstrumentalAfter = lineGap - vocalSpan >= 6.5;
    const effectiveLineEndTime = hasLongInstrumentalAfter
      ? current.startTime + vocalSpan + 1.0
      : nextTime;

    let words: LyricWord[] = [];

    if (current.rawWords && current.rawWords.length > 0) {
      for (let w = 0; w < current.rawWords.length; w++) {
        const rawW = current.rawWords[w];
        const nextWordTime = w < current.rawWords.length - 1 ? current.rawWords[w + 1].time : effectiveLineEndTime;
        const emoji = getEmojiForWord(rawW.text);

        words.push({
          id: `line-${lineCounter}-word-${w}`,
          text: rawW.text,
          cleanText: rawW.text.replace(/[^a-z0-9çğışöü]/gi, ''),
          startTime: rawW.time,
          endTime: Math.max(rawW.time + 0.08, nextWordTime),
          emoji,
          isSticker: !!emoji || rawW.text.length >= 4,
        });
      }
    } else if (rawTokens.length === 1) {
      const token = rawTokens[0];
      const emoji = getEmojiForWord(token);
      words.push({
        id: `line-${lineCounter}-word-0`,
        text: token,
        cleanText: token.replace(/[^a-z0-9çğışöü]/gi, ''),
        startTime: current.startTime,
        endTime: effectiveLineEndTime,
        emoji,
        isSticker: !!emoji || token.length >= 4,
      });
    } else {
      const weights = rawTokens.map((t, idx) => getWordVocalWeight(t, idx === rawTokens.length - 1));
      const sumWeight = weights.reduce((a, b) => a + b, 0);

      let wordCursor = current.startTime;

      words = rawTokens.map((token, wIndex) => {
        const isLast = wIndex === rawTokens.length - 1;
        const emoji = getEmojiForWord(token);
        const share = (weights[wIndex] / sumWeight) * vocalSpan;
        const wordStart = wordCursor;
        const wordEnd = isLast
          ? effectiveLineEndTime
          : Math.min(effectiveLineEndTime - 0.05, wordStart + Math.max(0.08, share));

        wordCursor = wordEnd;

        return {
          id: `line-${lineCounter}-word-${wIndex}`,
          text: token,
          cleanText: token.replace(/[^a-z0-9çğışöü]/gi, ''),
          startTime: wordStart,
          endTime: Math.max(wordStart + 0.06, wordEnd),
          emoji,
          isSticker: !!emoji || token.length >= 4,
        };
      });
    }

    const currentLineIdx = lineCounter++;
    result.push({
      lineIndex: currentLineIdx,
      startTime: current.startTime,
      endTime: effectiveLineEndTime,
      text: current.text,
      words,
    });

    if (hasLongInstrumentalAfter && nextTime - effectiveLineEndTime >= 4.0) {
      result.push(createInstrumentalLine(lineCounter++, effectiveLineEndTime, nextTime));
    }
  }

  return result;
}

/**
 * Transforms parsed LyricLine[] according to the active SyncMode
 */
export function getDisplayUnits(lines: LyricLine[], syncMode: SyncMode): LyricLine[] {
  if (!lines || lines.length === 0) return [];

  if (syncMode === 'word') {
    const units: LyricLine[] = [];
    let idx = 0;
    for (const line of lines) {
      if (line.isInstrumental) {
        units.push({ ...line, lineIndex: idx++ });
        continue;
      }
      for (const w of line.words) {
        units.push({
          lineIndex: idx++,
          startTime: w.startTime,
          endTime: w.endTime,
          text: w.text,
          words: [w],
        });
      }
    }
    return units;
  }

  if (syncMode === 'phrase') {
    const units: LyricLine[] = [];
    let idx = 0;
    for (const line of lines) {
      if (line.isInstrumental || line.words.length <= 3) {
        units.push({ ...line, lineIndex: idx++ });
        continue;
      }
      const chunkSize = line.words.length === 4 ? 2 : 3;
      for (let i = 0; i < line.words.length; i += chunkSize) {
        const chunk = line.words.slice(i, i + chunkSize);
        units.push({
          lineIndex: idx++,
          startTime: chunk[0].startTime,
          endTime: chunk[chunk.length - 1].endTime,
          text: chunk.map(w => w.text).join(' '),
          words: chunk,
        });
      }
    }
    return units;
  }

  // Default 'line' mode: 100% LRC Line Sync + Live Word Highlighting inside the active line.
  const units: LyricLine[] = [];
  let idx = 0;

  for (const line of lines) {
    if (line.isInstrumental || (line.words.length <= 7 && line.text.length <= 44)) {
      units.push({ ...line, lineIndex: idx++ });
      continue;
    }

    const mid = Math.ceil(line.words.length / 2);
    let splitAt = mid;
    for (let i = 2; i < line.words.length - 2; i++) {
      if (/[,;:]$/.test(line.words[i].text)) {
        splitAt = i + 1;
        break;
      }
    }

    const firstHalf = line.words.slice(0, splitAt);
    const secondHalf = line.words.slice(splitAt);

    units.push({
      lineIndex: idx++,
      startTime: line.startTime,
      endTime: firstHalf[firstHalf.length - 1].endTime,
      text: firstHalf.map(w => w.text).join(' '),
      words: firstHalf,
    });

    units.push({
      lineIndex: idx++,
      startTime: secondHalf[0].startTime,
      endTime: line.endTime,
      text: secondHalf.map(w => w.text).join(' '),
      words: secondHalf,
    });
  }

  return units;
}

export interface LRCSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

const lyricsCache = new Map<string, { syncedLyrics?: string; plainLyrics?: string }>();

function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArtistTokens(rawArtist: string): string[] {
  const cleaned = (rawArtist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/Official$/i, '')
    .trim();

  if (!cleaned || normalizeText(cleaned) === 'bilinmeyen sanatci') return [];

  return cleaned
    .split(/[,&;/+]|\b(?:feat|ft|with|prod)\b\.?/i)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

/**
 * Extracts candidate track and artist pairs from messy YouTube / Spotify titles
 */
export function extractTrackAndArtistCandidates(rawTitle: string, rawArtist: string): { track: string; artist: string }[] {
  const cleaned = (rawTitle || '')
    .replace(/\((?:Sözleri|Lyrics|Official\s*(?:Music\s*)?Video|Audio|Visualizer|Lyric\s*Video|HD|4K|Clip\s*Officiel|Cover|Acoustic|Live|Remix|Slowed|Reverb|Remastered|Official)\)/gi, '')
    .replace(/\[(?:Sözleri|Lyrics|Official\s*(?:Music\s*)?Video|Audio|Visualizer|Lyric\s*Video|HD|4K|Clip\s*Officiel|Cover|Acoustic|Live|Remix|Slowed|Reverb|Remastered|Official)\]/gi, '')
    .replace(/\s*-\s*(?:Official\s*Audio|Official\s*Video|Lyrics|Sözleri)/gi, '')
    .trim();

  const artistTokens = extractArtistTokens(rawArtist);
  const primaryArtist = artistTokens[0] || rawArtist || '';

  const candidates: { track: string; artist: string }[] = [];

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    const left = parts[0].trim();
    const right = parts.slice(1).join(' - ').trim();
    candidates.push({ track: right, artist: left });
    candidates.push({ track: left, artist: right });
    if (primaryArtist) candidates.push({ track: right, artist: primaryArtist });
  }

  if (rawArtist && rawArtist.trim()) {
    candidates.push({ track: cleaned, artist: rawArtist.trim() });
  }
  if (primaryArtist && primaryArtist !== rawArtist.trim()) {
    candidates.push({ track: cleaned, artist: primaryArtist });
  }
  if (artistTokens.length > 1) {
    candidates.push({ track: cleaned, artist: artistTokens[1] });
  }
  return candidates;
}

function scoreCandidate(
  item: LRCSearchResult,
  targetDuration: number | undefined,
  targetTrack: string,
  originalArtist: string
): number {
  if (!item.syncedLyrics && !item.plainLyrics) return -999;

  const itemTrackNorm = normalizeText(item.trackName);
  const itemArtistNorm = normalizeText(item.artistName);
  const wantTrackNorm = normalizeText(targetTrack);
  const artistTokens = extractArtistTokens(originalArtist).map(normalizeText).filter(Boolean);

  const trackMatches =
    wantTrackNorm &&
    (itemTrackNorm === wantTrackNorm ||
      itemTrackNorm.includes(wantTrackNorm) ||
      wantTrackNorm.includes(itemTrackNorm));

  if (!trackMatches) return -999;

  let artistMatched = false;
  if (artistTokens.length > 0) {
    artistMatched = artistTokens.some(
      tok =>
        itemArtistNorm === tok ||
        itemArtistNorm.includes(tok) ||
        tok.includes(itemArtistNorm) ||
        itemTrackNorm.includes(tok)
    );
  }

  const durDiff =
    targetDuration && targetDuration > 15 && item.duration > 15
      ? Math.abs(item.duration - targetDuration)
      : 999;

  // Reject wrong artist unless duration is an exact match (<= 2.5s)
  if (artistTokens.length > 0 && !artistMatched && durDiff > 2.5) {
    return -999;
  }

  // Reject wildly mismatched durations (> 25s off)
  if (targetDuration && targetDuration > 15 && item.duration > 15 && durDiff > 25) {
    return -999;
  }

  let score = item.syncedLyrics ? 200 : 20;
  if (item.syncedLyrics && /<\d{2}:\d{2}(?:\.\d{2,3})?>/.test(item.syncedLyrics)) {
    score += 55;
  }
  if (artistMatched) score += 100;
  if (itemTrackNorm === wantTrackNorm) score += 40;
  else score += 15;

  if (durDiff <= 1.5) score += 80;
  else if (durDiff <= 3.0) score += 55;
  else if (durDiff <= 6.0) score += 25;
  else if (durDiff <= 12.0) score += 5;
  else if (durDiff < 999) score -= durDiff * 3;

  return score;
}

/**
 * Fetches lyrics with primary bridge proxy and strict artist+duration verified fallback
 */
export async function fetchLyricsFromLRCLIB(
  trackName: string,
  artistName: string,
  duration?: number
): Promise<{ syncedLyrics?: string; plainLyrics?: string } | null> {
  const roundedDur = Math.round(duration || 0);
  const cacheKey = `${trackName}__${artistName}__${roundedDur}`.toLowerCase();
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  // 1. Primary Method: Fetch via local Media Bridge proxy
  try {
    const proxyUrl = `http://localhost:4892/api/lyrics?track=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&duration=${duration || 0}`;
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics || data.plainLyrics) {
        const result = {
          syncedLyrics: data.syncedLyrics,
          plainLyrics: data.plainLyrics,
        };
        lyricsCache.set(cacheKey, result);
        return result;
      }
    } else if (res.status === 404) {
      // Bridge confirmed no verified match exists
      return null;
    }
  } catch {
    // bridge unreachable, fallback to direct browser fetch
  }

  // 2. Direct Fallback with Strict Artist & Duration Scoring
  const candidates = extractTrackAndArtistCandidates(trackName, artistName);
  const collected: { item: LRCSearchResult; score: number }[] = [];

  for (const cand of candidates) {
    try {
      let url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cand.track)}`;
      if (cand.artist && cand.artist.trim()) {
        url += `&artist_name=${encodeURIComponent(cand.artist.trim())}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const list: LRCSearchResult[] = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          for (const it of list) {
            const sc = scoreCandidate(it, duration, cand.track, cand.artist || artistName);
            if (sc > 0) {
              collected.push({ item: it, score: sc });
            }
          }
          if (collected.some(c => c.score >= 360)) break;
        }
      }
    } catch {}
  }

  if (!collected.some(c => c.item.syncedLyrics) && candidates.length > 0) {
    try {
      const firstCand = candidates[0];
      const searchQuery = `${firstCand.track} ${firstCand.artist}`.trim();
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;
      const searchRes = await fetch(searchUrl);
      if (searchRes.ok) {
        const list: LRCSearchResult[] = await searchRes.json();
        if (Array.isArray(list)) {
          for (const it of list) {
            const sc = scoreCandidate(it, duration, firstCand.track, firstCand.artist || artistName);
            if (sc > 0) {
              collected.push({ item: it, score: sc });
            }
          }
        }
      }
    } catch {}
  }

  if (collected.length > 0) {
    collected.sort((a, b) => b.score - a.score);
    const best = collected[0].item;
    const result = {
      syncedLyrics: best.syncedLyrics,
      plainLyrics: best.plainLyrics,
    };
    lyricsCache.set(cacheKey, result);
    return result;
  }

  return null;
}

/**
 * Searches LRCLIB and returns list for UI search modal
 */
export async function searchLRCSongs(query: string): Promise<LRCSearchResult[]> {
  try {
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const list: LRCSearchResult[] = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
