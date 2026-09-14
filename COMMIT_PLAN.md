# Commit Plan

## Commit 1: fix(security): remove RCE via tvbox new Function execution
- `src/main/services/FastifyService/routes/v1/file/tvbox.ts`

## Commit 2: fix(security): add path sandboxing to FS IPC handlers
- `src/main/ipc.ts` (FS_EXIST, FS_DELETE, FS_FILE_READ, FS_FILE_WRITE, FS_DIR_READ, FS_DIR_CREATE)

## Commit 3: fix(security): add player executable whitelist to CALL_PLAYER
- `src/main/ipc.ts` (CALL_PLAYER handler)

## Commit 4: fix(security): set ignoreScripts for plugin installation
- `src/main/services/PluginService.ts`

## Commit 5: fix(security): add sender validation to window IPC handlers
- `src/main/ipc.ts` (WINDOW_DESTROY, WINDOW_HIDE, WINDOW_SHOW)

## Commit 6: fix(security): fix shell injection in tgz module
- `src/shared/modules/zip/tgz.ts`

## Commit 7: fix(security): add path validation to shell.openPath
- `src/main/ipc.ts` (OPEN_PATH handler)

## Commit 8: fix(frontend): fix IPC and emitter listener leaks across 7 components
- `src/renderer/src/pages/player/index.vue`
- `src/renderer/src/components/webview/components/Auth.vue`
- `src/renderer/src/pages/setting/components/base/index.vue`
- `src/renderer/src/components/search-panel/index.vue`
- `src/renderer/src/pages/player/components/AsideFilm.vue`
- `src/renderer/src/pages/test/components/player/index.vue`
- `src/renderer/src/components/code-editor/src/composables/use-code-editor.ts`

## Commit 9: fix(performance): fix search race condition and canvas caching
- `src/renderer/src/components/search-panel/index.vue`
- `src/renderer/src/components/common-nav/index.vue`

## Commit 10: fix(frontend): remove unnecessary deep watch in App.vue
- `src/renderer/src/App.vue`
