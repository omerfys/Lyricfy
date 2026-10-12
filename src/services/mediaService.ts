import type { MediaTrack, MediaSourceMode } from '../types';

export interface WindowsMediaSession {
  AppId: string | null;
  Title: string;
  Artist: string;
  Album: string;
  Source?: string; // "spotify" | "youtube" | "other"
  Status: string;  // "Playing" | "Paused" | "Stopped"
  PositionSeconds: number;
  DurationSeconds: number;
  IsCurrent?: boolean;
  LastUpdatedMs?: number;
  ServerTimeMs?: number;
}

export interface MediaBridgeResponse {
  status: string;
  sessions: WindowsMediaSession[];
  lastUpdated: number;
}

/**
 * Searches iTunes API (TR & Global) for high-res album cover art
 */
export async function fetchCoverArt(title: string, artist: string): Promise<string | undefined> {
  try {
    const cleanTitle = title
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/official\s*(music\s*)?video|lyrics?|audio|hd|4k|visualizer|klip/gi, '')
      .trim();

    const rawArtist = artist.replace(/\(.*?\)|\[.*?\]/g, '').split(/[,&]/)[0].trim();
    const isUnknownArtist =
      !rawArtist ||
      /bilinmeyen|unknown|youtube|spotify|music/i.test(rawArtist);

    // If title contains "Artist - Song" and artist is unknown/channel, use the full cleaned title
    const searchTerms = isUnknownArtist
      ? [cleanTitle]
      : [`${cleanTitle} ${rawArtist}`, cleanTitle];

    const endpoints = [
      (q: string) => `https://itunes.apple.com/search?term=${q}&country=TR&entity=song&limit=3`,
      (q: string) => `https://itunes.apple.com/search?term=${q}&entity=song&limit=3`,
    ];

    for (const term of searchTerms) {
      if (!term) continue;
      const encoded = encodeURIComponent(term);
      for (const makeUrl of endpoints) {
        try {
          const res = await fetch(makeUrl(encoded));
          if (!res.ok) continue;
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const artUrl = data.results[0].artworkUrl100?.replace('100x100bb', '600x600bb');
            if (artUrl) return artUrl;
          }
        } catch {
          // try next endpoint
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export interface MediaPollResult {
  activeTrack: MediaTrack | null;
  allSessions: MediaTrack[];
}

/**
 * Parses raw sessions and selects the true active track with zero latency
 */
export function processRawSessions(
  sessions: WindowsMediaSession[],
  sourceMode: MediaSourceMode = 'auto'
): MediaPollResult {
  // Filter out short social clips / invalid sessions
  const valid = sessions.filter(s =>
    s.Title &&
    s.Title.trim() &&
    !s.Title.toLowerCase().includes('instagram') &&
    !s.Title.toLowerCase().includes('tiktok') &&
    (s.DurationSeconds > 10 || s.DurationSeconds === 0)
  );

  const enriched = valid.map(s => {
    let src: MediaTrack['source'] = 'windows';
    const detected = (s.Source || '').toLowerCase();
    const lowerAlbum = (s.Album || '').toLowerCase();
    const lowerApp = (s.AppId || '').toLowerCase();
    const lowerArtist = (s.Artist || '').toLowerCase();

    if (detected === 'spotify' || lowerApp.includes('spotify') || lowerAlbum.includes('spotify')) {
      src = 'spotify';
    } else if (
      detected === 'youtube' ||
      lowerAlbum.includes('youtube') ||
      lowerArtist.includes('youtube') ||
      lowerApp.includes('youtube') ||
      lowerApp.includes('chrome') ||
      lowerApp.includes('msedge') ||
      lowerApp.includes('firefox') ||
      lowerApp.includes('opera') ||
      lowerApp.includes('brave') ||
      lowerApp.includes('vivaldi') ||
      lowerApp.includes('dia') ||
      lowerApp.includes('thebrowsercompany') ||
      lowerApp.includes('arc') ||
      lowerApp.includes('zen') ||
      lowerApp.includes('waterfox') ||
      lowerApp.includes('floorp') ||
      lowerApp.includes('yandex') ||
      lowerApp.includes('whale') ||
      lowerApp.includes('thorium') ||
      lowerApp.includes('chromium') ||
      lowerApp.includes('librewolf')
    ) {
      src = 'youtube';
    }

    const track: MediaTrack = {
      title: s.Title,
      artist: s.Artist || 'Bilinmeyen Sanatçı',
      album: s.Album || '',
      duration: s.DurationSeconds || 180,
      position: s.PositionSeconds || 0,
      isPlaying: s.Status.toLowerCase() === 'playing',
      source: src,
    };

    return {
      track,
      isCurrent: !!s.IsCurrent,
      lastUpdatedMs: s.LastUpdatedMs || 0,
    };
  });

  if (enriched.length === 0) {
    return { activeTrack: null, allSessions: [] };
  }

  let candidates = enriched;
  if (sourceMode === 'spotify') {
    const sp = enriched.filter(e => e.track.source === 'spotify');
    if (sp.length > 0) candidates = sp;
  } else if (sourceMode === 'youtube') {
    const yt = enriched.filter(e => e.track.source === 'youtube');
    if (yt.length > 0) candidates = yt;
  }

  // Sort candidates so Playing > IsCurrent > Most Recently Updated wins
  const sorted = [...candidates].sort((a, b) => {
    if (a.track.isPlaying !== b.track.isPlaying) {
      return a.track.isPlaying ? -1 : 1;
    }
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    return b.lastUpdatedMs - a.lastUpdatedMs;
  });

  return {
    activeTrack: sorted[0].track,
    allSessions: enriched.map(e => e.track),
  };
}

/**
 * Polls local Windows Media bridge once (fast fallback)
 */
export async function pollWindowsMediaSessions(
  sourceMode: MediaSourceMode = 'auto'
): Promise<MediaPollResult> {
  try {
    const res = await fetch('http://localhost:4892/api/media', { cache: 'no-store' });
    if (!res.ok) return { activeTrack: null, allSessions: [] };
    const data: MediaBridgeResponse = await res.json();
    return processRawSessions(data.sessions || [], sourceMode);
  } catch {
    return { activeTrack: null, allSessions: [] };
  }
}

/**
 * Subscribes to real-time Server-Sent Events stream from the Media Bridge (Zero-latency push)
 */
export function subscribeToMediaStream(
  sourceMode: MediaSourceMode,
  onUpdate: (result: MediaPollResult) => void
): () => void {
  try {
    const eventSource = new EventSource('http://localhost:4892/api/media/stream');

    eventSource.onmessage = (event) => {
      try {
        const data: MediaBridgeResponse = JSON.parse(event.data);
        const result = processRawSessions(data.sessions || [], sourceMode);
        onUpdate(result);
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      eventSource.close();
    };
  } catch {
    return () => {};
  }
}
