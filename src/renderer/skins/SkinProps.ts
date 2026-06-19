import type { PlaybackControls, PlaybackState } from '../../shared/types';

export type SkinProps = {
  playback: PlaybackState;
  controls: PlaybackControls;
  isAuthenticated: boolean;
  isConnecting: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  settingsOpen: boolean;
  toggleSettings(): void;
};
