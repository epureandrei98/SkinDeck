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

export type AudioOutputLevels = {
  peak: number;
  bands: number[];
};

export type PlaybackControls = {
  togglePlayPause(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  activateSkinDeckPlayback(): Promise<void>;
  searchTracks(query: string): Promise<SpotifyTrackSearchResult[]>;
  getPlaylists(): Promise<SpotifyPlaylist[]>;
  getPlaylistTracks(playlistId: string): Promise<SpotifyTrackSearchResult[]>;
  playPlaylist(playlistId: string): Promise<void>;
  playTrack(uri: string, queueUris?: string[], contextUri?: string): Promise<void>;
};

export type SpotifyTrackSearchResult = {
  id: string;
  uri: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  isPlayable?: boolean;
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  trackCount: number;
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
  runtime?: string;
  widevine?: {
    path: string;
    version: string;
  };
  versions: {
    chrome?: string;
  };
};

export type SkinDeckApi = {
  auth: {
    start(authUrl: string, redirectUri: string): Promise<string>;
  };
  tokens: {
    get(): Promise<StoredTokens | null>;
    set(tokens: StoredTokens): Promise<void>;
    clear(): Promise<void>;
  };
  preferences: {
    get(): Promise<AppPreferences>;
    set(preferences: Partial<AppPreferences>): Promise<AppPreferences>;
  };
  window: {
    setAlwaysOnTop(enabled: boolean): Promise<void>;
    setSizeForSkin(skinId: string): Promise<void>;
  };
  runtime: {
    diagnostics(): Promise<RuntimeDiagnostics>;
  };
};
