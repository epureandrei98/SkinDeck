/// <reference types="vite/client" />

import type { SkinDeckApi } from '../shared/types';

declare global {
  interface Window {
    skindeck: SkinDeckApi;
  }
}
