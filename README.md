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
- Tauri/WebView2 desktop shell with local token and preference persistence

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

## WebView2 Widevine Experiment

The Tauri shell passes Chromium-style arguments to WebView2 before the app window is created:

```txt
--autoplay-policy=no-user-gesture-required --enable-widevine-cdm
```

To test another set of WebView2 arguments:

```powershell
$env:SKINDECK_WEBVIEW2_ARGS = "--autoplay-policy=no-user-gesture-required --enable-widevine-cdm"
npm run dev
```

## Spotify Scopes

SkinDeck requests:

- `streaming`
- `user-read-currently-playing`
- `user-read-playback-state`
- `user-modify-playback-state`
- `user-read-email`
- `user-read-private`
- `playlist-read-private`
- `playlist-read-collaborative`

Playback controls use Spotify's official Web API and Web Playback SDK. The SDK creates a Spotify Connect device inside the app and requires Spotify Premium. If you authenticated before SDK or playlist support was added, disconnect/reconnect so Spotify can approve the latest scopes.

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
  renderer/    React app, settings, skins
  shared/      Shared types and skin manifests
  spotify/     OAuth PKCE and Spotify Web API wrapper
src-tauri/      Tauri Rust shell and WebView2 configuration
```

## MVP Boundaries

SkinDeck is not a Spotify client replacement. It uses Spotify's official APIs and SDK, does not manage playlists, does not modify the official Spotify client, and does not redistribute Spotify content.
