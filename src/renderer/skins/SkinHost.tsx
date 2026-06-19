import type { PlaybackControls, PlaybackState } from '../../shared/types';
import { MinimalSkin } from './minimal/MinimalSkin';
import { WinampRetroSkin } from './winamp-retro/WinampRetroSkin';

type SkinHostProps = {
  skinId: string;
  playback: PlaybackState;
  controls: PlaybackControls;
  isAuthenticated: boolean;
  isConnecting: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  settingsOpen: boolean;
  toggleSettings(): void;
};

export function SkinHost(props: SkinHostProps) {
  const { skinId, playback, controls } = props;
  if (skinId === 'winamp-retro') {
    return <WinampRetroSkin {...props} />;
  }

  return <MinimalSkin {...props} />;
}
