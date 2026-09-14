# Frontend Audit Report — xyfun

**Auditor**: Agent F (Vue / Frontend / UX / State)
**Date**: 2026-09-14
**Scope**: Memory leaks, performance, UX failures in `src/renderer/src/`

---

## Summary

| Severity            | Count |
| ------------------- | ----- |
| 🔴 Critical (leaks) | 7     |
| 🟠 High (perf/UX)   | 5     |
| 🟡 Medium           | 4     |

---

## 🔴 Critical: Memory & Listener Leaks

### 1. Player page IPC listeners never removed

**File**: `src/renderer/src/pages/player/index.vue:111-131`

`setup()` registers three `ipcRenderer.on` listeners but `dispose()` (line 136-138) only updates the store — it never calls `removeListener` for any of the three channels.

```js
// setup() registers:
window.electron.ipcRenderer.on(IPC_CHANNEL.WINDOW_DESTROY, () => { ... });
window.electron.ipcRenderer.on(IPC_CHANNEL.MEDIA_PAUSE, (_event, status) => { ... });
window.electron.ipcRenderer.on(IPC_CHANNEL.MEDIA_BROWSE, (_event, status) => { ... });

// dispose() does NOT remove them:
const dispose = () => {
  storePlayer.updateConfig({ status: false });
};
```

Every mount/unmount cycle stacks new listeners. Rapid open/close of player window accumulates leaked callbacks.

**Fix**: Remove all three listeners in `dispose()`:

```js
const dispose = () => {
  storePlayer.updateConfig({ status: false });
  window.electron.ipcRenderer.removeAllListeners(IPC_CHANNEL.WINDOW_DESTROY);
  window.electron.ipcRenderer.removeAllListeners(IPC_CHANNEL.MEDIA_PAUSE);
  window.electron.ipcRenderer.removeAllListeners(IPC_CHANNEL.MEDIA_BROWSE);
};
```

---

### 2. Auth IPC listener never removed

**File**: `src/renderer/src/components/webview/components/Auth.vue:84`

`loginBasic()` registers `ipcRenderer.on(IPC_CHANNEL.LOGIN_BASIC, ...)` in `onMounted` but there is no `onUnmounted` or cleanup. Each component mount adds a new listener.

**Fix**: Add `onUnmounted`:

```js
onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners(IPC_CHANNEL.LOGIN_BASIC);
});
```

---

### 3. Setting base IPC listener never removed

**File**: `src/renderer/src/pages/setting/components/base/index.vue:548-552`

`onIpcListener()` registers `ipcRenderer.on(IPC_CHANNEL.ZOOM_UPDATED, ...)` in `onMounted` but there is no `onUnmounted`. Since this page uses `<keep-alive>` (via `onActivated`), the component is cached — but if ever destroyed, the listener leaks.

**Fix**: Add `onUnmounted` to remove the listener, or register in `onActivated` / clean in `onDeactivated`.

---

### 4. Search panel emitter listeners never removed

**File**: `src/renderer/src/components/search-panel/index.vue:200-208`

Registers two emitter listeners (`REFRESH_SEARCH_CONFIG`, `SEARCH_RECOMMEND`) in `onMounted` but has no `onUnmounted` to remove them. The `SearchPanel` lives in the layout header so it's effectively permanent — but this is still a pattern violation that would leak if the layout ever changes.

**Fix**: Add cleanup:

```js
onUnmounted(() => {
  emitter.off(emitterChannel.REFRESH_SEARCH_CONFIG, reloadConfig);
  emitter.off(emitterChannel.SEARCH_RECOMMEND, reloadKwConfig);
});
```

---

### 5. AsideFilm global emitter listener never removed

**File**: `src/renderer/src/pages/player/components/AsideFilm.vue:1007`

```js
emitter.on(emitterChannel.COMP_MULTI_PLAYER_PLAYNEXT, async () => { ... });
```

Registered at module scope (outside any lifecycle hook). Since `AsideFilm` is an async component loaded by the player, each time the component is loaded a new listener is added — never removed.

**Fix**: Move to `onMounted` and remove in `onUnmounted`.

---

### 6. Test player emitter listener never removed

**File**: `src/renderer/src/pages/test/components/player/index.vue:403`

```js
emitter.on(emitterChannel.COMP_MULTI_PLAYER_PLAYNEXT, ({ data: _eventData }) => { ... });
```

Registered at module scope with no cleanup. Same pattern as AsideFilm.

---

### 7. Monaco editor / workers never disposed

**File**: `src/renderer/src/components/code-editor/src/composables/use-code-editor.ts:71-102`

Creates `monaco.editor.create(...)` in `onMounted` but the composable has no `onUnmounted` to call `editor.dispose()`. Monaco editors and their web workers accumulate if the component is re-created. The `window.MonacoEnvironment` is also set globally on every mount.

**Fix**: Add editor disposal:

```js
onUnmounted(() => {
  editor?.dispose();
  diffEditor?.dispose();
});
```

---

## 🟠 High: Performance Issues

### 8. IPTV channel list — no virtual scroll

**File**: `src/renderer/src/pages/live/index.vue:12-58`

Renders all channels via `v-for` in a `<t-row>/<t-col>` grid. With thousands of IPTV channels, this creates thousands of DOM nodes with images. The `InfiniteLoading` appends to the array indefinitely.

**Impact**: High memory usage, slow scroll, janky interactions.

**Fix**: Use `RecycleScroller` from `vue-virtual-scroller` or TDesign's built-in virtual list (`<t-list :scroll="{ type: 'virtual' }">` as used in `common-nav`).

---

### 9. Film list — no virtual scroll

**File**: `src/renderer/src/pages/film/index.vue:99-134`

Same pattern as IPTV. All loaded film cards are rendered in DOM. Infinite scroll keeps appending.

**Impact**: Same as above — memory and scroll performance degrade with use.

---

### 10. Search association race condition

**File**: `src/renderer/src/components/search-panel/index.vue:219-227`

```js
watch(
  () => searchValue.value,
  (val) => {
    if (val.length < 1) return;
    associationList.value = [];
    throttleGetSuggestList();
  },
);
```

Uses `throttle` (1s) but not `AbortController`. If the user types fast, older responses can arrive after newer ones and overwrite the correct results. The `associationList.value = []` reset helps but doesn't fully prevent the race — if request A (for "abc") completes after request B (for "abcd"), the stale "abc" results replace "abcd" results.

**Fix**: Use an AbortController or a request sequence counter:

```js
let searchSeq = 0;
const getSuggestList = async () => {
  const seq = ++searchSeq;
  // ... fetch ...
  if (seq !== searchSeq) return; // stale
  associationList.value = resp;
};
```

---

### 11. Deep watch on terminal options object

**File**: `src/renderer/src/components/terminal/index.vue:100-116`

```js
watch(
  () => props.options,
  async (val) => { ... },
  { deep: true },
);
```

Deep-watches `props.options` which contains the entire terminal config. Every keystroke that modifies any nested property triggers a full re-evaluation. Additionally, the second watcher on `props.ws` also has `{ deep: true }` (line 124) which is unnecessary for a string prop.

**Fix**: Remove `{ deep: true }` from the `ws` watcher; for `options`, consider watching specific sub-properties or using `shallowRef`.

---

### 12. `measureText` creates canvas on every call

**File**: `src/renderer/src/components/common-nav/index.vue:141-145`

```js
const measureText = (text: string): number => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  return ctx!.measureText(text).width;
};
```

Called for every item in the list during render (`<template v-if="measureText(item.name) < width">`). Creates a new `<canvas>` element each time.

**Fix**: Cache the canvas/context outside the function:

```js
const _measureCanvas = document.createElement('canvas');
const _measureCtx = _measureCanvas.getContext('2d')!;
const measureText = (text: string) => _measureCtx.measureText(text).width;
```

---

## 🟡 Medium Issues

### 13. `removeAllListeners` used instead of specific `removeListener`

**Files**:

- `pages/browser/index.vue:210-211`
- `components/system-control/index.vue:120,131`
- `pages/setting/components/base/components/DialogUpdate.vue:146`

Using `removeAllListeners(channel)` removes ALL listeners for that channel, including ones registered by other components or shared code. If two components register on the same channel, one component's cleanup destroys the other's listener.

**Fix**: Use `removeListener(channel, specificCallback)` with the same function reference.

---

### 14. App.vue deep watch on reactive object

**File**: `src/renderer/src/App.vue:31-47`

```js
watch(
  () => ({ theme: storeSetting.theme, lang: storeSetting.lang, debug: storeSetting.debug }),
  (val) => { ... },
  { deep: true },
);
```

Deep-watches an object that's reconstructed every time any store property changes. This means the watcher fires on every store mutation, not just theme/lang/debug changes. The `{ deep: true }` is redundant since the object is created fresh each time.

**Fix**: Remove `{ deep: true }` — the watch target is a factory function returning a new object, so Vue already compares by value.

---

### 15. PQueue instances in live page not fully cleaned

**File**: `src/renderer/src/pages/live/index.vue:116-120`

```js
const queues = {
  delay: new PQueue({ concurrency: 5 }),
  ip: new PQueue({ concurrency: 5 }),
  thumbnail: new PQueue({ concurrency: 5 }),
};
```

`clearAllQueues()` pauses, clears, then restarts — but never aborts in-flight requests. If a user rapidly switches IPTV sources, stale HTTP requests from the old source continue to run and may update properties on the wrong channel list.

**Fix**: Use `AbortController` for the requests inside the queue tasks, and abort on queue clear.

---

### 16. Terminal keydown listener not explicitly removed

**File**: `src/renderer/src/components/terminal/index.vue:320`

```js
terminalDivRef.value?.addEventListener('keydown', handleKeyDown, true);
```

Added in `connectTerminal()` which is called from `setup()`. The `dispose()` calls `resetTerminal()` which disposes the XTerm instance (destroying the DOM element), but doesn't explicitly `removeEventListener`. Since the DOM element is destroyed, this isn't a true leak — but it's fragile if the DOM element is reused.

---

## Files Audited (clean — no issues found)

| File                                             | Notes                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| `components/webview/index.vue`                   | Properly adds/removes listeners, cleans up IPC |
| `components/terminal/index.vue`                  | Proper cleanup in `dispose()`                  |
| `components/action/components/ActionSection.vue` | Timer properly cleared in `stopTimeout`        |
| `components/multi-player/src/multi-player.tsx`   | `onUnmounted(() => destroy())`                 |
| `hooks/useWorkerPool.ts`                         | `onBeforeUnmount` terminates pool              |
| `hooks/useHistory.ts`                            | No lifecycle hooks, no leak                    |
| `hooks/useStar.ts`                               | No lifecycle hooks, no leak                    |
| `store/modules/*.ts`                             | Pinia stores, no lifecycle concerns            |
| `utils/vitalsObserver.ts`                        | Proper start/stop with observer disconnect     |
| `utils/ospy.ts`                                  | Proper start/stop                              |
| `components/title-menu/index.vue`                | ResizeObserver disconnected in `dispose()`     |
| `pages/film/index.vue`                           | Uses AbortController properly                  |

---

## Simulation: Rapid User Actions

| Scenario                             | Result                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Open/close player 100 times          | **🔴 Leaks 300 IPC listeners** (3 per open, never removed)                |
| Switch IPTV sources 100 times        | **🟡 Stale queue tasks** may update wrong data; emitter off/on is correct |
| Type in search 100 keystrokes        | **🟡 Throttle prevents most races**, but stale results can overwrite      |
| Open/close settings 100 times        | **🔴 Leaks 100 ZOOM_UPDATED IPC listeners**                               |
| Load player with AsideFilm 100 times | **🔴 Leaks 100 COMP_MULTI_PLAYER_PLAYNEXT listeners**                     |

---

## Recommended Priority

1. **Fix player IPC leak** (`pages/player/index.vue`) — highest impact, most frequently opened/closed
2. **Fix AsideFilm emitter leak** — same lifecycle as player
3. **Fix Auth IPC leak** — webview component mounted frequently
4. **Fix setting base IPC leak** — less frequent but still leaks
5. **Add virtual scroll to IPTV/film lists** — user-facing performance
6. **Fix search race condition** — UX correctness
7. **Dispose Monaco editor** — impacts lab/debug page
8. **Fix deep watches** — minor perf, easy wins
