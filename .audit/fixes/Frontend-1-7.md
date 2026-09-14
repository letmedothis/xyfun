# Frontend-1-7

## Original Issue

Multiple IPC listener and emitter listener leaks across frontend components:

1. Player page IPC listeners never removed
2. Auth IPC listener never removed
3. Setting base IPC listener never removed
4. Search panel emitter listeners never removed
5. AsideFilm emitter listener never removed (module scope)
6. Test player emitter listener never removed (module scope)
7. Monaco editor never disposed

## Root Cause

Components registered IPC/emitter listeners in `onMounted` but never cleaned them up in `onUnmounted`. Module-scope registrations accumulated with each component mount.

## Fix

Added proper cleanup for all identified leaks:

1. Player: Added `removeAllListeners` in `dispose()`
2. Auth: Added `onUnmounted` with `removeAllListeners`
3. Setting base: Added `onUnmounted` with `removeAllListeners` and `emitter.off`
4. Search panel: Added `onUnmounted` with `emitter.off`
5. AsideFilm: Moved emitter registration to `onMounted`, added `onUnmounted` cleanup
6. Test player: Moved emitter registration to `onMounted`, added `onUnmounted` cleanup
7. Monaco editor: Added `onUnmounted` with `editor.dispose()` and `diffEditor.dispose()`

## Files Changed

- `src/renderer/src/pages/player/index.vue`
- `src/renderer/src/components/webview/components/Auth.vue`
- `src/renderer/src/pages/setting/components/base/index.vue`
- `src/renderer/src/components/search-panel/index.vue`
- `src/renderer/src/pages/player/components/AsideFilm.vue`
- `src/renderer/src/pages/test/components/player/index.vue`
- `src/renderer/src/components/code-editor/src/composables/use-code-editor.ts`

## Behavior Before

Listeners accumulated with each mount/unmount cycle, causing memory leaks and duplicate event handling.

## Behavior After

Listeners are properly cleaned up when components are unmounted.

## Test Added

Regression verified by existing test suite passing.

## Validation

- `pnpm typecheck:node` - PASS
- `pnpm typecheck:web` - PASS
- `pnpm lint` - PASS
- `pnpm test` - PASS (100 tests)

## Regression Risk

LOW - All changes follow standard Vue lifecycle patterns. The `removeAllListeners` approach is safe since these components own their IPC channels.

## Remaining Risk

The `removeAllListeners` approach removes ALL listeners for a channel, including any registered by other code. If shared channels are used, this could cause issues. Consider using `removeListener` with specific callbacks for shared channels.
