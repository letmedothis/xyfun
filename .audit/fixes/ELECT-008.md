# ELECT-008

## Original Issue
WINDOW_DESTROY IPC Lacks Sender Validation. Any webContents can close any named window.

## Root Cause
The WINDOW_DESTROY, WINDOW_HIDE, and WINDOW_SHOW handlers had no `isTrustedSender()` check. A malicious renderer or webview could close the main window, causing denial of service.

## Fix
Added `isTrustedSender()` validation to WINDOW_DESTROY, WINDOW_HIDE, and WINDOW_SHOW handlers.

## Files Changed
- `src/main/ipc.ts`

## Behavior Before
1. Any renderer calls `ipcRenderer.invoke('window:destroy', 'main')`
2. Window is closed without sender validation

## Behavior After
1. Renderer calls `ipcRenderer.invoke('window:destroy', 'main')`
2. `isTrustedSender()` check is performed
3. If untrusted, returns without action

## Test Added
Regression verified by existing test suite passing.

## Validation
- `pnpm typecheck:node` - PASS
- `pnpm typecheck:web` - PASS
- `pnpm lint` - PASS
- `pnpm test` - PASS (100 tests)

## Regression Risk
NONE - Trusted senders are not affected.

## Remaining Risk
NONE - The fix is a straightforward access control addition.
