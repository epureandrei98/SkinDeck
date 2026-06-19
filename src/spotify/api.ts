import type { PlaybackState, SpotifyPlaylist, SpotifyTrackSearchResult, StoredTokens } from '../shared/types';

const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SCOPES = [
  'streaming',
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-email',
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative'
];

export type SpotifyConfig = {
  clientId: string;
  redirectUri: string;
};

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

export function buildAuthUrl(config: SpotifyConfig, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    scope: SCOPES.join(' '),
    redirect_uri: config.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(
  config: SpotifyConfig,
  code: string,
  verifier: string
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier
  });

  return requestToken(body);
}

export async function refreshAccessToken(config: SpotifyConfig, refreshToken: string): Promise<StoredTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const next = await requestToken(body);
  return {
    ...next,
    refreshToken: next.refreshToken ?? refreshToken
  };
}

export async function getPlayback(accessToken: string): Promise<PlaybackState | null> {
  const response = await apiFetch('/me/player', accessToken);

  if (response.status === 204) return null;
  const data = await response.json();
  const item = data.item;

  if (!item || item.type !== 'track') return null;

  const largestImage = [...(item.album.images ?? [])].sort((a, b) => b.width - a.width)[0];

  return {
    isPlaying: Boolean(data.is_playing),
    title: item.name ?? '',
    artists: (item.artists ?? []).map((artist: { name: string }) => artist.name),
    album: item.album?.name ?? '',
    albumArtUrl: largestImage?.url ?? '',
    progressMs: data.progress_ms ?? 0,
    durationMs: item.duration_ms ?? 0,
    deviceName: data.device?.name
  };
}

export async function play(accessToken: string): Promise<void> {
  await apiFetch('/me/player/play', accessToken, { method: 'PUT' });
}

export async function playUris(
  accessToken: string,
  uris: string[],
  deviceId?: string,
  offsetPosition = 0,
  contextUri?: string
): Promise<void> {
  const params = deviceId ? `?${new URLSearchParams({ device_id: deviceId }).toString()}` : '';
  const offset = Math.max(0, Math.min(offsetPosition, uris.length - 1));
  const body = contextUri
    ? {
        context_uri: contextUri,
        offset: { uri: uris[offset] },
        position_ms: 0
      }
    : {
        uris,
        offset: { position: offset }
      };

  await apiFetch(`/me/player/play${params}`, accessToken, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export async function playContext(accessToken: string, contextUri: string, deviceId?: string): Promise<void> {
  const params = deviceId ? `?${new URLSearchParams({ device_id: deviceId }).toString()}` : '';
  await apiFetch(`/me/player/play${params}`, accessToken, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ context_uri: contextUri })
  });
}

export async function pause(accessToken: string): Promise<void> {
  await apiFetch('/me/player/pause', accessToken, { method: 'PUT' });
}

export async function next(accessToken: string): Promise<void> {
  await apiFetch('/me/player/next', accessToken, { method: 'POST' });
}

export async function previous(accessToken: string): Promise<void> {
  await apiFetch('/me/player/previous', accessToken, { method: 'POST' });
}

export async function seek(accessToken: string, positionMs: number): Promise<void> {
  const params = new URLSearchParams({ position_ms: String(Math.max(0, Math.floor(positionMs))) });
  await apiFetch(`/me/player/seek?${params.toString()}`, accessToken, { method: 'PUT' });
}

export async function transferPlayback(accessToken: string, deviceId: string, shouldPlay = true): Promise<void> {
  await apiFetch('/me/player', accessToken, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      device_ids: [deviceId],
      play: shouldPlay
    })
  });
}

export async function searchTracks(accessToken: string, query: string): Promise<SpotifyTrackSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: '4'
  });
  const response = await apiFetch(`/search?${params.toString()}`, accessToken);
  const data = await response.json();

  return (data.tracks?.items ?? []).map((track: any) => ({
    id: track.id,
    uri: track.uri,
    title: track.name,
    artists: (track.artists ?? []).map((artist: { name: string }) => artist.name),
    album: track.album?.name ?? '',
    durationMs: track.duration_ms ?? 0
  }));
}

export async function getUserPlaylists(accessToken: string): Promise<SpotifyPlaylist[]> {
  const response = await apiFetch('/me/playlists?limit=20', accessToken);
  const data = await response.json();

  return (data.items ?? []).map((playlist: any) => ({
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.tracks?.total ?? 0
  }));
}

export async function getPlaylistTracks(accessToken: string, playlistId: string): Promise<SpotifyTrackSearchResult[]> {
  const response = await apiFetch(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50`, accessToken);
  const data = await response.json();

  return (data.items ?? [])
    .map((item: any) => item.track)
    .filter((track: any) => track?.type === 'track' && track.uri && !track.is_local && track.is_playable !== false)
    .map((track: any) => ({
      id: track.id,
      uri: track.uri,
      title: track.name,
      artists: (track.artists ?? []).map((artist: { name: string }) => artist.name),
      album: track.album?.name ?? '',
      durationMs: track.duration_ms ?? 0,
      isPlayable: track.is_playable !== false
    }));
}

async function requestToken(body: URLSearchParams): Promise<StoredTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    throw new SpotifyApiError('Spotify authorization failed.', response.status);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000
  };
}

async function apiFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers
    }
  });

  if (!response.ok) {
    const message = await getFriendlyError(response);
    throw new SpotifyApiError(message, response.status);
  }

  return response;
}

async function getFriendlyError(response: Response): Promise<string> {
  const status = response.status;
  let spotifyMessage = '';

  try {
    const data = await response.clone().json();
    spotifyMessage = data.error?.message ? ` ${data.error.message}` : '';
  } catch {
    // Spotify sometimes returns an empty body for playback errors.
  }

  if (status === 401) return 'Your Spotify session expired. Please reconnect.';
  if (status === 403) {
    return spotifyMessage
      ? `Spotify blocked this action.${spotifyMessage}`
      : 'Spotify blocked this action. Reconnect Spotify so SkinDeck can request the latest permissions.';
  }
  if (status === 404) return `No active Spotify device was found.${spotifyMessage}`;
  if (status === 429) return 'Spotify rate-limited requests. Waiting before trying again.';
  return `Spotify returned an unexpected error.${spotifyMessage}`;
}
