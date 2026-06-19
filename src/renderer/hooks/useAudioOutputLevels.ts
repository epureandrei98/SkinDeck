import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import type { AudioOutputLevels } from '../../shared/types';

const silentLevels: AudioOutputLevels = {
  peak: 0,
  bands: Array.from({ length: 18 }, () => 0)
};

export function useAudioOutputLevels() {
  const [levels, setLevels] = useState<AudioOutputLevels>(silentLevels);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listen<AudioOutputLevels>('audio-output-levels', (event) => {
      if (active) setLevels(event.payload);
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => {
        if (active) setLevels(silentLevels);
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return levels;
}
