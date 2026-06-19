# SkinDeck

SkinDeck is an open-source desktop companion/controller for Spotify playback. It shows and controls Spotify playback inside locally switchable visual skins, with an optional in-app Spotify Connect player powered by the Spotify Web Playback SDK.

This project is not affiliated with Spotify. It uses Spotify APIs to control and display playback from the user's own Spotify account. It does not stream or redistribute Spotify audio.

## Features

- Spotify OAuth PKCE login
- Spotify Web Playback SDK device named `SkinDeck`
- Current track, artist, album, album art, progress, playback state, and active device
- Play/pause, next, previous, seek, and local SDK volume controls
- Local skin switching with persisted selection
- Minimal and Winamp-inspired starter skins
- Always-on-top toggle
- Local encrypted token persistence through Electron `safeStorage` when available

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Spotify app at <https://developer.spotify.com/dashboard>.

3. In the Spotify app settings, add this redirect URI:

   ```txt
   http://127.0.0.1:5173/callback
   ```

4. Copy `.env.example` to `.env` and add your client ID:

   ```txt
   VITE_SPOTIFY_CLIENT_ID=your_client_id_here
   VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/callback
   ```

5. Run the desktop app:

   ```bash
   npm run dev
   ```

## Edge Dev Window Size

You can launch the Edge wrapper at a fixed size and position:

```bash
npm run dev:edge:frameless -- --size=1280,720 --position=120,80
```

You can also use environment variables:

```powershell
$env:SKINDECK_EDGE_SIZE = "1280,720"
$env:SKINDECK_EDGE_POSITION = "120,80"
npm run dev:edge:frameless
```

Note: true `--kiosk` mode is intentionally fullscreen by design. For a windowed kiosk-like shell, use `dev:edge:frameless` with `--size` and `--position`.

## Window Controls Overlay (PWA)

This project manifest already opts in to Window Controls Overlay with:

```json
"display_override": ["window-controls-overlay", "standalone"]
```

Important: the overlay is only available for an installed desktop PWA window. It does not activate for plain browser tabs, and it may not activate for ad-hoc `--app=<url>` launches.

To use it:

1. Start the renderer (`npm run dev:renderer`) or a production host for the same origin.
2. Open that origin in Edge and install it as an app.
3. Launch the installed app window from Edge/apps list or Start menu.

When the overlay is active, SkinDeck now adjusts top spacing automatically so content does not sit under the window buttons.

## Spotify Scopes

SkinDeck requests:

- `streaming`
- `user-read-currently-playing`
- `user-read-playback-state`
- `user-modify-playback-state`
- `user-read-email`
- `user-read-private`

Playback controls use Spotify's official Web API and Web Playback SDK. The SDK creates a Spotify Connect device inside the app and requires Spotify Premium. If you authenticated before SDK support was added, disconnect/reconnect so Spotify can approve the new `streaming` scope.

## Adding a Skin

MVP skins are React components in `src/renderer/skins`. A skin receives the same playback data and controls:

```ts
type PlaybackState = {
  isPlaying: boolean;
  title: string;
  artists: string[];
  album: string;
  albumArtUrl: string;
  progressMs: number;
  durationMs: number;
  deviceName?: string;
};

type PlaybackControls = {
  togglePlayPause(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
};
```

To add a skin:

1. Create `src/renderer/skins/my-skin`.
2. Add `manifest.json`, `MySkin.tsx`, and `style.css`.
3. Register the manifest in `src/shared/skins.ts`.
4. Add the component branch in `src/renderer/skins/SkinHost.tsx`.
5. Import the CSS from `src/renderer/main.tsx`.

Example manifest:

```json
{
  "id": "my-skin",
  "name": "My Skin",
  "author": "Project",
  "version": "0.1.0",
  "description": "A local SkinDeck skin"
}
```

## Project Structure

```txt
src/
  main/        Electron window, auth popup, encrypted local persistence
  preload/     Safe IPC bridge exposed to the renderer
  renderer/    React app, settings, skins
  shared/      Shared types and skin manifests
  spotify/     OAuth PKCE and Spotify Web API wrapper
```

## MVP Boundaries

SkinDeck is not a Spotify client replacement. It uses Spotify's official APIs and SDK, does not manage playlists, does not modify the official Spotify client, and does not redistribute Spotify content.
