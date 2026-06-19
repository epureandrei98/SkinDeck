import electron from 'electron';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppStore } from './store';
import type { AppPreferences, RuntimeDiagnostics } from '../shared/types';
import type { BrowserWindow as BrowserWindowType } from 'electron';

type ElectronWithCastlabsComponents = typeof import('electron') & {
  components?: {
    whenReady(required?: string[]): Promise<unknown>;
    status(): unknown;
    readonly MEDIA_FOUNDATION_WIDEVINE_CDM_ID?: string;
    readonly WIDEVINE_CDM_ID?: string;
  };
};

const electronRuntime = electron as ElectronWithCastlabsComponents;
const { BrowserWindow, app, ipcMain, safeStorage, shell } = electronRuntime;
const { components } = electronRuntime;

const store = new AppStore(app.getPath('userData'), safeStorage);
let mainWindow: BrowserWindowType | null = null;
let runtimeDiagnostics: RuntimeDiagnostics = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
};

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

const gpuMode = process.env.SKINDECK_ENABLE_GPU === '1' ? 'on' : (process.env.SKINDECK_GPU_MODE ?? 'compositing-only');
if (gpuMode === 'off') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else if (gpuMode !== 'on') {
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!components) {
  app.commandLine.appendSwitch('enable-widevine-cdm');
  configureWidevineCdm();
}

function configureWidevineCdm(): void {
  const configuredPath = process.env.WIDEVINE_CDM_PATH;
  const configuredVersion = process.env.WIDEVINE_CDM_VERSION;

  if (configuredPath && configuredVersion && existsSync(configuredPath)) {
    app.commandLine.appendSwitch('widevine-cdm-path', configuredPath);
    app.commandLine.appendSwitch('widevine-cdm-version', configuredVersion);
    console.info(`Using configured Widevine CDM ${configuredVersion}: ${configuredPath}`);
    runtimeDiagnostics = {
      ...runtimeDiagnostics,
      widevine: { path: configuredPath, version: configuredVersion }
    };
    return;
  }

  const detected = detectWidevineCdm();
  if (!detected) return;

  app.commandLine.appendSwitch('widevine-cdm-path', detected.path);
  app.commandLine.appendSwitch('widevine-cdm-version', detected.version);
  console.info(`Detected Widevine CDM ${detected.version}: ${detected.path}`);
  runtimeDiagnostics = {
    ...runtimeDiagnostics,
    widevine: detected
  };
}

function detectWidevineCdm(): { path: string; version: string } | null {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];

  const userDataCandidates = localAppData ? [
    join(localAppData, 'Google', 'Chrome', 'User Data', 'WidevineCdm'),
    join(localAppData, 'Microsoft', 'Edge', 'User Data', 'WidevineCdm'),
    join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'WidevineCdm')
  ] : [];

  for (const basePath of userDataCandidates) {
    const detected = detectWidevineFromBasePath(basePath);
    if (detected) return detected;
  }

  const appCandidates = [
    programFiles ? join(programFiles, 'Google', 'Chrome', 'Application') : null,
    programFilesX86 ? join(programFilesX86, 'Google', 'Chrome', 'Application') : null,
    programFiles ? join(programFiles, 'Microsoft', 'Edge', 'Application') : null,
    programFilesX86 ? join(programFilesX86, 'Microsoft', 'Edge', 'Application') : null,
    programFiles ? join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application') : null,
    programFilesX86 ? join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application') : null
  ].filter((path): path is string => Boolean(path));

  for (const appPath of appCandidates) {
    const detected = detectWidevineFromApplicationPath(appPath);
    if (detected) return detected;
  }

  return null;
}

function detectWidevineFromBasePath(basePath: string): { path: string; version: string } | null {
  if (!existsSync(basePath)) return null;

  const versions = readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDescending);

  for (const version of versions) {
    const platformPath = join(basePath, version, '_platform_specific', 'win_x64', 'widevinecdm.dll');
    if (existsSync(platformPath)) {
      return { path: platformPath, version: readWidevineVersion(basePath, version) ?? version };
    }
  }

  return null;
}

function detectWidevineFromApplicationPath(appPath: string): { path: string; version: string } | null {
  if (!existsSync(appPath)) return null;

  const versions = readdirSync(appPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionDescending);

  for (const appVersion of versions) {
    const widevinePath = join(appPath, appVersion, 'WidevineCdm');
    const platformPath = join(widevinePath, '_platform_specific', 'win_x64', 'widevinecdm.dll');
    if (existsSync(platformPath)) {
      return { path: platformPath, version: readWidevineManifestVersion(widevinePath) ?? appVersion };
    }
  }

  return null;
}

function readWidevineVersion(basePath: string, version: string): string | null {
  return readWidevineManifestVersion(join(basePath, version));
}

function readWidevineManifestVersion(widevinePath: string): string | null {
  const manifestPath = join(widevinePath, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string };
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

function compareVersionDescending(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const diff = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function getDefaultSizeForSkin(skinId: string): { width: number; height: number } {
  return skinId === 'winamp-retro' ? { width: 275, height: 348 } : { width: 320, height: 120 };
}

function createMainWindow(): void {
  store.load();
  const preferences = store.getPreferences();
  const skinSize = getDefaultSizeForSkin(preferences.selectedSkinId);

  mainWindow = new BrowserWindow({
    width: skinSize.width,
    height: skinSize.height,
    useContentSize: true,
    x: preferences.bounds?.x,
    y: preferences.bounds?.y,
    minWidth: skinSize.width,
    minHeight: skinSize.height,
    frame: false,
    autoHideMenuBar: true,
    alwaysOnTop: preferences.alwaysOnTop,
    title: 'SkinDeck',
    backgroundColor: '#111317',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      backgroundThrottling: false
    }
  });
  mainWindow.setMenu(null);
  mainWindow.setContentSize(skinSize.width, skinSize.height);

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', () => {
    if (!mainWindow) return;
    store.setPreferences({ bounds: mainWindow.getBounds() });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc(): void {
  ipcMain.handle('auth:start', async (_event, args: { authUrl: string; redirectUri: string }) => {
    return new Promise<string>((resolve, reject) => {
      let completed = false;
      const authWindow = new BrowserWindow({
        parent: mainWindow ?? undefined,
        modal: true,
        width: 520,
        height: 720,
        title: 'Connect Spotify',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const finishIfCallback = (url: string): boolean => {
        if (!url.startsWith(args.redirectUri)) return false;
        completed = true;
        const parsed = new URL(url);
        const error = parsed.searchParams.get('error');
        const code = parsed.searchParams.get('code');

        authWindow.close();
        if (error) {
          reject(new Error(error));
          return true;
        }

        if (!code) {
          reject(new Error('Spotify did not return an authorization code.'));
          return true;
        }

        resolve(code);
        return true;
      };

      authWindow.webContents.on('will-redirect', (event, url) => {
        if (finishIfCallback(url)) event.preventDefault();
      });

      authWindow.webContents.on('will-navigate', (event, url) => {
        if (finishIfCallback(url)) event.preventDefault();
      });

      authWindow.on('closed', () => {
        if (!completed) reject(new Error('Spotify authorization was cancelled.'));
      });
      authWindow.loadURL(args.authUrl);
    });
  });

  ipcMain.handle('tokens:get', () => store.getTokens());
  ipcMain.handle('tokens:set', (_event, tokens) => store.setTokens(tokens));
  ipcMain.handle('tokens:clear', () => store.clearTokens());
  ipcMain.handle('preferences:get', () => store.getPreferences());
  ipcMain.handle('preferences:set', (_event, preferences: Partial<AppPreferences>) => {
    const next = store.setPreferences(preferences);
    mainWindow?.setAlwaysOnTop(next.alwaysOnTop);
    return next;
  });
  ipcMain.handle('window:setAlwaysOnTop', (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled);
    store.setPreferences({ alwaysOnTop: enabled });
  });
  ipcMain.handle('window:setSizeForSkin', (_event, skinId: string) => {
    const size = getDefaultSizeForSkin(skinId);
    mainWindow?.setMinimumSize(size.width, size.height);
    mainWindow?.setContentSize(size.width, size.height);
    store.setPreferences({ selectedSkinId: skinId, bounds: size });
  });
  ipcMain.handle('runtime:diagnostics', () => runtimeDiagnostics);
}

app.whenReady().then(async () => {
  if (components) {
    const requiredComponents = [components.WIDEVINE_CDM_ID].filter((id): id is string => Boolean(id));

    try {
      console.info('Waiting for Castlabs components:', requiredComponents);
      const readyResult = await components.whenReady(requiredComponents);
      const status = components.status();
      console.info('Castlabs components ready:', readyResult, status);
      runtimeDiagnostics = {
        ...runtimeDiagnostics,
        castlabsComponentIds: requiredComponents,
        castlabsWhenReady: readyResult,
        castlabsComponents: status
      };
    } catch (caught) {
      const status = components.status();
      console.error('Castlabs components failed:', caught, status);
      runtimeDiagnostics = {
        ...runtimeDiagnostics,
        castlabsComponentIds: requiredComponents,
        castlabsWhenReady: caught instanceof Error ? caught.message : caught,
        castlabsComponents: status
      };
    }
  }

  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
