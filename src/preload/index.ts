import { contextBridge, ipcRenderer } from 'electron';
import type { AppPreferences, RuntimeDiagnostics, StoredTokens } from '../shared/types';

const api = {
  auth: {
    start: (authUrl: string, redirectUri: string) =>
      ipcRenderer.invoke('auth:start', { authUrl, redirectUri }) as Promise<string>
  },
  tokens: {
    get: () => ipcRenderer.invoke('tokens:get') as Promise<StoredTokens | null>,
    set: (tokens: StoredTokens) => ipcRenderer.invoke('tokens:set', tokens) as Promise<void>,
    clear: () => ipcRenderer.invoke('tokens:clear') as Promise<void>
  },
  preferences: {
    get: () => ipcRenderer.invoke('preferences:get') as Promise<AppPreferences>,
    set: (preferences: Partial<AppPreferences>) =>
      ipcRenderer.invoke('preferences:set', preferences) as Promise<AppPreferences>
  },
  window: {
    setAlwaysOnTop: (enabled: boolean) =>
      ipcRenderer.invoke('window:setAlwaysOnTop', enabled) as Promise<void>,
    setSizeForSkin: (skinId: string) =>
      ipcRenderer.invoke('window:setSizeForSkin', skinId) as Promise<void>
  },
  runtime: {
    diagnostics: () => ipcRenderer.invoke('runtime:diagnostics') as Promise<RuntimeDiagnostics>
  }
};

contextBridge.exposeInMainWorld('skindeck', api);

export type SkinDeckApi = typeof api;
