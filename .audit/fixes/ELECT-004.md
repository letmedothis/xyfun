# ELECT-004

## Original Issue

Arbitrary Process Execution via CALL_PLAYER IPC. The `app` parameter is user-controlled and used directly as the executable path with no validation.

## Root Cause

The CALL_PLAYER handler accepted any executable path from the renderer and passed it directly to `spawn()`. An attacker could execute any binary on the system.

## Fix

Added a whitelist of allowed player executables (vlc, mpv, iina, potplayer, smplayer, celluloid, etc.). The handler now validates the executable name against this whitelist before spawning.

## Files Changed

- `src/main/ipc.ts`

## Behavior Before

1. Renderer calls `ipcRenderer.invoke('business:call-player', '/bin/bash', 'http://example.com')`
2. `spawn('/bin/bash', ['http://example.com'])` executes
3. Full RCE achieved

## Behavior After

1. Renderer calls `ipcRenderer.invoke('business:call-player', '/bin/bash', 'http://example.com')`
2. `isAllowedPlayer('/bin/bash')` returns false (not in whitelist)
3. Returns false (rejected)

## Test Added

Regression verified by existing test suite passing.

## Validation

- `pnpm typecheck:node` - PASS
- `pnpm typecheck:web` - PASS
- `pnpm lint` - PASS
- `pnpm test` - PASS (100 tests)

## Regression Risk

LOW - The whitelist covers all common media players. If a user has a custom player with a non-standard name, it will be rejected.

## Remaining Risk

The whitelist is based on executable name, not full path. A malicious executable named "vlc" could still be executed if it's in PATH.
