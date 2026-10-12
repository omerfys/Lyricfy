import http from 'http';
import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const daemonScriptPath = path.join(__dirname, 'live-daemon.ps1');

let latestState = {
  status: 'ok',
  sessions: [],
  lastUpdated: Date.now(),
};

const sseClients = new Set();
const lyricsMemoryCache = new Map();

let daemonChild = null;
let isShuttingDown = false;

function startDaemon() {
  if (isShuttingDown) return;
  console.log('[MediaBridge] Starting persistent WinRT GSMTC daemon...');

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
      const parsed = JSON.parse(trimmed);
      const sessions = Array.isArray(parsed) ? parsed : (parsed.sessions || [parsed]);

      latestState = {
        status: 'ok',
        sessions,
        lastUpdated: Date.now(),
      };

      // Broadcast to active SSE streams immediately
      const payload = `data: ${JSON.stringify(latestState)}\n\n`;
      for (const res of sseClients) {
        res.write(payload);
      }
    } catch {
      // ignore
    }
  });

  child.on('close', (code) => {
    if (isShuttingDown) return;
    console.warn(`[MediaBridge] Daemon exited with code ${code}. Restarting in 1s...`);
    setTimeout(startDaemon, 1000);
  });

  child.on('error', (err) => {
    if (isShuttingDown) return;
    console.error('[MediaBridge] Daemon process error:', err);
    setTimeout(startDaemon, 2000);
  });
}

function cleanupDaemon() {
  isShuttingDown = true;
  if (daemonChild) {
    try {
      daemonChild.kill();
    } catch {}
    daemonChild = null;
  }
}

process.on('exit', cleanupDaemon);
process.on('SIGINT', () => { cleanupDaemon(); process.exit(0); });
process.on('SIGTERM', () => { cleanupDaemon(); process.exit(0); });

startDaemon();

/**
 * Normalizes Turkish & accented characters for accurate fuzzy comparison
 */
function normalizeText(str) {
  return (str || '')
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
    .trim();

  if (!cleaned || normalizeText(cleaned) === 'bilinmeyen sanatci') return [];

  return cleaned
    .split(/[,&;/+]|\b(?:feat|ft|with|prod)\b\.?/i)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
}

// Smart candidate extraction for YouTube / Spotify titles
function getCandidates(rawTitle, rawArtist) {
  const cleaned = (rawTitle || '')
    .replace(/\((?:Sözleri|Lyrics|Official\s*(?:Music\s*)?Video|Audio|Visualizer|Lyric\s*Video|HD|4K|Clip\s*Officiel|Cover|Acoustic|Live|Remix|Slowed|Reverb|Remastered|Official)\)/gi, '')
    .replace(/\[(?:Sözleri|Lyrics|Official\s*(?:Music\s*)?Video|Audio|Visualizer|Lyric\s*Video|HD|4K|Clip\s*Officiel|Cover|Acoustic|Live|Remix|Slowed|Reverb|Remastered|Official)\]/gi, '')
    .replace(/\s*-\s*(?:Official\s*Audio|Official\s*Video|Lyrics|Sözleri)/gi, '')
    .trim();

  const artistTokens = extractArtistTokens(rawArtist);
  const primaryArtist = artistTokens[0] || rawArtist || '';

  const list = [];

  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    const left = parts[0].trim();
    const right = parts.slice(1).join(' - ').trim();
    list.push({ track: right, artist: left });
    list.push({ track: left, artist: right });
    if (primaryArtist) list.push({ track: right, artist: primaryArtist });
  }

  if (rawArtist && rawArtist.trim()) {
    list.push({ track: cleaned, artist: rawArtist.trim() });
  }
  if (primaryArtist && primaryArtist !== rawArtist.trim()) {
    list.push({ track: cleaned, artist: primaryArtist });
  }
  if (artistTokens.length > 1) {
    list.push({ track: cleaned, artist: artistTokens[1] });
  }

  return list;
}

function scoreLrcItem(item, targetDuration, targetTrack, originalArtist) {
  if (!item || (!item.syncedLyrics && !item.plainLyrics)) return -999;

  const itemTrackNorm = normalizeText(item.trackName);
  const itemArtistNorm = normalizeText(item.artistName);
  const wantTrackNorm = normalizeText(targetTrack);
  const artistTokens = extractArtistTokens(originalArtist).map(normalizeText).filter(Boolean);

  // Check track title similarity
  const trackMatches =
    wantTrackNorm &&
    (itemTrackNorm === wantTrackNorm ||
      itemTrackNorm.includes(wantTrackNorm) ||
      wantTrackNorm.includes(itemTrackNorm));

  if (!trackMatches) return -999;

  // Check artist match against any extracted artist token
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

  // STRICT ANTI-WRONG-SONG GUARD:
  // If we know the artist, and this LRC entry is by a DIFFERENT artist,
  // reject it unless the duration is an exact match (<= 2.5s, e.g. YouTube channel upload)
  if (artistTokens.length > 0 && !artistMatched) {
    if (durDiff > 2.5) {
      return -999;
    }
  }

  // Also reject if duration is wildly different (> 25s off) even for same artist (e.g. 60s snippet vs 240s full track)
  if (targetDuration > 15 && item.duration > 15 && durDiff > 25) {
    return -999;
  }

  let score = 0;

  if (item.syncedLyrics) {
    score += 200;
    if (/<\d{2}:\d{2}(?:\.\d{2,3})?>/.test(item.syncedLyrics)) {
      score += 55;
    }
  } else {
    score += 20;
  }

  if (artistMatched) {
    score += 100;
  }

  if (itemTrackNorm === wantTrackNorm) {
    score += 40;
  } else {
    score += 15;
  }

  if (durDiff <= 1.5) score += 80;
  else if (durDiff <= 3.0) score += 55;
  else if (durDiff <= 6.0) score += 25;
  else if (durDiff <= 12.0) score += 5;
  else if (durDiff < 999) score -= durDiff * 3;

  return score;
}

function formatLrcTimestamp(sec) {
  const clamped = Math.max(0, sec);
  const mm = Math.floor(clamped / 60).toString().padStart(2, '0');
  const ss = (clamped % 60).toFixed(2).padStart(5, '0');
  return `${mm}:${ss}`;
}

function shiftLrcTimestamps(lrcText, offsetSec) {
  if (!lrcText || Math.abs(offsetSec) < 0.3) return lrcText;
  return lrcText
    .replace(/\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\]/g, (_m, mm, ss) => {
      const t = parseInt(mm, 10) * 60 + parseFloat(ss) + offsetSec;
      return `[${formatLrcTimestamp(t)}]`;
    })
    .replace(/<(\d{2}):(\d{2}(?:\.\d{2,3})?)>/g, (_m, mm, ss) => {
      const t = parseInt(mm, 10) * 60 + parseFloat(ss) + offsetSec;
      return `<${formatLrcTimestamp(t)}>`;
    });
}

async function fetchYouTubeTranscriptEvents(trackName, artistName, targetDuration) {
  try {
    const cleanArtist = (artistName || '')
      .replace(/bilinmeyen\s*sanat[cç][ıi]|unknown|youtube|music|- topic/gi, '')
      .trim();
    const query = `${trackName} ${cleanArtist}`.trim();
    if (!query) return null;

    const searchHtmlRes = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      }
    );
    if (!searchHtmlRes.ok) return null;
    const html = await searchHtmlRes.text();

    const videoRegex = /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})".*?"lengthText":\{(?:"accessibility":\{[^}]+\},)?"simpleText":"(\d+:\d+(?::\d+)?)"\}/g;
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
      if (matches.length >= 8) break;
    }

    if (matches.length === 0) return null;

    if (targetDuration && targetDuration > 15) {
      matches.sort(
        (a, b) => Math.abs(a.duration - targetDuration) - Math.abs(b.duration - targetDuration)
      );
    }

    const bestVideo = matches[0];
    if (targetDuration > 15 && Math.abs(bestVideo.duration - targetDuration) > 20) {
      return null;
    }

    const watchRes = await fetch(`https://www.youtube.com/watch?v=${bestVideo.videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (!watchRes.ok) return null;
    const watchHtml = await watchRes.text();

    const captionsMatch = watchHtml.match(/"captionTracks":(\[.*?\])/);
    if (!captionsMatch) return null;

    const captionTracks = JSON.parse(captionsMatch[1]);
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) return null;

    captionTracks.sort((a, b) => {
      const aManual = a.kind !== 'asr' ? 1 : 0;
      const bManual = b.kind !== 'asr' ? 1 : 0;
      if (aManual !== bManual) return bManual - aManual;
      const aTr = (a.languageCode || '').startsWith('tr') ? 1 : 0;
      const bTr = (b.languageCode || '').startsWith('tr') ? 1 : 0;
      return bTr - aTr;
    });

    const chosenTrack = captionTracks[0];
    if (!chosenTrack || !chosenTrack.baseUrl) return null;

    const timedTextRes = await fetch(`${chosenTrack.baseUrl}&fmt=json3`);
    if (!timedTextRes.ok) return null;
    const timedData = await timedTextRes.json();
    if (!timedData || !Array.isArray(timedData.events)) return null;

    const parsedEvents = [];
    for (const ev of timedData.events) {
      if (!ev.segs || !Array.isArray(ev.segs)) continue;
      const startSec = (ev.tStartMs || 0) / 1000;
      const rawText = ev.segs
        .map((s) => s.utf8 || '')
        .join('')
        .replace(/\n+/g, ' ')
        .replace(/\[.*?\]|\(.*?\)|♪+|♫+/g, '')
        .trim();
      if (!rawText || rawText.length < 2) continue;

      const segWords = [];
      for (const s of ev.segs) {
        const wText = (s.utf8 || '').replace(/\n+/g, ' ').replace(/\[.*?\]|♪+|♫+/g, '').trim();
        if (!wText) continue;
        const wTime = ((ev.tStartMs || 0) + (s.tOffsetMs || 0)) / 1000;
        segWords.push({ time: wTime, text: wText });
      }

      parsedEvents.push({
        startSec,
        text: rawText,
        normTokens: normalizeText(rawText).split(' ').filter((t) => t.length >= 2),
        segWords,
      });
    }

    return parsedEvents.length >= 3 ? parsedEvents : null;
  } catch {
    return null;
  }
}

function alignLrcWithYouTubeEvents(syncedLyrics, ytEvents) {
  if (!syncedLyrics || !ytEvents || ytEvents.length === 0) return syncedLyrics;

  const lrcLines = [];
  const regex = /\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\]([^\n]+)/g;
  let m;
  while ((m = regex.exec(syncedLyrics)) !== null) {
    const startSec = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    const cleanLine = m[3].replace(/<\d{2}:\d{2}(?:\.\d{2,3})?>/g, '').trim();
    const normTokens = normalizeText(cleanLine).split(' ').filter((t) => t.length >= 2);
    if (normTokens.length >= 2) {
      lrcLines.push({ startSec, normTokens });
    }
  }

  if (lrcLines.length === 0) return syncedLyrics;

  const offsets = [];
  for (const lrc of lrcLines) {
    for (const yt of ytEvents) {
      if (Math.abs(yt.startSec - lrc.startSec) > 35) continue;
      const shared = lrc.normTokens.filter((t) => yt.normTokens.includes(t));
      const minLen = Math.min(lrc.normTokens.length, yt.normTokens.length);
      if (shared.length >= 2 || (minLen >= 2 && shared.length / minLen >= 0.6)) {
        offsets.push(yt.startSec - lrc.startSec);
        break;
      }
    }
  }

  if (offsets.length < 2) return syncedLyrics;
  offsets.sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const medianOffset =
    offsets.length % 2 !== 0 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;

  if (Math.abs(medianOffset) >= 0.35 && Math.abs(medianOffset) <= 35) {
    return shiftLrcTimestamps(syncedLyrics, medianOffset);
  }
  return syncedLyrics;
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

async function fetchLyricsBackend(trackName, artistName, duration) {
  const roundedDur = Math.round(duration || 0);
  const cacheKey = `${trackName}__${artistName}__${roundedDur}`.toLowerCase();
  if (lyricsMemoryCache.has(cacheKey)) {
    return lyricsMemoryCache.get(cacheKey);
  }

  const candidates = getCandidates(trackName, artistName);
  const collected = [];

  const ytEventsPromise = fetchYouTubeTranscriptEvents(trackName, artistName, duration);

  for (const cand of candidates) {
    try {
      let searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cand.track)}`;
      if (cand.artist && cand.artist.trim()) {
        searchUrl += `&artist_name=${encodeURIComponent(cand.artist.trim())}`;
      }
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'LyricfyApp/1.0.0 (https://github.com/lyricfy)' },
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          for (const it of list) {
            const sc = scoreLrcItem(it, duration, cand.track, cand.artist || artistName);
            if (sc > 0) {
              collected.push({ item: it, score: sc });
            }
          }
          if (collected.some(c => c.score >= 360)) break;
        }
      }
    } catch {}
  }

  if (!collected.some(c => c.item.syncedLyrics)) {
    for (const cand of candidates.slice(0, 2)) {
      try {
        const q = `${cand.track} ${cand.artist}`.trim();
        const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
          headers: { 'User-Agent': 'LyricfyApp/1.0.0 (https://github.com/lyricfy)' },
        });
        if (searchRes.ok) {
          const items = await searchRes.json();
          if (Array.isArray(items)) {
            for (const it of items) {
              const sc = scoreLrcItem(it, duration, cand.track, cand.artist || artistName);
              if (sc > 0) {
                collected.push({ item: it, score: sc });
              }
            }
          }
        }
      } catch {}
    }
  }

  const ytEvents = await ytEventsPromise;

  if (collected.length > 0) {
    collected.sort((a, b) => b.score - a.score);
    const best = collected[0].item;
    let finalSynced = best.syncedLyrics;

    if (finalSynced && ytEvents) {
      finalSynced = alignLrcWithYouTubeEvents(finalSynced, ytEvents);
    } else if (!finalSynced && ytEvents) {
      finalSynced = convertYouTubeEventsToLrc(ytEvents);
    }

    const result = {
      syncedLyrics: finalSynced,
      plainLyrics: best.plainLyrics,
      trackName: best.trackName,
      artistName: best.artistName,
      duration: duration || best.duration,
    };
    lyricsMemoryCache.set(cacheKey, result);
    return result;
  }

  if (ytEvents && ytEvents.length > 0) {
    const ytLrc = convertYouTubeEventsToLrc(ytEvents);
    if (ytLrc) {
      const result = {
        syncedLyrics: ytLrc,
        plainLyrics: ytEvents.map((e) => e.text).join('\n'),
        trackName,
        artistName,
        duration: duration || 180,
      };
      lyricsMemoryCache.set(cacheKey, result);
      return result;
    }
  }

  return null;
}

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

  // Server-Sent Events (Zero-latency push stream)
  if (parsedUrl.pathname === '/api/media/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    res.write(`data: ${JSON.stringify(latestState)}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Instant In-Memory JSON Media Session
  if (parsedUrl.pathname === '/api/media') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(latestState));
    return;
  }

  // High-reliability lyrics endpoint
  if (parsedUrl.pathname === '/api/lyrics') {
    const track = parsedUrl.searchParams.get('track') || '';
    const artist = parsedUrl.searchParams.get('artist') || '';
    const duration = parseFloat(parsedUrl.searchParams.get('duration') || '0');

    if (!track) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing track parameter' }));
      return;
    }

    const lyrics = await fetchLyricsBackend(track, artist, duration);
    if (lyrics) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lyrics));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Lyrics not found' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = 4892;
server.listen(PORT, () => {
  console.log(`[MediaBridge] Media & Lyrics Bridge running on http://localhost:${PORT}`);
});
