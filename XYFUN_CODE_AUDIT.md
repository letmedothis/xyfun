# XYFUN Code Audit

## Summary

P0: 0  
P1: 3  
P2: 4  
P3: 1

This audit intentionally excludes style-only observations. “Needs Verification” items have a concrete source risk but require workload/runtime confirmation before being treated as defects.

## P1 High

### BUG-000 — Reused abort tag lets an older request cancel its replacement

**File:** `src/renderer/src/pages/film/index.vue:301-314,397-399,435-437,460-462`  
**Function:** film request/cancellation helpers

**Problem:** Requests reuse an abort-controller tag. Each request's `finally` removes the controller by tag; if request A is superseded by B, A's delayed `finally` can remove/abort B's controller.

**Trigger:** Quickly change film search/class/filter before the earlier request settles.

**Call chain:** UI change → request A tagged → UI change → request B same tag → A `finally` → shared canceler removal → B is affected.

**Impact:** Latest detail/list request can be cancelled or lose cancellation tracking, producing intermittent empty/stale film views.

**Evidence:** The same tag registry is assigned at lines 301-314 and released unconditionally from all three request-finally paths cited above, without identity comparison.

**Fix:** Release only when the registry still contains that request's exact controller (or use monotonically increasing request ids).

**Validation:** Delay A, start B, then complete A; assert B remains active and is the only result committed.

---

### BUG-00A — Player source changes have no generation guard

**Files:** `src/renderer/src/pages/player/components/AsideFilm.vue:886`; `AsideLive.vue:419`; `AsideParse.vue:355`; `src/renderer/src/components/multi-player/index.vue:69-72,99-110`

**Functions:** aside create emit; MultiPlayer create

**Problem:** Source selection emits a create operation, but Vue event emission is not awaited by the child; parent player creation waits for media-type detection and then destroys/recreates the instance without a request generation check.

**Trigger:** Rapid episode, quality, line, or live-channel switching while media detection is pending.

**Call chain:** aside interaction → `emit('create')` → parent async create → media detection → destroy/create player.

**Impact:** An earlier, slower detection can complete after the latest selection and replace playback with the wrong source.

**Evidence:** The cited emit sites use `await emits('create')`, which does not await parent listener completion; multi-player's async detection and recreate path have no latest-request identity guard.

**Fix:** Centralize source changes in a sequenced async command; discard completion unless its generation matches current source and abort/destroy obsolete work.

**Validation:** Artificially delay source A detection, switch to B, and assert only B initializes.

---

### BUG-001 — Privileged IPC handlers accept untrusted sender frames

**Files:** `src/main/ipc.ts:66-84,103-183`  
**Function:** `registerIpc`

**Problem:** `isTrustedSender()` is implemented at lines 66-84, but the API-server, autostart, DNS, quit/reboot, proxy and binary-install handlers shown at lines 103-183 do not call it. The same pattern continues across the IPC registry.

**Trigger:** A renderer-originated frame that can obtain the IPC bridge (particularly a future/preload-equipped webview or renderer XSS) invokes a privileged channel.

**Call chain:** renderer frame → `ipcRenderer.invoke(channel)` → `ipcMain.handle()` → Fastify/process/proxy/binary service.

**Impact:** This turns a renderer compromise into privileged local operations, including server lifecycle and binary installation. It also makes the security boundary inconsistent and hard to reason about.

**Evidence:** The helper is only used by `getOwnedWebview()` at lines 95-97; handlers at lines 103-183 accept `_` rather than validating it.

**Fix:** Gate every privileged handler through a shared trusted-main-frame assertion; validate payload shapes per channel. Keep a narrow explicit allow-list for webview-originated operations.

**Risk / validation:** Regression-test valid main-window IPC plus rejected calls from an untrusted `WebContents`.

---

## P2 Medium

### BUG-002 — HTTP caching is disabled globally while renderer also cache-busts GET requests

**Files:** `src/main/index.ts:126`; `src/renderer/src/utils/request/normal.ts:63-70`

**Functions:** `setupApp`; Axios `beforeRequestHook`

**Problem:** Electron receives `disable-http-cache`; renderer GET requests then append a timestamp by default (`joinTime: true`).

**Trigger:** Reopening detail/search/IPTV/cover resources, or normal playback-related HTTP traffic.

**Call chain:** renderer request → timestamped GET → Chromium session with HTTP cache disabled → network transfer.

**Impact:** Prevents reuse of cacheable API/media metadata and image responses, increasing latency, bandwidth, CPU decoding and external-source load. This is especially visible during repeated navigation and long sessions.

**Evidence:** Both mechanisms are unconditional defaults in the cited locations.

**Fix:** Remove global cache disablement unless a specific endpoint demands it; make cache busting opt-in for truly volatile endpoints.

**Validation:** Compare Chromium cache statistics and repeated-navigation waterfall before/after.

---

### BUG-003 — Player teardown removes listeners it does not own

**File:** `src/renderer/src/pages/player/index.vue:111-141`  
**Function:** `setup` / `dispose`

**Problem:** Listeners are installed with anonymous callbacks, then `removeAllListeners(channel)` removes every listener on each channel rather than only this component's handlers.

**Trigger:** Player page/window component unmounts while another feature/preload listener shares one of `WINDOW_DESTROY`, `MEDIA_PAUSE`, or `MEDIA_BROWSE`.

**Call chain:** player mount → `ipcRenderer.on` → player unmount → `removeAllListeners`.

**Impact:** A separately registered listener silently stops receiving IPC, causing window/media controls to fail after lifecycle transitions.

**Evidence:** Anonymous registrations at lines 112, 117 and 121 cannot be paired with `removeListener`; teardown at lines 138-140 deletes channel-wide listeners.

**Fix:** Name each listener and call `removeListener(channel, listener)` in teardown.

**Validation:** Mount/unmount player while a second listener is registered; ensure the second listener still fires.

---

### BUG-004 — Renderer view refresh event listener has no lifecycle cleanup

**File:** `src/renderer/src/layouts/components/Content.vue:27-30`  
**Function:** module setup

**Problem:** A singleton emitter listener is registered without an `onUnmounted` unsubscribe.

**Trigger:** Any lifecycle that remounts this layout (window reload, test remount, future nested-layout use).

**Call chain:** layout setup → `emitter.on(REFRESH_VIEW)` → layout remount → another handler.

**Impact:** Repeated handlers toggle stale refs and schedule extra renders; after enough remounts this becomes a listener/memory accumulation and can cause erratic refresh behaviour.

**Evidence:** No matching `emitter.off` exists in the component.

**Fix:** Preserve the callback reference and unregister it in `onUnmounted`.

**Validation:** Repeatedly mount/unmount and inspect emitter listener count; emit once and assert one refresh.

---

### BUG-005 — Startup blocks window creation on serial I/O and server initialization

**File:** `src/main/index.ts:346-366`  
**Function:** `main`

**Problem:** Required-directory initialization, DB initialization, proxy configuration and Fastify start are awaited serially before `setupReady()`, which is the only path to main-window creation.

**Trigger:** First start, slow/locked DB, slow proxy resolution, or a delayed Fastify bind.

**Call chain:** process start → `main` awaits four services → `setupReady` → `whenReady` → `createMainWindow`.

**Impact:** Startup appears hung until every service finishes; even a nonessential API server delays visible UI.

**Evidence:** Lines 354-361 show sequential awaits before `setupReady`; Fastify failure is explicitly tolerated at line 358, confirming it need not block UI.

**Fix:** Keep only prerequisites on the first-window path; start Fastify/plugin/cache work after UI is shown, with bounded timeout/status reporting. Preserve DB readiness where renderer depends on it.

**Validation:** Instrument cold start through first paint under normal and delayed Fastify conditions.

---

## P3 Low

### BUG-006 — Playback history schema has no retention/index policy

**File:** `src/main/services/DbService/schemas/history.ts:6-30`

**Function:** `history` schema

**Status:** Needs Verification

**Problem:** History has no index besides its primary key and no retention constraint in the schema. The renderer groups and renders history data (`pages/moment/components/history/index.vue`) after loading it.

**Trigger:** Long-lived profiles accumulating a large watch history.

**Impact:** History retrieval/order/grouping and backup payload size can grow with all records, increasing startup/sync/UI time.

**Evidence:** The schema contains no secondary index or bounded retention mechanism.

**Fix:** Confirm query patterns with production-size data; add an index matching the history listing order and an explicit user-configurable retention/cap policy if unbounded history is intended.

**Validation:** Seed 10k/100k records, measure list query, grouping/render, DB size and cloud backup duration.
