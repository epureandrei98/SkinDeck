import type { PlaybackState } from '../../shared/types';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function progressPercent(playback: PlaybackState): number {
  if (!playback.durationMs) return 0;
  return Math.min(100, Math.max(0, (playback.progressMs / playback.durationMs) * 100));
}
