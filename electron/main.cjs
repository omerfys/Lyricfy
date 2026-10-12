const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const readline = require('readline');
const fs = require('fs');

let mainWindow = null;
let powerBlockerId = null;
let daemonChild = null;
let isShuttingDown = false;

const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

let latestState = {
  status: 'ok',
  sessions: [],
  lastUpdated: Date.now(),
};

const sseClients = new Set();
const lyricsMemoryCache = new Map();

function getScriptsDir() {
  const unpacked = path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'scripts');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, '../scripts');
}

function startDaemon() {
  if (isShuttingDown) return;
  const scriptsDir = getScriptsDir();
  const daemonScriptPath = path.join(scriptsDir, 'live-daemon.ps1');

  try {
    const child = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-NoProfile',
      '-File', daemonScriptPath,
    ], {
      windowsHide: true,
    });
    daemonChild = child;

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const jsonStr = trimmed.startsWith('B64:')
          ? Buffer.from(trimmed.slice(4), 'base64').toString('utf8')
          : trimmed;
        const parsed = JSON.parse(jsonStr);
        const sessions = Array.isArray(parsed) ? parsed : (parsed.sessions || [parsed]);

        latestState = {
          status: 'ok',
          sessions,
          lastUpdated: Date.now(),
        };

        const payload = `data: ${JSON.stringify(latestState)}\n\n`;
        for (const res of sseClients) {
          res.write(payload);
        }
      } catch {}
    });

    child.on('close', () => {
      if (isShuttingDown) return;
      setTimeout(startDaemon, 1000);
    });

    child.on('error', () => {
      if (isShuttingDown) return;
      setTimeout(startDaemon, 2000);
    });
  } catch {}
}

function normalizeText(str) {
  return (str || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[âêîôû]/g, (m) => ({ â: 'a', ê: 'e', î: 'i', ô: 'o', û: 'u' }[m] || m))
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArtistTokens(rawArtist) {
  const cleaned = (rawArtist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/Official$/i, '')
    .replace(/Music$/i, '')
    .trim();

  if (!cleaned || normalizeText(cleaned) === 'bilinmeyen sanatci') return [];

  return cleaned
    .split(/[,&;/+]|\b(?:feat|ft|with|prod|x)\b\.?/i)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

function cleanTrackTitle(rawTitle) {
  return (rawTitle || '')
    .replace(/\((?:[^)]*(?:Sözleri|Lyrics|Official|Video|Audio|Visualizer|HD|4K|Clip|Cover|Acoustic|Live|Remastered|Prod|Müzik|Klip)[^)]*)\)/gi, '')
    .replace(/\[(?:[^\]]*(?:Sözleri|Lyrics|Official|Video|Audio|Visualizer|HD|4K|Clip|Cover|Acoustic|Live|Remastered|Prod|Müzik|Klip)[^\]]*)\]/gi, '')
    .replace(/\s*[-|•]\s*(?:Official\s*(?:Music\s*)?(?:Video|Audio)|Lyrics|Sözleri|Visualizer|4K|HD).*$/gi, '')
    .trim();
}

function getCandidates(rawTitle, rawArtist) {
  const cleaned = cleanTrackTitle(rawTitle);
  const artistTokens = extractArtistTokens(rawArtist);
  const primaryArtist = artistTokens[0] || rawArtist || '';
  const list = [];
  const seen = new Set();

  const addCand = (track, artist) => {
    const t = (track || '').trim();
    const a = (artist || '').trim();
    if (!t) return;
    const key = `${t.toLowerCase()}|${a.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push({ track: t, artist: a });
    }
    // Also add Turkish dotted İ variant for uppercase words ending in I (e.g. NKBI -> NKBİ)
    if (/[A-ZÇĞÖŞÜ]I\b/.test(t)) {
      const trVariant = t.replace(/([A-ZÇĞÖŞÜ])I\b/g, '$1İ');
      const trKey = `${trVariant.toLowerCase()}|${a.toLowerCase()}`;
      if (!seen.has(trKey)) {
        seen.add(trKey);
        list.push({ track: trVariant, artist: a });
      }
    }
  };

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    const left = parts[0].trim();
    const right = parts.slice(1).join(' - ').trim();
    addCand(right, left);
    addCand(left, right);
    if (primaryArtist) addCand(right, primaryArtist);
  }

  if (rawArtist && rawArtist.trim()) {
    addCand(cleaned, rawArtist.trim());
  }
  if (primaryArtist && primaryArtist !== (rawArtist || '').trim()) {
    addCand(cleaned, primaryArtist);
  }
  if (artistTokens.length > 1) {
    addCand(cleaned, artistTokens[1]);
  }
  addCand(cleaned, '');

  return list;
}

function scoreLrcItem(item, targetDuration, targetTrack, originalArtist) {
  if (!item || (!item.syncedLyrics && !item.plainLyrics)) return -999;

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

  // Penalize remix/mashup if user is not playing a remix
  const wantIsRemix = /remix|slowed|reverb|sped|live|acoustic|\bx\b/i.test(targetTrack);
  const itemIsRemix = /remix|slowed|reverb|sped|live|acoustic|\bx\b/i.test(item.trackName);

  let artistMatched = false;
  if (artistTokens.length > 0) {
    artistMatched = artistTokens.some(
      (tok) =>
        itemArtistNorm === tok ||
        itemArtistNorm.includes(tok) ||
        tok.includes(itemArtistNorm) ||
        itemTrackNorm.includes(tok)
    );
  }

  const durDiff =
    targetDuration > 15 && item.duration > 15
      ? Math.abs(item.duration - targetDuration)
      : 999;

  if (artistTokens.length > 0 && !artistMatched && durDiff > 2.5) {
    return -999;
  }

  if (targetDuration > 15 && item.duration > 15) {
    if (!artistMatched && durDiff > 35) return -999;
    if (durDiff > 180) return -999;
  }

  let score = item.syncedLyrics ? 200 : 20;
  if (item.syncedLyrics && /<\d{2}:\d{2}(?:\.\d{2,3})?>/.test(item.syncedLyrics)) {
    score += 55;
  }
  if (artistMatched) score += 100;
  if (itemTrackNorm === wantTrackNorm) score += 50;
  else score += 15;

  if (wantIsRemix !== itemIsRemix) {
    score -= 65;
  }

  if (durDiff <= 1.5) score += 85;
  else if (durDiff <= 3.0) score += 60;
  else if (durDiff <= 6.0) score += 30;
  else if (durDiff <= 12.0) score += 10;
  else if (durDiff < 999) score -= Math.min(65, durDiff * 1.5);

  return score;
}

function formatLrcTimestamp(sec) {
  const clamped = Math.max(0, sec);
  const mm = Math.floor(clamped / 60).toString().padStart(2, '0');
  const ss = (clamped % 60).toFixed(2).padStart(5, '0');
  return `${mm}:${ss}`;
}

function wordsRoughlyMatch(aNorm, bNorm) {
  if (!aNorm || !bNorm) return false;
  if (aNorm === bNorm) return true;
  const minLen = Math.min(aNorm.length, bNorm.length);
  if (minLen >= 3) {
    const prefix = Math.min(4, minLen);
    if (aNorm.slice(0, prefix) === bNorm.slice(0, prefix)) return true;
  }
  if (minLen >= 4) {
    if (aNorm.includes(bNorm.slice(0, 4)) || bNorm.includes(aNorm.slice(0, 4))) return true;
  }
  return false;
}

/**
 * Queries YouTube Music (WEB_REMIX) & YouTube Search to find the best matching videoId,
 * then fetches ANDROID (20.03.35) srv3 word-level timed captions and official YTM lyrics.
 */
async function fetchYouTubeSyncData(trackName, artistName, targetDuration, needPlainLyrics = false) {
  try {
    const cleanTrack = cleanTrackTitle(trackName);
    const cleanArtist = (artistName || '')
      .replace(/bilinmeyen\s*sanat[cç][ıi]|unknown|youtube|music|- topic|vevo/gi, '')
      .trim();
    const query = `${cleanTrack} ${cleanArtist}`.trim();
    if (!query) return null;

    const htmlVideoIds = [];
    const ytmVideoIds = [];

    // 1 & 2. Run YouTube HTML search and YouTube Music WEB_REMIX search in parallel
    await Promise.all([
      (async () => {
        try {
          const searchHtmlRes = await fetch(
            `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
            {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cookie': 'CONSENT=YES+cb',
              },
            }
          );
          if (searchHtmlRes.ok) {
            const html = await searchHtmlRes.text();
            const videoRegex = /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"(?:(?!videoRenderer).)*?"lengthText":\{(?:(?!lengthText).)*?"simpleText":"(\d+:\d+(?::\d+)?)"\}/g;
            const matches = [];
            let m;
            while ((m = videoRegex.exec(html)) !== null) {
              const vid = m[1];
              const parts = m[2].split(':').map(Number);
              const durSec =
                parts.length === 3
                  ? parts[0] * 3600 + parts[1] * 60 + parts[2]
                  : parts[0] * 60 + parts[1];
              matches.push({ videoId: vid, duration: durSec });
              if (matches.length >= 10) break;
            }

            if (targetDuration && targetDuration > 15) {
              matches.sort(
                (a, b) => Math.abs(a.duration - targetDuration) - Math.abs(b.duration - targetDuration)
              );
            }

            for (const item of matches) {
              if (!targetDuration || targetDuration <= 15 || Math.abs(item.duration - targetDuration) <= 25) {
                htmlVideoIds.push(item.videoId);
              }
            }
          }
        } catch {}
      })(),
      (async () => {
        try {
          const ytmSearchRes = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'tr', gl: 'TR' } },
              query,
            }),
          });
          if (ytmSearchRes.ok) {
            const ytmTxt = await ytmSearchRes.text();
            const vidMatches = [...ytmTxt.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
            for (const vm of vidMatches.slice(0, 5)) {
              ytmVideoIds.push(vm[1]);
            }
          }
        } catch {}
      })(),
    ]);

    const seenIds = new Set();
    const candidateVideoIds = [];
    for (const id of [...htmlVideoIds, ...ytmVideoIds]) {
      if (!seenIds.has(id)) {
        seenIds.add(id);
        candidateVideoIds.push(id);
      }
    }

    if (candidateVideoIds.length === 0) return null;

    let ytWords = [];
    let ytEvents = [];
    let ytmPlainLyrics = null;

    // 3. Fetch ANDROID (20.03.35) srv3 word-level captions in parallel across top candidates
    const captionResults = await Promise.all(
      candidateVideoIds.slice(0, 3).map(async (videoId) => {
        try {
          const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: 'ANDROID',
                  clientVersion: '20.03.35',
                  androidSdkVersion: 34,
                  osName: 'Android',
                  osVersion: '14',
                  hl: 'tr',
                  gl: 'TR',
                },
              },
              videoId,
            }),
          });
          if (!playerRes.ok) return null;
          const playerData = await playerRes.json();
          const vidLenSec = Number(playerData?.videoDetails?.lengthSeconds || 0);
          if (targetDuration > 15 && vidLenSec > 15 && Math.abs(vidLenSec - targetDuration) > 25) {
            return null;
          }

          const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          if (captionTracks.length === 0) return null;

          captionTracks.sort((a, b) => {
            const aLang = (a.languageCode || '').toLowerCase();
            const bLang = (b.languageCode || '').toLowerCase();
            const aTr = aLang.startsWith('tr') ? 2 : aLang.startsWith('en') ? 1 : 0;
            const bTr = bLang.startsWith('tr') ? 2 : bLang.startsWith('en') ? 1 : 0;
            if (aTr !== bTr) return bTr - aTr;
            const aAsr = a.kind === 'asr' ? 1 : 0;
            const bAsr = b.kind === 'asr' ? 1 : 0;
            return bAsr - aAsr;
          });

          const chosenTrack = captionTracks[0];
          if (!chosenTrack || !chosenTrack.baseUrl) return null;

          const xmlRes = await fetch(chosenTrack.baseUrl);
          if (!xmlRes.ok) return null;
          const xml = await xmlRes.text();
          if (!xml || xml.length < 50) return null;

          const words = [];
          const events = [];
          const pRe = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
          let pm;
          while ((pm = pRe.exec(xml)) !== null) {
            const pStartMs = parseInt(pm[1], 10);
            const inner = pm[3];
            if (!inner || !inner.trim()) continue;

            const sRe = /<s(?: t="(\d+)")?[^>]*>([^<]+)<\/s>/g;
            let sm;
            const segWords = [];
            while ((sm = sRe.exec(inner)) !== null) {
              const offMs = sm[1] ? parseInt(sm[1], 10) : 0;
              const rawW = sm[2]
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\[.*?\]|\(.*?\)|♪+|♫+/g, '')
                .trim();
              if (!rawW) continue;
              const wTime = (pStartMs + offMs) / 1000;
              const normW = normalizeText(rawW);
              if (normW) {
                words.push({ time: wTime, raw: rawW, norm: normW });
                segWords.push({ time: wTime, text: rawW, norm: normW });
              }
            }

            if (segWords.length === 0) {
              const cleanP = inner
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\[.*?\]|\(.*?\)|♪+|♫+/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              if (cleanP.length >= 2) {
                const pTokens = cleanP.split(' ').filter(Boolean);
                const pDurSec = Math.max(0.5, parseInt(pm[2], 10) / 1000);
                pTokens.forEach((tok, idx) => {
                  const wTime = pStartMs / 1000 + (idx / pTokens.length) * (pDurSec * 0.85);
                  const normW = normalizeText(tok);
                  if (normW) {
                    words.push({ time: wTime, raw: tok, norm: normW });
                    segWords.push({ time: wTime, text: tok, norm: normW });
                  }
                });
              }
            }

            if (segWords.length > 0) {
              events.push({
                startSec: segWords[0].time,
                text: segWords.map(w => w.text).join(' '),
                normTokens: segWords.map(w => w.norm).filter(Boolean),
                segWords,
              });
            }
          }

          if (words.length >= 6) {
            return { words, events, durDiff: targetDuration > 15 && vidLenSec > 15 ? Math.abs(vidLenSec - targetDuration) : 999 };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    const validCaptions = captionResults.filter(Boolean).sort((a, b) => a.durDiff - b.durDiff);
    if (validCaptions.length > 0) {
      ytWords = validCaptions[0].words;
      ytEvents = validCaptions[0].events;
    }

    // 4. Only check YouTube Music Official Lyrics tab (WEB_REMIX next -> browse) if LRCLIB had no lyrics
    if (needPlainLyrics) {
      for (const videoId of candidateVideoIds.slice(0, 2)) {
        try {
          const nextRes = await fetch('https://music.youtube.com/youtubei/v1/next?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'tr', gl: 'TR' } },
              videoId,
            }),
          });
          if (!nextRes.ok) continue;
          const nextTxt = await nextRes.text();
          const bMatch = nextTxt.match(/"browseId":"(MPLYt_[^"]+)"/);
          if (!bMatch?.[1]) continue;

          const browseRes = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'tr', gl: 'TR' } },
              browseId: bMatch[1],
            }),
          });
          if (!browseRes.ok) continue;
          const browseTxt = await browseRes.text();
          const descMatch = browseTxt.match(/"description":\{"runs":\[\{"text":"((?:\\.|[^"\\])+)"/);
          if (descMatch?.[1]) {
            ytmPlainLyrics = JSON.parse(`"${descMatch[1]}"`);
            break;
          }
        } catch {}
      }
    }

    return { ytWords, ytEvents, ytmPlainLyrics };
  } catch {
    return null;
  }
}

/**
 * Aligns studio synced LRC lines AND individual words against the YouTube video's srv3 word stream.
 * Handles intro offsets, mid-video dialogue breaks (piecewise local offset interpolation),
 * and injects Enhanced LRC <mm:ss.xx> word timestamps.
 */
function alignLrcWithYouTubeWordStream(syncedLyrics, ytWords) {
  if (!syncedLyrics || !ytWords || ytWords.length < 5) return syncedLyrics;

  const rawLines = syncedLyrics.split('\n');
  const parsedLines = [];
  const timeRe = /\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\](.*)/;

  for (const raw of rawLines) {
    const m = raw.trim().match(timeRe);
    if (!m) continue;
    const startSec = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const text = m[3].replace(/<\d{2}:\d{2}(?:\.\d{2,3})?>/g, '').trim();
    if (!text) continue;
    const tokens = text.split(/\s+/).filter(Boolean);
    const normTokens = tokens.map(t => normalizeText(t));
    parsedLines.push({
      origStart: startSec,
      text,
      tokens,
      normTokens,
      matchedTime: null,
      wordTimes: new Array(tokens.length).fill(null),
      finalTime: startSec,
    });
  }

  if (parsedLines.length === 0) return syncedLyrics;

  let ytCursor = 0;
  const lineOffsets = [];

  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i];
    const runningOffset = lineOffsets.length > 0 ? lineOffsets[lineOffsets.length - 1].offset : 0;
    const minTime = Math.max(0, line.origStart + Math.min(-12, runningOffset - 15));
    const maxTime = line.origStart + Math.max(75, runningOffset + 55);

    let bestStartIdx = -1;
    let bestScore = 0;
    let bestFirstTime = null;
    let bestWordTimes = null;

    for (let j = Math.max(0, ytCursor - 4); j < ytWords.length; j++) {
      const yw = ytWords[j];
      if (yw.time < minTime) continue;
      if (yw.time > maxTime) break;

      let hits = 0;
      let firstHitTime = null;
      let kCursor = j;
      const tempWordTimes = new Array(line.tokens.length).fill(null);

      for (let tIdx = 0; tIdx < line.normTokens.length; tIdx++) {
        const lNorm = line.normTokens[tIdx];
        if (!lNorm) continue;
        for (let k = kCursor; k < Math.min(ytWords.length, kCursor + 6); k++) {
          if (ytWords[k].time - yw.time > 7.5) break;
          if (wordsRoughlyMatch(lNorm, ytWords[k].norm)) {
            hits++;
            if (firstHitTime === null && tIdx <= 1) {
              firstHitTime = ytWords[k].time - (tIdx === 1 ? 0.32 : 0);
            }
            tempWordTimes[tIdx] = ytWords[k].time;
            kCursor = k + 1;
            break;
          }
        }
      }

      const score = hits / Math.max(1, line.normTokens.length);
      if (
        firstHitTime !== null &&
        (hits >= 2 || (line.normTokens.length <= 2 && hits >= 1 && Math.abs(firstHitTime - line.origStart) <= 4.0)) &&
        score > bestScore
      ) {
        bestScore = score;
        bestStartIdx = j;
        bestFirstTime = Math.max(0, firstHitTime);
        bestWordTimes = tempWordTimes;
        if (score >= 0.75) break;
      }
    }

    if (bestStartIdx !== -1 && bestFirstTime !== null) {
      ytCursor = bestStartIdx + 1;
      line.matchedTime = bestFirstTime;
      line.wordTimes = bestWordTimes;
      lineOffsets.push({ idx: i, offset: bestFirstTime - line.origStart });
    }
  }

  if (lineOffsets.length === 0) return syncedLyrics;

  const sortedOffsets = lineOffsets.map(o => o.offset).sort((a, b) => a - b);
  const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];

  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i];
    if (line.matchedTime !== null) {
      line.finalTime = line.matchedTime;
    } else {
      let prev = null;
      let next = null;
      for (const o of lineOffsets) {
        if (o.idx < i) prev = o;
        else if (o.idx > i && !next) next = o;
      }
      let localOffset = medianOffset;
      if (prev && next) {
        const ratio = (i - prev.idx) / (next.idx - prev.idx);
        localOffset = prev.offset + ratio * (next.offset - prev.offset);
      } else if (prev) {
        localOffset = prev.offset;
      } else if (next) {
        localOffset = next.offset;
      }
      line.finalTime = Math.max(0, line.origStart + localOffset);
    }
  }

  // Enforce strictly non-decreasing line timestamps
  for (let i = 1; i < parsedLines.length; i++) {
    if (parsedLines[i].finalTime <= parsedLines[i - 1].finalTime) {
      parsedLines[i].finalTime = parsedLines[i - 1].finalTime + 0.35;
    }
  }

  // Format output with Enhanced LRC <mm:ss.xx> word tags when matched words are present
  return parsedLines
    .map((line, idx) => {
      const lineEnd =
        idx < parsedLines.length - 1
          ? parsedLines[idx + 1].finalTime
          : line.finalTime + 4.0;
      const matchedCount = line.wordTimes.filter(t => t !== null).length;

      if (matchedCount >= 2 && line.tokens.length >= 2) {
        // Fill in any missing word times inside the line by linear interpolation
        const filled = [...line.wordTimes];
        if (filled[0] === null || filled[0] < line.finalTime) {
          filled[0] = line.finalTime;
        }
        for (let w = 1; w < filled.length; w++) {
          if (filled[w] === null) {
            let nextKnownIdx = -1;
            for (let k = w + 1; k < filled.length; k++) {
              if (filled[k] !== null) {
                nextKnownIdx = k;
                break;
              }
            }
            const prevTime = filled[w - 1];
            const targetEnd = nextKnownIdx !== -1 ? filled[nextKnownIdx] : Math.max(prevTime + 0.3, lineEnd - 0.15);
            const steps = (nextKnownIdx !== -1 ? nextKnownIdx : filled.length) - (w - 1);
            filled[w] = prevTime + (targetEnd - prevTime) / Math.max(1, steps);
          }
          if (filled[w] <= filled[w - 1]) {
            filled[w] = filled[w - 1] + 0.08;
          }
        }

        const enhancedBody = line.tokens
          .map((tok, w) => `<${formatLrcTimestamp(filled[w])}>${tok}`)
          .join(' ');
        return `[${formatLrcTimestamp(line.finalTime)}] ${enhancedBody}`;
      }

      return `[${formatLrcTimestamp(line.finalTime)}] ${line.text}`;
    })
    .join('\n');
}

/**
 * Aligns unsynced plain lyrics against YouTube's srv3 word stream to produce synced LRC!
 */
function alignPlainLyricsWithYouTubeWords(plainLyrics, ytWords, totalDuration) {
  if (!plainLyrics || !ytWords || ytWords.length < 5) return null;

  const rawLines = plainLyrics
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^\[.*\]$/.test(l));

  if (rawLines.length === 0) return null;

  const dur = totalDuration && totalDuration > 20 ? totalDuration : ytWords[ytWords.length - 1].time + 5;
  const lines = rawLines.map((text, idx) => {
    const tokens = text.split(/\s+/).filter(Boolean);
    const normTokens = tokens.map(t => normalizeText(t));
    const expectedTime = (idx / rawLines.length) * (dur * 0.9);
    return { text, tokens, normTokens, expectedTime, matchedTime: null };
  });

  let ytCursor = 0;
  const matchedIndices = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let bestIdx = -1;
    let bestScore = 0;
    let bestTime = null;

    const searchEnd = Math.min(ytWords.length, ytCursor + 60);
    for (let j = Math.max(0, ytCursor - 2); j < searchEnd; j++) {
      let hits = 0;
      let firstTime = null;
      let kCursor = j;

      for (let tIdx = 0; tIdx < line.normTokens.length; tIdx++) {
        const lNorm = line.normTokens[tIdx];
        if (!lNorm) continue;
        for (let k = kCursor; k < Math.min(ytWords.length, kCursor + 5); k++) {
          if (ytWords[k].time - ytWords[j].time > 7.5) break;
          if (wordsRoughlyMatch(lNorm, ytWords[k].norm)) {
            hits++;
            if (firstTime === null) firstTime = ytWords[k].time;
            kCursor = k + 1;
            break;
          }
        }
      }

      const score = hits / Math.max(1, line.normTokens.length);
      if (firstTime !== null && hits >= 2 && score > bestScore) {
        bestScore = score;
        bestIdx = j;
        bestTime = firstTime;
        if (score >= 0.75) break;
      }
    }

    if (bestIdx !== -1 && bestTime !== null) {
      line.matchedTime = bestTime;
      ytCursor = bestIdx + 1;
      matchedIndices.push(i);
    }
  }

  if (matchedIndices.length < 3) return null;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].matchedTime !== null) continue;
    let prevIdx = -1;
    let nextIdx = -1;
    for (const mIdx of matchedIndices) {
      if (mIdx < i) prevIdx = mIdx;
      else if (mIdx > i && nextIdx === -1) nextIdx = mIdx;
    }
    if (prevIdx !== -1 && nextIdx !== -1) {
      const ratio = (i - prevIdx) / (nextIdx - prevIdx);
      lines[i].matchedTime =
        lines[prevIdx].matchedTime +
        ratio * (lines[nextIdx].matchedTime - lines[prevIdx].matchedTime);
    } else if (prevIdx !== -1) {
      lines[i].matchedTime = lines[prevIdx].matchedTime + (i - prevIdx) * 2.6;
    } else if (nextIdx !== -1) {
      lines[i].matchedTime = Math.max(0, lines[nextIdx].matchedTime - (nextIdx - i) * 2.6);
    }
  }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].matchedTime <= lines[i - 1].matchedTime) {
      lines[i].matchedTime = lines[i - 1].matchedTime + 0.4;
    }
  }

  return lines.map(l => `[${formatLrcTimestamp(l.matchedTime)}] ${l.text}`).join('\n');
}

function convertYouTubeEventsToLrc(ytEvents) {
  if (!ytEvents || ytEvents.length === 0) return '';
  return ytEvents
    .map((ev) => {
      const lineTs = `[${formatLrcTimestamp(ev.startSec)}]`;
      if (ev.segWords && ev.segWords.length > 1) {
        const enhanced = ev.segWords
          .map((w) => `<${formatLrcTimestamp(w.time)}>${w.text}`)
          .join(' ');
        return `${lineTs} ${enhanced}`;
      }
      return `${lineTs} ${ev.text}`;
    })
    .join('\n');
}

async function fetchJsonWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'LyricfyApp/1.0.0 (https://github.com/omerfys/Lyricfy)' },
      });
      if (res.ok) {
        return await res.json();
      }
      if (res.status === 503 && attempt < retries) {
        await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  return null;
}

async function fetchLyricsBackend(trackName, artistName, duration, wantYoutubeSync = false) {
  const roundedDur = Math.round(duration || 0);
  const cacheKey = `${trackName}__${artistName}__${roundedDur}__${wantYoutubeSync ? 'yt' : 'fast'}`.toLowerCase();
  if (lyricsMemoryCache.has(cacheKey)) {
    return lyricsMemoryCache.get(cacheKey);
  }

  const candidates = getCandidates(trackName, artistName);
  const collected = [];

  // Fire /api/get, /api/search?track_name, and /api/search?q simultaneously at t=0ms,
  // and resolve IMMEDIATELY the moment any query returns a verified synced match (score >= 310)!
  await new Promise((resolveRace) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolveRace();
      }
    };

    const tasks = [];

    for (const cand of candidates.slice(0, 2)) {
      if (cand.track && cand.artist) {
        tasks.push(
          (async () => {
            try {
              let getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cand.track)}&artist_name=${encodeURIComponent(cand.artist)}`;
              if (duration && duration > 15) {
                getUrl += `&duration=${Math.round(duration)}`;
              }
              const item = await fetchJsonWithRetry(getUrl, 0);
              if (item && (item.syncedLyrics || item.plainLyrics)) {
                const sc = scoreLrcItem(item, duration, cand.track, cand.artist || artistName);
                if (sc > 0) {
                  collected.push({ item, score: sc + 20 });
                  if (item.syncedLyrics && sc >= 300) done();
                }
              }
            } catch {}
          })()
        );
      }

      if (cand.track) {
        tasks.push(
          (async () => {
            try {
              let searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cand.track)}`;
              if (cand.artist && cand.artist.trim()) {
                searchUrl += `&artist_name=${encodeURIComponent(cand.artist.trim())}`;
              }
              const list = await fetchJsonWithRetry(searchUrl, 0);
              if (Array.isArray(list) && list.length > 0) {
                for (const it of list) {
                  const sc = scoreLrcItem(it, duration, cand.track, cand.artist || artistName);
                  if (sc > 0) {
                    collected.push({ item: it, score: sc });
                  }
                }
                if (collected.some(c => c.item.syncedLyrics && c.score >= 310)) done();
              }
            } catch {}
          })()
        );
      }
    }

    if (candidates.length > 0) {
      const firstCand = candidates[0];
      const q = `${firstCand.track} ${firstCand.artist}`.trim();
      if (q) {
        tasks.push(
          (async () => {
            try {
              const items = await fetchJsonWithRetry(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, 0);
              if (Array.isArray(items)) {
                for (const it of items) {
                  const sc = scoreLrcItem(it, duration, firstCand.track, firstCand.artist || artistName);
                  if (sc > 0) {
                    collected.push({ item: it, score: sc });
                  }
                }
                if (collected.some(c => c.item.syncedLyrics && c.score >= 310)) done();
              }
            } catch {}
          })()
        );
      }
    }

    Promise.allSettled(tasks).then(done);
  });

  if (collected.length > 0) {
    collected.sort((a, b) => b.score - a.score);
    const best = collected[0].item;
    const durDiff =
      duration && duration > 15 && best.duration > 15
        ? Math.abs(best.duration - duration)
        : 0;

    // INSTANT FAST PATH (~200-350ms): If we have synced lyrics and duration matches closely (<= 8s),
    // return immediately without blocking on YouTube!
    if (!wantYoutubeSync && best.syncedLyrics && durDiff <= 8.0) {
      const fastResult = {
        syncedLyrics: best.syncedLyrics,
        plainLyrics: best.plainLyrics,
        trackName: best.trackName,
        artistName: best.artistName,
        duration: duration || best.duration,
      };
      lyricsMemoryCache.set(cacheKey, fastResult);
      return fastResult;
    }

    // Precision YouTube srv3 Word-Stream Alignment (for ?yt=1 upgrade, Music Videos with >8s intro diff, or unsynced lyrics)
    const ytData = await fetchYouTubeSyncData(trackName, artistName, duration, !best.syncedLyrics && !best.plainLyrics);
    const ytWords = ytData?.ytWords || [];
    const ytEvents = ytData?.ytEvents || [];
    const ytmPlainLyrics = ytData?.ytmPlainLyrics || null;

    let finalSynced = best.syncedLyrics;
    const finalPlain = best.plainLyrics || ytmPlainLyrics;

    if (finalSynced && ytWords.length >= 6) {
      finalSynced = alignLrcWithYouTubeWordStream(finalSynced, ytWords);
    } else if (!finalSynced && finalPlain && ytWords.length >= 6) {
      finalSynced =
        alignPlainLyricsWithYouTubeWords(finalPlain, ytWords, duration) ||
        convertYouTubeEventsToLrc(ytEvents);
    } else if (!finalSynced && ytEvents.length > 0) {
      finalSynced = convertYouTubeEventsToLrc(ytEvents);
    }

    const result = {
      syncedLyrics: finalSynced,
      plainLyrics: finalPlain,
      trackName: best.trackName,
      artistName: best.artistName,
      duration: duration || best.duration,
    };
    lyricsMemoryCache.set(cacheKey, result);
    return result;
  }

  // 4. Not found in LRCLIB at all -> fetch YouTube ANDROID srv3 captions & YTM official lyrics
  const ytData = await fetchYouTubeSyncData(trackName, artistName, duration, true);
  const ytWords = ytData?.ytWords || [];
  const ytEvents = ytData?.ytEvents || [];
  const ytmPlainLyrics = ytData?.ytmPlainLyrics || null;

  if (ytmPlainLyrics && ytWords.length >= 6) {
    const alignedYtm = alignPlainLyricsWithYouTubeWords(ytmPlainLyrics, ytWords, duration);
    if (alignedYtm) {
      const result = {
        syncedLyrics: alignedYtm,
        plainLyrics: ytmPlainLyrics,
        trackName,
        artistName,
        duration: duration || 180,
      };
      lyricsMemoryCache.set(cacheKey, result);
      return result;
    }
  }

  if (ytEvents.length > 0) {
    const ytLrc = convertYouTubeEventsToLrc(ytEvents);
    if (ytLrc) {
      const result = {
        syncedLyrics: ytLrc,
        plainLyrics: ytmPlainLyrics || ytEvents.map((e) => e.text).join('\n'),
        trackName,
        artistName,
        duration: duration || 180,
      };
      lyricsMemoryCache.set(cacheKey, result);
      return result;
    }
  }

  if (ytmPlainLyrics) {
    const result = {
      syncedLyrics: undefined,
      plainLyrics: ytmPlainLyrics,
      trackName,
      artistName,
      duration: duration || 180,
    };
    lyricsMemoryCache.set(cacheKey, result);
    return result;
  }

  return null;
}

function startEmbeddedBridgeServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (parsedUrl.pathname === '/api/media/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(latestState)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (parsedUrl.pathname === '/api/media') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(latestState));
      return;
    }

    if (parsedUrl.pathname === '/api/lyrics') {
      const track = parsedUrl.searchParams.get('track') || '';
      const artist = parsedUrl.searchParams.get('artist') || '';
      const duration = parseFloat(parsedUrl.searchParams.get('duration') || '0');
      const wantYoutubeSync = parsedUrl.searchParams.get('yt') === '1';

      if (!track) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Missing track parameter' }));
        return;
      }

      const lyrics = await fetchLyricsBackend(track, artist, duration, wantYoutubeSync);
      if (lyrics) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(lyrics));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Lyrics not found' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', () => {
    // Port 4892 already bound by another instance or dev server
  });

  server.listen(4892, () => {
    startDaemon();
  });
}

function createWindow() {
  const iconPath = fs.existsSync(path.join(__dirname, '../dist/icon.ico'))
    ? path.join(__dirname, '../dist/icon.ico')
    : path.join(__dirname, '../public/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 500,
    minHeight: 400,
    backgroundColor: '#050507',
    title: 'Lyricfy',
    icon: iconPath,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return false;
  const isTop = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(!isTop);
  return !isTop;
});

ipcMain.handle('set-window-mode', (_event, mode) => {
  if (!mainWindow) return;
  if (mode === 'fullscreen') {
    mainWindow.setFullScreen(true);
  } else if (mode === 'widget') {
    mainWindow.setFullScreen(false);
    mainWindow.setSize(480, 520);
    mainWindow.setAlwaysOnTop(true);
  } else {
    mainWindow.setFullScreen(false);
    mainWindow.setSize(1280, 820);
    mainWindow.setAlwaysOnTop(false);
  }
});

app.whenReady().then(() => {
  startEmbeddedBridgeServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  isShuttingDown = true;
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  if (daemonChild) {
    try {
      daemonChild.kill();
    } catch {}
    daemonChild = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
