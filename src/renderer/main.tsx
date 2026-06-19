import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installDevMockBridge } from './devMock';
import './styles.css';
import './skins/minimal/style.css';
import './skins/winamp-retro/style.css';

installDevMockBridge();
installWindowControlsOverlaySupport();

function installWindowControlsOverlaySupport(): void {
  const overlay = (navigator as Navigator & {
    windowControlsOverlay?: {
      visible: boolean;
      getTitlebarAreaRect?: () => DOMRect;
      addEventListener?: (type: 'geometrychange', listener: () => void) => void;
    };
  }).windowControlsOverlay;

  if (!overlay) return;

  const apply = () => {
    const root = document.documentElement;
    const rect = overlay.getTitlebarAreaRect?.();
    root.classList.toggle('wco-visible', Boolean(overlay.visible));
    root.style.setProperty('--wco-x', `${Math.round(rect?.x ?? 0)}px`);
    root.style.setProperty('--wco-y', `${Math.round(rect?.y ?? 0)}px`);
    root.style.setProperty('--wco-width', `${Math.round(rect?.width ?? 0)}px`);
    root.style.setProperty('--wco-height', `${Math.round(rect?.height ?? 0)}px`);
  };

  apply();
  overlay.addEventListener?.('geometrychange', apply);
  window.addEventListener('resize', apply, { passive: true });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
