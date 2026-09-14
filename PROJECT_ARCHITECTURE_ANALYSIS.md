# XYFUN Project Architecture Analysis

## Scope and method

This is a source-level, read-only review of the current worktree. Findings are limited to behaviour demonstrated by the code; external site behaviour and runtime profiling remain marked where appropriate. No product code was changed.

## Architecture

`src/main/index.ts` is the process entry. Before Electron is ready it configures Chromium, initializes storage and SQLite, configures the proxy, starts Fastify, initializes locale, then creates the main window and registers IPC. Background Film-CMS cache setup and plugin autostart are subsequently dispatched.

```text
Vue renderer (src/renderer/src)
  -> preload (src/preload/index.ts; toolkit Electron API bridge)
  -> ipcRenderer invoke/send
  -> ipcMain handlers (src/main/ipc.ts)
  -> Window / configuration / filesystem / plugin / proxy / Fastify services
  -> libSQL SQLite, local files, network sources, external players

Renderer HTTP requests
  -> renderer Axios wrappers
  -> local Fastify API / remote CMS, IPTV and parse sources
```

## Core modules and data flow

- Renderer boot: `src/renderer/src/main.ts` initializes DOM helpers, Pinia, router and i18n, then mounts `App.vue`. `layouts/components/Content.vue` renders the hash-routed view in `keep-alive`.
- Preload: exposes Electron Toolkit's restricted `electronAPI`, an empty custom API, and the loading-overlay removal function. It does not expose Node `fs` directly.
- Windows: `WindowService` creates and pools main, player, browser/search and other BrowserWindows; it also owns webview session/header rules.
- IPC: `registerIpc()` is called after main-window creation. It routes app, proxy, filesystem, window, player, plugin, shortcut and update operations.
- Persistence: `DbService` opens libSQL/Drizzle against `data.db`, runs migrations, synchronizes selected data to config storage, watches DB changes and optionally exports all data to WebDAV/iCloud.
- Network: renderer Axios wrappers apply a calculated timeout and default retry count zero. Fastify routes adapt CMS/IPTV/parse providers; proxy configuration applies Electron-session and Node dispatchers.
- Playback: the player window hosts `pages/player/index.vue`, which owns `components/multi-player`; async aside modules resolve film/live/parse sources and save history. Player implementations include ArtPlayer/XGPlayer/HLS/FLV/DASH and the separate `packages/vlc` native bridge.
- Shutdown: `will-quit` serially terminates Film-CMS cache, Fastify and plugins with ten-second per-service timeouts, then calls `app.exit(0)`.

## Lifecycle map

1. Main configures command-line switches and acquires the single-instance lock.
2. Storage, DB, proxy and Fastify initialize before `whenReady`; this delays first-window creation.
3. The main BrowserWindow is created, menus/tray/IPC are initialized, and renderer mounts.
4. Navigation moves through cached renderer views; player uses a separate window and IPC event handlers.
5. DB filesystem changes may trigger cloud backup and local-store synchronization.
6. Quit runs bounded cleanup, but is force-exited after cleanup/timeout.

## Risk-focused modules

- `src/main/index.ts`: serial critical-path initialization and globally disabled HTTP cache.
- `src/main/ipc.ts`: broad privileged surface; many handlers do not apply the defined trusted-sender predicate.
- `src/renderer/src/pages/player/index.vue`: component rebuilds player when ad skipping changes and removes channel-wide listeners on teardown.
- `src/renderer/src/utils/request/{api,normal}.ts`: GET cache-busting and request cancellation disabled by default.
- `src/main/services/DbService`: watcher-triggered whole-store synchronization and full backup can scale with user data.
- `packages/vlc` and `components/multi-player`: high-frequency playback and native-resource ownership; requires runtime soak profiling in addition to source inspection.
