import type { AudioOutputLevels, PlaybackControls, PlaybackState } from '../../shared/types';

export type SkinProps = {
  playback: PlaybackState;
  audioLevels: AudioOutputLevels;
  controls: PlaybackControls;
  isAuthenticated: boolean;
  isConnecting: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  settingsOpen: boolean;
  toggleSettings(): void;
};
