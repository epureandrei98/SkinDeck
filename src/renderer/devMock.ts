import type { AppPreferences, StoredTokens } from '../shared/types';

const preferenceKey = 'skindeck:preferences';
const tokenKey = 'skindeck:tokens';

export function installDevMockBridge(): void {
  if (window.skindeck) return;

  window.skindeck = {
    auth: {
      start: (authUrl, redirectUri) => startBrowserAuth(authUrl, redirectUri)
    },
    tokens: {
      get: async () => readJson<StoredTokens | null>(tokenKey, null),
      set: async (tokens) => writeJson(tokenKey, tokens),
      clear: async () => localStorage.removeItem(tokenKey)
    },
    preferences: {
      get: async () =>
        readJson<AppPreferences>(preferenceKey, {
          selectedSkinId: 'minimal',
          alwaysOnTop: false
        }),
      set: async (preferences) => {
        const current = readJson<AppPreferences>(preferenceKey, {
          selectedSkinId: 'minimal',
          alwaysOnTop: false
        });
        const next = { ...current, ...preferences };
        writeJson(preferenceKey, next);
        return next;
      }
    },
    window: {
      setAlwaysOnTop: async () => undefined,
      setSizeForSkin: async () => undefined
    },
    runtime: {
      diagnostics: async () => ({
        versions: { chrome: getChromeVersionFromUserAgent() },
        castlabsComponents: 'browser-mode',
        widevine: await getBrowserWidevineDiagnostic()
      })
    }
  };
}

function startBrowserAuth(authUrl: string, redirectUri: string): Promise<string> {
  const authWindow = window.open(authUrl, 'skindeck-spotify-auth', 'width=520,height=720');
  if (!authWindow) {
    return Promise.reject(new Error('Spotify auth popup was blocked. Allow popups for this app and try again.'));
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      authWindow.close();
      reject(new Error('Spotify authorization timed out.'));
    }, 120_000);

    const interval = window.setInterval(() => {
      if (authWindow.closed) {
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        reject(new Error('Spotify authorization was cancelled.'));
        return;
      }

      try {
        const url = authWindow.location.href;
        if (!url.startsWith(redirectUri)) return;

        const parsed = new URL(url);
        const error = parsed.searchParams.get('error');
        const code = parsed.searchParams.get('code');

        window.clearTimeout(timeout);
        window.clearInterval(interval);
        authWindow.close();

        if (error) {
          reject(new Error(error));
          return;
        }

        if (!code) {
          reject(new Error('Spotify did not return an authorization code.'));
          return;
        }

        resolve(code);
      } catch {
        // The Spotify login page is cross-origin until it redirects back to the local app.
      }
    }, 250);
  });
}

function getChromeVersionFromUserAgent(): string | undefined {
  return navigator.userAgent.match(/(?:Chrome|Edg)\/([\d.]+)/)?.[1];
}

async function getBrowserWidevineDiagnostic(): Promise<{ path: string; version: string } | undefined> {
  try {
    await navigator.requestMediaKeySystemAccess?.('com.widevine.alpha', [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
      }
    ]);
    return { path: 'browser-eme', version: 'available' };
  } catch {
    return undefined;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
