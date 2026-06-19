export type PlaybackState = {
  isPlaying: boolean;
  title: string;
  artists: string[];
  album: string;
  albumArtUrl: string;
  progressMs: number;
  durationMs: number;
  deviceName?: string;
  volume?: number;
  sdkDeviceId?: string;
  isSdkReady?: boolean;
};

export type PlaybackControls = {
  togglePlayPause(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  activateSkinDeckPlayback(): Promise<void>;
  searchTracks(query: string): Promise<SpotifyTrackSearchResult[]>;
  playTrack(uri: string): Promise<void>;
};

export type SpotifyTrackSearchResult = {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
};

export type StoredTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export type AppPreferences = {
  selectedSkinId: string;
  alwaysOnTop: boolean;
  bounds?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
};

export type SkinManifest = {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
};

export type RuntimeDiagnostics = {
  castlabsComponents?: unknown;
  castlabsWhenReady?: unknown;
  castlabsComponentIds?: string[];
  widevine?: {
    path: string;
    version: string;
  };
  versions: {
    electron?: string;
    chrome?: string;
    node?: string;
  };
};
