import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackControls, PlaybackState, StoredTokens } from '../../shared/types';
import {
  SpotifyApiError,
  buildAuthUrl,
  exchangeCodeForToken,
  playUris,
  refreshAccessToken,
  searchTracks,
  transferPlayback,
  type SpotifyConfig
} from '../../spotify/api';
import { createCodeChallenge, createCodeVerifier } from '../../spotify/pkce';
import {
  assertWidevineAvailable,
  loadWebPlaybackSdk,
  mapSdkStateToPlayback,
  type WebPlaybackPlayer,
  type WebPlaybackState
} from '../../spotify/webPlaybackSdk';

const EMPTY_PLAYBACK: PlaybackState = {
  isPlaying: false,
  title: 'Nothing playing',
  artists: [],
  album: '',
  albumArtUrl: '',
  progressMs: 0,
  durationMs: 0
};

function isNoActivePlaybackError(caught: unknown): boolean {
  return caught instanceof SpotifyApiError && caught.status === 404;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeSdkState(state: WebPlaybackState | null): string {
  if (!state) return 'state=null';
  const track = state.track_window.current_track;
  return [
    `paused=${state.paused}`,
    `position=${state.position}`,
    `duration=${state.duration}`,
    `track=${track?.name ?? 'unknown'}`,
    `uri=${track?.uri ?? track?.id ?? 'unknown'}`
  ].join(', ');
}

export function useSpotifyPlayback(config: SpotifyConfig) {
  const [tokens, setTokens] = useState<StoredTokens | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>(EMPTY_PLAYBACK);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [isLoadingPlayback, setLoadingPlayback] = useState(false);
  const latestPlayback = useRef(playback);
  const tokensRef = useRef<StoredTokens | null>(tokens);
  const playerRef = useRef<WebPlaybackPlayer | null>(null);
  const sdkDeviceIdRef = useRef<string | null>(null);
  const sdkReadyRef = useRef(false);
  const sdkTransferredRef = useRef(false);
  const sdkReadyResolverRef = useRef<((deviceId: string) => void) | null>(null);
  const sdkReadyRejecterRef = useRef<((error: Error) => void) | null>(null);
  const sdkErrorRef = useRef<string | null>(null);
  const widevineDiagnosticRef = useRef<string | null>(null);
  const lastRequestedUriRef = useRef<string | null>(null);
  const lastRecoveryAttemptRef = useRef(0);

  useEffect(() => {
    latestPlayback.current = playback;
  }, [playback]);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    window.skindeck.tokens.get().then(setTokens).catch(() => setError('Could not load saved Spotify tokens.'));
  }, []);

  const saveTokens = useCallback(async (nextTokens: StoredTokens) => {
    await window.skindeck.tokens.set(nextTokens);
    setTokens(nextTokens);
  }, []);

  const ensureAccessTokenFromRef = useCallback(async () => {
    const currentTokens = tokensRef.current;
    if (!currentTokens) throw new SpotifyApiError('Connect Spotify to control playback.');
    if (currentTokens.expiresAt > Date.now()) return currentTokens.accessToken;
    if (!currentTokens.refreshToken) throw new SpotifyApiError('Reconnect Spotify to refresh your session.');

    const refreshed = await refreshAccessToken(config, currentTokens.refreshToken);
    await saveTokens(refreshed);
    return refreshed.accessToken;
  }, [config, saveTokens]);

  const connect = useCallback(async () => {
    if (!config.clientId) {
      setError('Add VITE_SPOTIFY_CLIENT_ID to your .env file, then restart the app.');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const verifier = await createCodeVerifier();
      const challenge = await createCodeChallenge(verifier);
      const authUrl = buildAuthUrl(config, challenge);
      const code = await window.skindeck.auth.start(authUrl, config.redirectUri);
      const nextTokens = await exchangeCodeForToken(config, code, verifier);
      await saveTokens(nextTokens);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Spotify authorization failed.');
    } finally {
      setConnecting(false);
    }
  }, [config, saveTokens]);

  const disconnect = useCallback(async () => {
    playerRef.current?.disconnect();
    playerRef.current = null;
    sdkDeviceIdRef.current = null;
    sdkReadyRef.current = false;
    sdkTransferredRef.current = false;
    sdkReadyResolverRef.current = null;
    sdkReadyRejecterRef.current = null;
    sdkErrorRef.current = null;
    widevineDiagnosticRef.current = null;
    await window.skindeck.tokens.clear();
    setTokens(null);
    setPlayback(EMPTY_PLAYBACK);
  }, []);

  const updateFromSdkState = useCallback(async (state: WebPlaybackState | null) => {
    const deviceId = sdkDeviceIdRef.current;
    if (!state || !deviceId) return;

    try {
      const volume = await playerRef.current?.getVolume();
      setPlayback(mapSdkStateToPlayback(state, 'SkinDeck', deviceId, volume));
    } catch {
      setPlayback(mapSdkStateToPlayback(state, 'SkinDeck', deviceId));
    }
  }, []);

  const activateSkinDeckPlayback = useCallback(async () => {
    const deviceId = sdkDeviceIdRef.current;
    const player = playerRef.current;
    if (!deviceId || !player) {
      throw new SpotifyApiError('SkinDeck playback device is not ready yet.');
    }

    try {
      await player.activateElement();
    } catch {
      // Some desktop environments already consider the player activated.
    }

    const accessToken = await ensureAccessTokenFromRef();
    try {
      await transferPlayback(accessToken, deviceId, true);
      sdkTransferredRef.current = true;
    } catch (caught) {
      if (!isNoActivePlaybackError(caught)) throw caught;
      sdkTransferredRef.current = false;
      setPlayback((current) => ({
        ...current,
        deviceName: 'SkinDeck',
        sdkDeviceId: deviceId,
        isSdkReady: true
      }));
      setError(null);
      return;
    }

    const state = await player.getCurrentState();
    await updateFromSdkState(state);
  }, [ensureAccessTokenFromRef, updateFromSdkState]);

  const waitForSdkDevice = useCallback(async () => {
    if (sdkDeviceIdRef.current && sdkReadyRef.current) return sdkDeviceIdRef.current;
    if (sdkErrorRef.current) throw new SpotifyApiError(sdkErrorRef.current);
    if (!playerRef.current) throw new SpotifyApiError('SkinDeck playback device is still starting.');

    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        sdkReadyResolverRef.current = null;
        sdkReadyRejecterRef.current = null;
        reject(
          new SpotifyApiError(
            'SkinDeck playback device did not become ready. Spotify Web Playback SDK may not be supported in this Electron runtime.'
          )
        );
      }, 8000);

      sdkReadyResolverRef.current = (deviceId) => {
        window.clearTimeout(timeout);
        sdkReadyRejecterRef.current = null;
        resolve(deviceId);
      };
      sdkReadyRejecterRef.current = (error) => {
        window.clearTimeout(timeout);
        sdkReadyResolverRef.current = null;
        reject(error);
      };
    });
  }, []);

  const failSdkStartup = useCallback((message: string) => {
    sdkErrorRef.current = message;
    sdkReadyRejecterRef.current?.(new SpotifyApiError(message));
    sdkReadyRejecterRef.current = null;
    sdkReadyResolverRef.current = null;
    setError(message);
  }, []);

  const handleSdkPlaybackError = useCallback(async (payload: { message?: string; reason?: string; [key: string]: unknown }) => {
    const player = playerRef.current;
    const state = player ? await player.getCurrentState().catch(() => null) : null;
    const diagnostics = await window.skindeck.runtime.diagnostics().catch(() => null);
    const message = payload.message ?? 'Playback error';
    const reason = payload.reason ? ` reason=${payload.reason};` : '';
    const runtime = diagnostics
      ? ` runtime=Electron ${diagnostics.versions.electron ?? 'unknown'} / Chromium ${diagnostics.versions.chrome ?? 'unknown'}; requestedComponents=${compactJson(diagnostics.castlabsComponentIds ?? [])}; whenReady=${compactJson(diagnostics.castlabsWhenReady ?? 'none')}; components=${compactJson(diagnostics.castlabsComponents ?? 'none')};`
      : '';

    const detailedMessage = `SDK playback_error: ${message};${reason} payload=${compactJson(payload)}; ${describeSdkState(state)}; device=${sdkDeviceIdRef.current ?? 'none'};${runtime}`;
    console.error(detailedMessage);
    setPlayback((current) => ({ ...current, isPlaying: false }));
    setError(detailedMessage);
  }, []);

  useEffect(() => {
    if (!tokens || playerRef.current) return;

    let cancelled = false;
    const playerName = 'SkinDeck';

    assertWidevineAvailable().catch(async (caught) => {
      const diagnostics = await window.skindeck.runtime.diagnostics();
      const versionText = `Electron ${diagnostics.versions.electron ?? 'unknown'} / Chromium ${
        diagnostics.versions.chrome ?? 'unknown'
      }`;
      const widevineText = diagnostics.widevine
        ? `Widevine ${diagnostics.widevine.version}`
        : 'no Widevine CDM detected';
      widevineDiagnosticRef.current = `${
        caught instanceof Error ? caught.message : 'Widevine probe failed.'
      } (${versionText}, ${widevineText})`;
    });

    loadWebPlaybackSdk()
      .then((spotifyNamespace) => {
        if (cancelled) return;

        const player = new spotifyNamespace.Player({
          name: playerName,
          enableMediaSession: true,
          volume: latestPlayback.current.volume ?? 0.7,
          getOAuthToken: (callback) => {
            ensureAccessTokenFromRef()
              .then(callback)
              .catch((caught) => setError(caught instanceof Error ? caught.message : 'Spotify token refresh failed.'));
          }
        });

        playerRef.current = player;

        player.addListener('ready', async ({ device_id }) => {
          sdkDeviceIdRef.current = device_id;
          sdkReadyRef.current = true;
          sdkReadyResolverRef.current?.(device_id);
          sdkReadyResolverRef.current = null;
          setPlayback((current) => ({
            ...current,
            deviceName: playerName,
            sdkDeviceId: device_id,
            isSdkReady: true
          }));

          try {
            await activateSkinDeckPlayback();
          } catch (caught) {
            if (isNoActivePlaybackError(caught)) {
              setError(null);
              return;
            }
            setError(caught instanceof Error ? caught.message : 'Could not transfer playback to SkinDeck.');
          }
        });

        player.addListener('not_ready', () => {
          sdkReadyRef.current = false;
          setPlayback((current) => ({ ...current, isSdkReady: false }));
        });

        player.addListener('player_state_changed', updateFromSdkState);
        player.addListener('autoplay_failed', () => {
          failSdkStartup('Click play once in SkinDeck so Spotify can start playback here.');
        });
        player.addListener('initialization_error', ({ message }) =>
          failSdkStartup(
            `${message} ${widevineDiagnosticRef.current ?? 'Spotify Web Playback SDK may not be supported in this Electron runtime.'}`
          )
        );
        player.addListener('authentication_error', async ({ message }) => {
          await window.skindeck.tokens.clear();
          setTokens(null);
          failSdkStartup(`${message} Reconnect Spotify to approve Web Playback SDK access.`);
        });
        player.addListener('account_error', ({ message }) =>
          failSdkStartup(`${message} Spotify Web Playback SDK requires Premium.`)
        );
        player.addListener('playback_error', (payload) => {
          handleSdkPlaybackError(payload);
        });

        player.connect().then((success) => {
          if (!success) failSdkStartup('Spotify Web Playback SDK could not connect.');
        });
      })
      .catch((caught) => failSdkStartup(caught instanceof Error ? caught.message : 'Could not load Spotify playback.'));

    return () => {
      cancelled = true;
    };
  }, [activateSkinDeckPlayback, ensureAccessTokenFromRef, failSdkStartup, handleSdkPlaybackError, tokens, updateFromSdkState]);

  const refreshSdkPlayback = useCallback(async () => {
    if (!tokens) return;

    try {
      setLoadingPlayback(true);
      const player = playerRef.current;
      if (!player || !sdkReadyRef.current) return;

      const sdkState = await player.getCurrentState();
      if (sdkState) {
        await updateFromSdkState(sdkState);
        return;
      }

      setPlayback((current) => ({
        ...current,
        isPlaying: false,
        isSdkReady: sdkReadyRef.current
      }));

      if (lastRequestedUriRef.current && latestPlayback.current.isPlaying) {
        setError('SkinDeck player lost its audio session. Try the track again or start another search result.');
      }
    } catch (caught) {
      if (caught instanceof SpotifyApiError && caught.status === 401) {
        await window.skindeck.tokens.clear();
        setTokens(null);
      }
      setError(caught instanceof Error ? caught.message : 'Could not update playback state.');
    } finally {
      setLoadingPlayback(false);
    }
  }, [tokens, updateFromSdkState]);

  useEffect(() => {
    if (!tokens) return;

    const interval = window.setInterval(async () => {
      const player = playerRef.current;
      const deviceId = sdkDeviceIdRef.current;
      if (!player || !deviceId || !sdkReadyRef.current) return;

      try {
        const sdkState = await player.getCurrentState();
        if (sdkState) {
          await updateFromSdkState(sdkState);
          return;
        }

        if (!lastRequestedUriRef.current || !latestPlayback.current.isPlaying) return;

        const now = Date.now();
        if (now - lastRecoveryAttemptRef.current < 10_000) {
          setPlayback((current) => ({ ...current, isPlaying: false }));
          setError('SkinDeck playback stopped. Click the track again to restart it here.');
          return;
        }

        lastRecoveryAttemptRef.current = now;
        const accessToken = await ensureAccessTokenFromRef();
        await transferPlayback(accessToken, deviceId, false);
        await playUris(accessToken, [lastRequestedUriRef.current], deviceId);
      } catch (caught) {
        setPlayback((current) => ({ ...current, isPlaying: false }));
        setError(caught instanceof Error ? caught.message : 'SkinDeck playback stopped.');
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [ensureAccessTokenFromRef, tokens, updateFromSdkState]);

  const runSdkControl = useCallback(
    async (sdkAction: (player: WebPlaybackPlayer) => Promise<void>) => {
      try {
        const player = playerRef.current;
        if (!player || !sdkReadyRef.current) {
          setError('SkinDeck playback device is not ready yet.');
          return;
        }

        await sdkAction(player);
        await updateFromSdkState(await player.getCurrentState());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Spotify playback control failed.');
      }
    },
    [updateFromSdkState]
  );

  const controls = useMemo<PlaybackControls>(
    () => ({
      togglePlayPause: () =>
        runSdkControl(async (player) => {
          await player.activateElement();
          await player.togglePlay();
        }),
      nextTrack: () => runSdkControl((player) => player.nextTrack()),
      previousTrack: () => runSdkControl((player) => player.previousTrack()),
      seek: (positionMs) => runSdkControl((player) => player.seek(positionMs)),
      setVolume: async (volume) => {
        try {
          const normalizedVolume = Math.min(1, Math.max(0, volume));
          const player = playerRef.current;
          if (!player || !sdkReadyRef.current) {
            setError('Volume is available after playback is transferred to SkinDeck.');
            return;
          }

          await player.setVolume(normalizedVolume);
          setPlayback((current) => ({ ...current, volume: normalizedVolume }));
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not update SkinDeck volume.');
        }
      },
      activateSkinDeckPlayback: async () => {
        try {
          await activateSkinDeckPlayback();
        } catch (caught) {
          if (isNoActivePlaybackError(caught)) {
            setError('Choose a track in Spotify once, then SkinDeck can take over playback.');
            return;
          }
          setError(caught instanceof Error ? caught.message : 'Could not transfer playback to SkinDeck.');
        }
      },
      searchTracks: async (query) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        try {
          const accessToken = await ensureAccessTokenFromRef();
          setError(null);
          return await searchTracks(accessToken, trimmedQuery);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not search Spotify.');
          return [];
        }
      },
      playTrack: async (uri) => {
        try {
          lastRequestedUriRef.current = uri;
          const accessToken = await ensureAccessTokenFromRef();
          const deviceId = await waitForSdkDevice();
          await playerRef.current?.activateElement();
          await playUris(accessToken, [uri], deviceId);
          sdkTransferredRef.current = true;
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          const state = await playerRef.current?.getCurrentState();
          await updateFromSdkState(state ?? null);
          setError(null);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Could not start Spotify track.');
        }
      }
    }),
    [activateSkinDeckPlayback, ensureAccessTokenFromRef, runSdkControl, updateFromSdkState, waitForSdkDevice]
  );

  useEffect(() => {
    refreshSdkPlayback();
    const interval = window.setInterval(refreshSdkPlayback, 1000);
    return () => window.clearInterval(interval);
  }, [refreshSdkPlayback]);

  return {
    playback,
    controls,
    connect,
    disconnect,
    isAuthenticated: Boolean(tokens),
    isConnecting,
    isLoadingPlayback,
    error
  };
}
