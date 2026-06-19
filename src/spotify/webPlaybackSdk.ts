import type { PlaybackState } from '../shared/types';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

export type WebPlaybackTrack = {
  id: string | null;
  uri?: string;
  name: string;
  album: {
    name: string;
    images: Array<{ url: string }>;
  };
  artists: Array<{ name: string }>;
};

export type WebPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: WebPlaybackTrack;
    previous_tracks: WebPlaybackTrack[];
    next_tracks: WebPlaybackTrack[];
  };
};

export type WebPlaybackPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: 'ready' | 'not_ready', callback: (payload: { device_id: string }) => void): boolean;
  addListener(event: 'player_state_changed', callback: (state: WebPlaybackState | null) => void): boolean;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    callback: (payload: { message?: string; reason?: string; [key: string]: unknown }) => void
  ): boolean;
  addListener(event: 'autoplay_failed', callback: () => void): boolean;
  getCurrentState(): Promise<WebPlaybackState | null>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
  activateElement(): Promise<void>;
};

type SpotifyNamespace = {
  Player: new (options: {
    name: string;
    getOAuthToken(callback: (token: string) => void): void;
    volume?: number;
    enableMediaSession?: boolean;
  }) => WebPlaybackPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<SpotifyNamespace> | null = null;

export function loadWebPlaybackSdk(): Promise<SpotifyNamespace> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) {
        resolve(window.Spotify);
      } else {
        reject(new Error('Spotify Web Playback SDK did not initialize.'));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existingScript) return;

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Could not load the Spotify Web Playback SDK.'));
    document.body.append(script);
  });

  return sdkPromise;
}

export function mapSdkStateToPlayback(
  state: WebPlaybackState,
  deviceName: string,
  deviceId: string,
  volume?: number
): PlaybackState {
  const track = state.track_window.current_track;
  const largestImage = track.album.images[0];

  return {
    isPlaying: !state.paused,
    title: track.name ?? '',
    uri: track.uri,
    artists: (track.artists ?? []).map((artist) => artist.name),
    album: track.album?.name ?? '',
    albumArtUrl: largestImage?.url ?? '',
    progressMs: state.position ?? 0,
    durationMs: state.duration ?? 0,
    deviceName,
    volume,
    sdkDeviceId: deviceId,
    isSdkReady: true
  };
}

export async function assertWidevineAvailable(): Promise<void> {
  if (!navigator.requestMediaKeySystemAccess) {
    throw new Error('Widevine check failed: this runtime does not expose Encrypted Media Extensions.');
  }

  await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
    {
      initDataTypes: ['cenc'],
      audioCapabilities: [
        {
          contentType: 'audio/mp4; codecs="mp4a.40.2"'
        }
      ]
    }
  ]);
}
