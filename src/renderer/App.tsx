import { MonitorUp, Power, Settings, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { skinManifests } from '../shared/skins';
import type { AppPreferences } from '../shared/types';
import { useAudioOutputLevels } from './hooks/useAudioOutputLevels';
import { useSpotifyPlayback } from './hooks/useSpotifyPlayback';
import { SkinHost } from './skins/SkinHost';

const defaultPreferences: AppPreferences = {
  selectedSkinId: 'minimal',
  alwaysOnTop: false
};

export function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(defaultPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const spotifyConfig = useMemo(
    () => ({
      clientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '',
      redirectUri: import.meta.env.VITE_SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:5173/callback'
    }),
    []
  );

  const spotify = useSpotifyPlayback(spotifyConfig);
  const audioLevels = useAudioOutputLevels();

  useEffect(() => {
    window.skindeck.preferences.get().then((savedPreferences) => {
      setPreferences(savedPreferences);
      window.skindeck.window.setSizeForSkin(savedPreferences.selectedSkinId);
    });
  }, []);

  async function selectSkin(skinId: string) {
    await window.skindeck.window.setSizeForSkin(skinId);
    const next = await window.skindeck.preferences.set({ selectedSkinId: skinId });
    setPreferences(next);
    setSettingsOpen(false);
  }

  async function toggleAlwaysOnTop() {
    const alwaysOnTop = !preferences.alwaysOnTop;
    await window.skindeck.window.setAlwaysOnTop(alwaysOnTop);
    const next = await window.skindeck.preferences.set({ alwaysOnTop });
    setPreferences(next);
  }

  return (
    <main className="app-shell" data-skin={preferences.selectedSkinId} data-authenticated={spotify.isAuthenticated}>
      <div className="widget-frame">
        <SkinHost
          skinId={preferences.selectedSkinId}
          playback={spotify.playback}
          audioLevels={audioLevels}
          controls={spotify.controls}
          isAuthenticated={spotify.isAuthenticated}
          isConnecting={spotify.isConnecting}
          connect={spotify.connect}
          disconnect={spotify.disconnect}
          settingsOpen={settingsOpen}
          toggleSettings={() => setSettingsOpen((open) => !open)}
        />
      </div>

      <div className="app-toolbar">
        {spotify.isAuthenticated ? (
          <button type="button" className="toolbar-button" onClick={spotify.disconnect} aria-label="Disconnect Spotify">
            <Power size={15} />
          </button>
        ) : (
          <button type="button" className="connect-button" onClick={spotify.connect} disabled={spotify.isConnecting}>
            {spotify.isConnecting ? 'Connecting' : 'Connect Spotify'}
          </button>
        )}

        <button
          type="button"
          className="toolbar-button"
          onClick={toggleAlwaysOnTop}
          aria-label="Toggle always on top"
          data-active={preferences.alwaysOnTop}
        >
          <MonitorUp size={15} />
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-label="Open settings"
          data-active={settingsOpen}
        >
          <Settings size={15} />
        </button>
      </div>

      {settingsOpen && (
        <aside className="settings-panel">
          <label htmlFor="skin-select">Skin</label>
          <select
            id="skin-select"
            value={preferences.selectedSkinId}
            onChange={(event) => selectSkin(event.target.value)}
          >
            {skinManifests.map((skin) => (
              <option key={skin.id} value={skin.id}>
                {skin.name}
              </option>
            ))}
          </select>
          <div className="skin-note">
            <Star size={14} />
            {skinManifests.find((skin) => skin.id === preferences.selectedSkinId)?.description}
          </div>
        </aside>
      )}

      {spotify.error && <div className="status-line" title={spotify.error}>{spotify.error}</div>}
    </main>
  );
}
