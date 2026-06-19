/// <reference types="vite/client" />

import type { SkinDeckApi } from '../preload';

declare global {
  interface Window {
    skindeck: SkinDeckApi;
  }
}
