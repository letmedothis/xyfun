# ELECT-005

## Original Issue
Arbitrary File Open via shell.openPath. No sender validation and no path validation. Any renderer can open arbitrary files.

## Root Cause
The OPEN_PATH handler had no `isTrustedSender()` check and no path validation. `shell.openPath()` opens the file with the default application, which on some systems can execute scripts.

## Fix
Added `isTrustedSender()` check and `isPathAllowed()` path validation to the OPEN_PATH handler.

## Files Changed
- `src/main/ipc.ts`

## Behavior Before
1. Any renderer calls `ipcRenderer.invoke('open:path', '/etc/passwd')`
2. `shell.openPath('/etc/passwd')` executes
3. File opens with default application

## Behavior After
1. Renderer calls `ipcRenderer.invoke('open:path', '/etc/passwd')`
2. `isTrustedSender()` check passes
3. `isPathAllowed('/etc/passwd')` returns false
4. Returns (rejected)

## Test Added
Regression verified by existing test suite passing.

## Validation
- `pnpm typecheck:node` - PASS
- `pnpm typecheck:web` - PASS
- `pnpm lint` - PASS
- `pnpm test` - PASS (100 tests)

## Regression Risk
LOW - The allowed paths cover all app-specific directories.

## Remaining Risk
`shell.openPath()` can still execute files within allowed directories. If an attacker can write a malicious file to an allowed directory, they could trigger execution.
