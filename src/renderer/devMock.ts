import type { AppPreferences, StoredTokens } from '../shared/types';

const preferenceKey = 'skindeck:preferences';
const tokenKey = 'skindeck:tokens';
const skinSizes: Record<string, { width: number; height: number }> = {
  minimal: { width: 320, height: 120 },
  'winamp-retro': { width: 275, height: 348 }
};

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
      setAlwaysOnTop: (enabled) => setTauriAlwaysOnTop(enabled),
      setSizeForSkin: (skinId) => setTauriSizeForSkin(skinId)
    },
    runtime: {
      diagnostics: async () => ({
        versions: { chrome: getChromeVersionFromUserAgent() },
        runtime: isTauriRuntime() ? 'tauri-webview2' : 'browser',
        widevine: await getBrowserWidevineDiagnostic()
      })
    }
  };
}

function isTauriRuntime(): boolean {
  return Boolean('__TAURI_INTERNALS__' in window);
}

async function setTauriAlwaysOnTop(enabled: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setAlwaysOnTop(enabled);
  } catch (caught) {
    console.debug('Native always-on-top update skipped.', caught);
    // Plain browser dev mode has no native window to update.
  }
}

async function setTauriSizeForSkin(skinId: string): Promise<void> {
  const size = skinSizes[skinId] ?? skinSizes.minimal;

  try {
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    await appWindow.setMinSize(new LogicalSize(size.width, size.height));
    await appWindow.setSize(new LogicalSize(size.width, size.height));
  } catch (caught) {
    console.debug(`Native window resize skipped for skin "${skinId}".`, caught);
    // Plain browser dev mode has no native window to update.
  }
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
