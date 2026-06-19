import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react';
import type { SpotifyPlaylist, SpotifyTrackSearchResult } from '../../../shared/types';
import type { SkinProps } from '../SkinProps';
import { formatDuration, progressPercent } from '../../utils/time';

const spectrum = [18, 78, 32, 64, 25, 48, 76, 38, 58, 22, 42, 70, 28, 54, 36, 62, 24, 46];
const eqBands = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const eqValues = [82, 40, 70, 67, 72, 69, 76, 73, 80, 78];

type PlaylistRow = {
  title: string;
  duration: string;
  playlistId?: string;
  uri?: string;
};

type ListMode = 'default' | 'search' | 'playlists' | 'playlist-tracks';

export function WinampRetroSkin({
  playback,
  audioLevels,
  controls,
  isAuthenticated,
  isConnecting,
  connect,
  disconnect,
  settingsOpen,
  toggleSettings
}: SkinProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SpotifyTrackSearchResult[]>([]);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyTrackSearchResult[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<ListMode>('default');
  const [isSearching, setSearching] = useState(false);
  const [isLoadingPlaylists, setLoadingPlaylists] = useState(false);
  const tracklineRef = useRef<HTMLDivElement>(null);
  const tracklineTextRef = useRef<HTMLSpanElement>(null);
  const [tracklineOverflow, setTracklineOverflow] = useState(false);
  const timeText = playback.durationMs ? formatDuration(playback.progressMs) : '00:00';
  const titleText = `${playback.artists[0] ?? 'SKINDECK'} - ${playback.title || 'NO ACTIVE TRACK'}`;
  const currentTitle = `${playback.artists.join(', ') || 'SkinDeck'} - ${playback.title || 'No active track'}`;
  const currentDuration = playback.durationMs ? formatDuration(playback.durationMs) : '--:--';
  const activeTrackRows = listMode === 'playlist-tracks' ? playlistTracks : listMode === 'search' ? searchResults : [];
  const playlistRows: PlaylistRow[] = listMode === 'playlists'
    ? playlists.map((playlist) => ({
        title: playlist.name,
        duration: String(Math.min(999, playlist.trackCount)).padStart(3, '0'),
        playlistId: playlist.id
      }))
    : activeTrackRows.length
    ? activeTrackRows.map((track) => ({
        title: `${track.artists.join(', ')} - ${track.title}`,
        duration: formatDuration(track.durationMs),
        uri: track.uri
      }))
    : [
        { title: currentTitle, duration: currentDuration },
        { title: 'Search Spotify From This Playlist', duration: '2:22' },
        { title: 'Type Below And Press Enter', duration: '3:10' },
        { title: 'Click A Result To Play It Here', duration: '3:34' }
    ];
  const activeQueue = activeTrackRows.map((track) => track.uri);
  const volumePercent = Math.round((playback.volume ?? 0.7) * 100);
  const liveSpectrum = audioLevels.bands.length
    ? audioLevels.bands.slice(0, spectrum.length).map((level) => Math.round(Math.max(4, Math.min(100, level * 100))))
    : spectrum;

  useEffect(() => {
    const trackline = tracklineRef.current;
    const tracklineText = tracklineTextRef.current;
    if (!trackline || !tracklineText) return;

    const updateOverflow = () => {
      setTracklineOverflow(tracklineText.scrollWidth > trackline.clientWidth);
    };

    updateOverflow();
    window.addEventListener('resize', updateOverflow);
    return () => window.removeEventListener('resize', updateOverflow);
  }, [titleText]);

  function seekFromClick(event: MouseEvent<HTMLDivElement>) {
    if (!playback.durationMs) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    controls.seek(playback.durationMs * ratio);
  }

  function volumeFromClick(event: MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height));
    controls.setVolume(ratio);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    try {
      const results = await controls.searchTracks(searchQuery);
      setSearchResults(results);
      setListMode('search');
    } finally {
      setSearching(false);
    }
  }

  async function loadPlaylists() {
    if (!isAuthenticated || isLoadingPlaylists) return;
    setLoadingPlaylists(true);
    try {
      const nextPlaylists = await controls.getPlaylists();
      setPlaylists(nextPlaylists);
      setListMode('playlists');
    } finally {
      setLoadingPlaylists(false);
    }
  }

  async function openPlaylist(playlistId: string) {
    setLoadingPlaylists(true);
    try {
      const tracks = await controls.getPlaylistTracks(playlistId);
      if (!tracks.length) {
        await controls.playPlaylist(playlistId);
        setActivePlaylistId(playlistId);
        setListMode('playlists');
        return;
      }
      setPlaylistTracks(tracks);
      setActivePlaylistId(playlistId);
      setListMode('playlist-tracks');
    } finally {
      setLoadingPlaylists(false);
    }
  }

  function playPlaylistRow(row: PlaylistRow) {
    if (row.playlistId) {
      openPlaylist(row.playlistId);
      return;
    }

    const contextUri = listMode === 'playlist-tracks' && activePlaylistId ? `spotify:playlist:${activePlaylistId}` : undefined;
    if (row.uri) controls.playTrack(row.uri, activeQueue, contextUri);
  }

  function isPlaylistRowActive(row: PlaylistRow, index: number) {
    if (row.uri && playback.uri) return row.uri === playback.uri;
    return !row.uri && !row.playlistId && index === 0;
  }

  function toggleSpotifyConnection() {
    if (isConnecting) return;
    if (isAuthenticated) {
      disconnect();
      return;
    }

    connect();
  }

  function startWindowDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea, [data-no-window-drag]')) return;
    getCurrentWindow().startDragging();
  }

  return (
    <section className="skin retro-skin">
      <div className="retro-window retro-main-window" data-playing={playback.isPlaying}>
        <div className="retro-titlebar" onMouseDown={startWindowDrag}>
          <span className="retro-zigzag" aria-hidden="true" />
          <span className="retro-caption">WINAMP</span>
          <span className="retro-top-buttons">
            <button
              type="button"
              aria-label={isAuthenticated ? 'Disconnect Spotify' : 'Connect Spotify'}
              title={isAuthenticated ? 'Disconnect Spotify' : 'Connect Spotify'}
              data-active={isAuthenticated}
              disabled={isConnecting}
              onClick={toggleSpotifyConnection}
            />
            <button
              type="button"
              aria-label="Skin settings"
              title="Skin settings"
              data-active={settingsOpen}
              onClick={toggleSettings}
            />
            <button type="button" aria-label="Close SkinDeck" title="Close SkinDeck" onClick={() => window.close()} />
          </span>
        </div>

        <div className="retro-deck">
          <div className="retro-visual">
            <div className="retro-db">
              <span>0</span>
              <span>-6</span>
              <span>-12</span>
            </div>
            <div className="retro-spectrum" aria-hidden="true" data-live={audioLevels.peak > 0.01}>
              {liveSpectrum.map((height, index) => (
                <i
                  key={index}
                  style={
                    {
                      '--bar-height': `${height}%`,
                      '--bar-alt-height': `${Math.max(12, 96 - height)}%`,
                      '--bar-delay': `${index * -83}ms`
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="retro-wave" aria-hidden="true" />
          </div>

          <div className="retro-readout">
            <div className="retro-timecode">{timeText}</div>
            <div className="retro-trackline" ref={tracklineRef} data-overflow={tracklineOverflow}>
              <span className="retro-trackline-marquee">
                <span className="retro-trackline-item" ref={tracklineTextRef}>1. {titleText}</span>
                <span className="retro-trackline-item" aria-hidden="true">1. {titleText}</span>
              </span>
            </div>
            <div className="retro-badges">
              <span>128</span>
              <small>kbps</small>
              <span>44</span>
              <small>kHz</small>
              <span className="retro-mode">{playback.isPlaying ? 'stereo' : 'mono'}</span>
            </div>
            <div className="retro-mini-bars">
              <span />
              <span />
              <span />
            </div>
            <div className="retro-flags">
              <span>EQ</span>
              <span>PL</span>
            </div>
          </div>
        </div>

        <div className="retro-seek" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={playback.durationMs} aria-valuenow={playback.progressMs} onClick={seekFromClick}>
          <span style={{ width: `${progressPercent(playback)}%` }} />
          <i style={{ left: `${progressPercent(playback)}%` }} />
        </div>

        <div className="retro-controls">
          <button type="button" className="retro-btn prev" aria-label="Previous track" onClick={controls.previousTrack} />
          <button type="button" className="retro-btn play" aria-label={playback.isPlaying ? 'Pause' : 'Play'} onClick={controls.togglePlayPause} data-paused={!playback.isPlaying} />
          <button type="button" className="retro-btn pause" aria-label="Pause" onClick={controls.togglePlayPause} />
          <button type="button" className="retro-btn stop" aria-label="Pause" onClick={controls.togglePlayPause} />
          <button type="button" className="retro-btn next" aria-label="Next track" onClick={controls.nextTrack} />
          <button type="button" className="retro-btn eject" aria-label="Skin settings" />
          <div className="retro-shuffle">SHUFFLE</div>
          <div className="retro-repeat" aria-hidden="true" />
          <div className="retro-bolt" aria-hidden="true" />
        </div>
      </div>

      <div className="retro-window retro-eq-window">
        <div className="retro-panel-title" onMouseDown={startWindowDrag}>WINAMP EQUALIZER</div>
        <div className="retro-eq-body">
          <div className="retro-eq-switches">
            <span>ON</span>
            <span>AUTO</span>
          </div>
          <div className="retro-preamp">
            <div className="retro-slider vertical" role="slider" aria-label="Volume" aria-valuemin={0} aria-valuemax={100} aria-valuenow={volumePercent} onClick={volumeFromClick}>
              <i style={{ bottom: `${volumePercent}%` }} />
            </div>
            <span>PREAMP</span>
          </div>
          <div className="retro-eq-scale">
            <span>+12dB</span>
            <span>0dB</span>
            <span>-12dB</span>
          </div>
          <div className="retro-eq-bands">
            {eqBands.map((band, index) => (
              <div className="retro-eq-band" key={band}>
                <div className="retro-slider vertical"><i style={{ bottom: `${eqValues[index]}%` }} /></div>
                <span>{band}</span>
              </div>
            ))}
          </div>
          <button type="button" className="retro-preset">PRESETS</button>
        </div>
      </div>

      <div className="retro-window retro-playlist-window">
        <div className="retro-panel-title" onMouseDown={startWindowDrag}>WINAMP PLAYLIST</div>
        <div className="retro-playlist-body">
          <ol className="retro-playlist">
            {playlistRows.map((row, index) => (
              <li
                key={`${row.title}-${index}`}
                className={isPlaylistRowActive(row, index) ? 'active' : undefined}
                data-clickable={Boolean(row.uri || row.playlistId)}
                onClick={() => playPlaylistRow(row)}
              >
                <span>{index + 1}. {row.title}</span>
                <time>{row.duration}</time>
              </li>
            ))}
          </ol>
          <div className="retro-scrollbar" aria-hidden="true"><span /></div>
        </div>
        <div className="retro-playlist-footer">
          <button type="button" onClick={loadPlaylists} disabled={!isAuthenticated || isLoadingPlaylists}>
            PL
          </button>
          <span>REM</span>
          <span>SEL</span>
          <span>MISC</span>
          <form className="retro-search" onSubmit={submitSearch}>
            <input
              aria-label="Search Spotify"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={isSearching ? 'SEARCHING' : 'SEARCH'}
            />
          </form>
        </div>
      </div>
    </section>
  );
}
