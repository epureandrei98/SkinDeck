import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { SkinProps } from '../SkinProps';
import { formatDuration, progressPercent } from '../../utils/time';

export function MinimalSkin({ playback, controls }: SkinProps) {
  const artistText = playback.artists.join(', ') || 'Open Spotify to begin';

  return (
    <section className="skin minimal-skin">
      <div className="minimal-art">
        {playback.albumArtUrl ? <img src={playback.albumArtUrl} alt="" /> : <span>SD</span>}
      </div>
      <div className="minimal-body">
        <div className="track-title">{playback.title}</div>
        <div className="track-meta">{artistText}</div>
        <div className="progress-row">
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progressPercent(playback)}%` }} />
          </div>
          <span>{formatDuration(playback.progressMs)}</span>
        </div>
      </div>
      <div className="minimal-controls">
        <button type="button" aria-label="Previous track" onClick={controls.previousTrack}>
          <SkipBack size={16} />
        </button>
        <button type="button" aria-label={playback.isPlaying ? 'Pause' : 'Play'} onClick={controls.togglePlayPause}>
          {playback.isPlaying ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button type="button" aria-label="Next track" onClick={controls.nextTrack}>
          <SkipForward size={16} />
        </button>
      </div>
    </section>
  );
}
