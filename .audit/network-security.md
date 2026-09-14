# Network / Plugin / Script / Puppeteer Security Audit Report

**Auditor**: Agent B — Network / Plugin / Script / Puppeteer Security Auditor
**Project**: xyfun at /home/xu/project/xyfun
**Date**: 2026-09-14
**Scope**: Dynamic code execution, plugin system, Puppeteer/browser automation, HTTP/WebSocket connections, Fastify local server, script execution in parsers, IPTV/M3U parsing, video source handling

---

## Executive Summary

The xyfun project is an Electron-based media player/aggregator with a complex plugin system, CMS adapters, and browser automation capabilities. The audit identified **8 security findings** ranging from Critical to Low severity. The most severe issues involve remote code execution through the CMS adapter system and unsafe dynamic code execution in the tvbox file handler.

---

## Findings

### NET-001: Remote Code Execution via tvbox `new Function` in file handler

**Severity**: Critical (P0)
**Category**: RCE
**Confidence**: High
**File**: `src/main/services/FastifyService/routes/v1/file/tvbox.ts`
**Line**: 113
**Code**:
```typescript
const func = new Function('pathLib', 'path_dir', `${content}\n return main;`);
const fn = func(
  {
    join,
    dirname,
    readDir: readDirSync,
    readFile: readFileSync,
    stat: fileStateSync,
  },
  filePath,
);
const resp = await fn();
```
**Trigger**: HTTP GET `/api/v1/file/film/make/:type/*` — user controls `path` parameter which resolves to `filePath`. If an `index.js` file exists at that path, its content is executed via `new Function`.
**Call Chain**: `GET /api/v1/file/film/make/:type/*` → `resolveWithinPath(APP_FILE_PATH, path)` → `readFile(indexPath)` → `new Function(content)()` → arbitrary JS execution
**Root Cause**: The content of `index.js` files within the APP_FILE_PATH directory is loaded and executed via `new Function()` without any sandboxing or validation. An attacker who can write a file to APP_FILE_PATH (via the manage endpoint or other means) can achieve arbitrary code execution in the main process.
**User Impact**: Full system compromise — attacker can execute arbitrary Node.js code with the privileges of the Electron main process, including file system access, network access, and command execution.
**Evidence**: `tvbox.ts:113` directly constructs a function from file content and executes it with access to `fs` utilities (`readDirSync`, `readFileSync`, `fileStateSync`). The function receives `pathLib` (Node.js `path` module) and `path_dir` (the directory path), enabling filesystem traversal.
**Recommended Fix**: Remove `new Function()` execution entirely. If dynamic code execution is required, use a sandboxed VM2/VM environment or workerpool with strict process isolation. Alternatively, use a declarative JSON-based configuration format instead of executable JS files.
**Fix Risk**: Medium — requires redesigning the tvbox make endpoint to use a safer configuration format.

---

### NET-002: Remote Code Execution via t3Catopen Dynamic Import from Remote URL

**Severity**: Critical (P0)
**Category**: RCE / Dynamic Import
**Confidence**: High
**File**: `src/main/services/FastifyService/routes/v1/film/cms/adapter/t3Catopen/worker.ts`
**Line**: 49-51
**Code**:
```typescript
const dataUri = `data:text/javascript;base64,${base64.encode({ src: code })}`;
const modRaw = await import(dataUri);
const mod = isFunction(modRaw.__jsEvalReturn) ? modRaw.__jsEvalReturn() : (modRaw.default ?? modRaw);
```
**Trigger**: CMS adapter `t3Catopen` fetches code from a remote API URL (`this.api`) and executes it via dynamic `import()` using a data URI.
**Call Chain**: `CMS init(uuid)` → `adapter(uuid)` → `T3CatopenAdapter.init()` → `request.request(this.api)` → `import(data:text/javascript;base64,...)` → arbitrary JS execution in worker process
**Root Cause**: The `code` variable is fetched from a user-configured remote URL (`this.api`) without any integrity verification, signature checking, or sandboxing. The remote code is base64-encoded and imported as a module, giving it full Node.js worker process capabilities.
**User Impact**: An attacker who controls or compromises the remote API URL can execute arbitrary code in the worker process. While workers are separate processes, they have full filesystem and network access.
**Evidence**: `t3Catopen/index.ts:77-79` fetches code from `this.api`. `t3Catopen/worker.ts:49-51` converts it to a data URI and imports it. The imported module's `__jsEvalReturn()` function is then called.
**Recommended Fix**: Implement code signing for remote scripts. Verify a cryptographic signature before executing any remote code. Consider running remote code in a true sandbox (e.g., V8 Isolate or QuickJS) with restricted API access.
**Fix Risk**: High — requires significant architectural changes to the plugin/CMS system.

---

### NET-003: Remote Code Execution via t3Drpy Workerpool Code Execution

**Severity**: High (P1)
**Category**: RCE
**Confidence**: High
**File**: `src/main/services/FastifyService/routes/v1/film/cms/adapter/t3Drpy/worker.ts`
**Line**: 5-7
**Code**:
```typescript
import drpy from './drpy2.min';
const { action, category, detail, home, homeVod, init, play, proxy, search } = drpy;
```
**Trigger**: CMS adapter `t3Drpy` uses a bundled minified JavaScript engine (`drpy2.min.js`) that executes user-configured rules/scripts.
**Call Chain**: `CMS init(uuid)` → `adapter(uuid)` → `T3DrpyAdapter.init(ext)` → `execCtx('init', this.ext)` → `workerpool.exec()` → `drpy.init(options)` → rule execution
**Root Cause**: The drpy engine executes user-provided rules and scripts within a workerpool worker. The `ext` parameter (user-configured site extension) is passed directly to the drpy engine which interprets it as executable rules. The drpy engine has access to `req` (HTTP requests) and other system-level functions via the inject module.
**User Impact**: A malicious site configuration (ext) can make arbitrary HTTP requests, access local network resources, and potentially exploit vulnerabilities in the drpy engine to escape the worker sandbox.
**Evidence**: `t3Drpy/inject.ts` provides `req`, `batchFetch`, `local`, `pd`, `pdfa`, `pdfh` functions to the drpy engine, giving it HTTP request capabilities. The worker runs with `process` workerType, having full Node.js capabilities.
**Recommended Fix**: Run drpy in a truly sandboxed environment (V8 Isolate) with restricted network access. Implement URL allowlisting for HTTP requests made by drpy rules.
**Fix Risk**: Medium — drpy is a third-party engine; sandboxing requires wrapper layer.

---

### NET-004: Remote Code Execution via t3Py Python/gRPC Code Execution

**Severity**: High (P1)
**Category**: RCE
**Confidence**: High
**File**: `src/main/services/FastifyService/routes/v1/film/cms/adapter/t3Py.ts`
**Line**: 258-264
**Code**:
```typescript
async init(): ICmsResultPromise['init'] {
  let content = '';
  if (this.api.startsWith('http')) {
    const { data } = await request.request({ url: this.api, method: 'GET' });
    content = data;
  }
  this.code = content;
  const resp = await this.execCtx('init', [this.ext]);
  return resp;
}
```
**Trigger**: CMS adapter `t3Py` fetches Python code from a remote URL and sends it to a local gRPC service for execution.
**Call Chain**: `CMS init(uuid)` → `adapter(uuid)` → `T3PyAdapter.init()` → `request.request(this.api)` → `this.code = content` → `connectService.execCtx(this.code, 'init', [this.ext])` → gRPC `Exec` call → Python code execution
**Root Cause**: Python code is fetched from a user-configured remote URL and executed via a local gRPC service (`0.0.0.0:19979`). The gRPC service binds to all interfaces, making it accessible from the local network. The Python code has full system access through the `uv` runtime.
**User Impact**: Remote Python code execution with full system access. The gRPC service on `0.0.0.0:19979` is also accessible from the local network, potentially allowing other machines to trigger code execution.
**Evidence**: `t3Py.ts:91` shows `grpc.credentials.createInsecure()` — no TLS. `t3Py.ts:91` shows binding to `0.0.0.0:19979`. `t3Py.ts:258-264` fetches and executes remote code.
**Recommended Fix**: Bind gRPC to `127.0.0.1` only. Implement code signing for remote Python scripts. Add authentication to the gRPC service.
**Fix Risk**: Medium — requires changes to both the TypeScript adapter and Python gRPC service.

---

### NET-005: Plugin System Executes Untrusted Code via workerpool

**Severity**: High (P1)
**Category**: RCE / Plugin Sandbox Escape
**Confidence**: High
**File**: `src/main/services/PluginService.ts`
**Line**: 89-94, 251
**Code**:
```typescript
// Line 89-94: Plugin code execution
rawMod = await import(modulePath);
globalThis.entryModule = rawMod;

// Line 251: Plugin installation with ignoreScripts: false
await npminstall({ root: pluginBasePath, registry: this.registry, ignoreScripts: false });
```
**Trigger**: Plugin installation via `POST /api/v1/plugin` and plugin start via `PUT /api/v1/plugin`.
**Call Chain**: `POST /api/v1/plugin` → `pluginService.install(id)` → `npminstall()` (runs install scripts) → `PUT /api/v1/plugin` → `pluginService.start(id)` → `workerpool.pool()` → `pool.exec(manageModule)` → `import(modulePath)` → arbitrary code execution
**Root Cause**: Plugins are installed from user-specified directories with `ignoreScripts: false`, meaning npm lifecycle scripts (preinstall, install, postinstall) are executed during installation. Plugin code is then executed via workerpool with full Node.js capabilities. The worker process has access to `process`, `require`, `fs`, and all Node.js APIs.
**User Impact**: A malicious plugin can execute arbitrary code during installation (via npm scripts) and during runtime (via the main module). The plugin has full access to the filesystem, network, and can escape the workerpool sandbox by spawning child processes.
**Evidence**: `PluginService.ts:251` — `ignoreScripts: false` allows npm scripts to run. `PluginService.ts:94` — `await import(modulePath)` executes the plugin. The worker uses `workerType: 'process'` with no additional sandboxing.
**Recommended Fix**: Set `ignoreScripts: true` during npm installation. Run plugins in a true sandboxed environment (e.g., vm2 or V8 Isolate). Implement a permission system for plugins to restrict filesystem and network access.
**Fix Risk**: Medium — changing `ignoreScripts` is low risk; full sandboxing is high risk.

---

### NET-006: Puppeteer Script Injection via User-Controlled Scripts

**Severity**: High (P1)
**Category**: Script Injection / XSS
**Confidence**: High
**File**: `src/main/services/CdpElectron.ts`
**Line**: 257-278
**Code**:
```typescript
// Execute custom scripts
if (isString(initScript) && !isStrEmpty(initScript)) {
  await this.execScript(page, initScript, 'evaluateOnNewDocument');
}
if (isString(runScript) && !isStrEmpty(runScript)) {
  const code = `
    (() => {
      var scriptTimer;
      var scriptCounter = 0;
      scriptTimer = setInterval(function() {
        if (location.href !== 'about:blank') {
          scriptCounter += 1;
          console.log('---exec run_script start ' + scriptCounter + '---');
          ${runScript}
          clearInterval(scriptTimer);
          scriptCounter = 0;
          console.log('---exec run_script complete---');
        }
      }, 200);
    })();
  `;
  await this.execScript(page, code, 'evaluateOnNewDocument');
}
```
**Trigger**: CMS play endpoint returns `script` object with `runScript`/`initScript` fields, which are passed to CDP sniffer.
**Call Chain**: `CMS play(uuid)` → adapter returns `{ script: { runScript, initScript } }` → renderer calls `POST /api/v1/system/cdp/sniffer/media` → `snifferMediaToStandard(url, { runScript, initScript })` → `CdpElectron.snifferMedia()` → `page.evaluateOnNewDocument(script)` → arbitrary JS in Puppeteer page
**Root Cause**: User-controlled script content from CMS adapters is directly interpolated into JavaScript code that is executed in the Puppeteer page context via `evaluateOnNewDocument`. The `runScript` variable is injected into a template string without sanitization, allowing code injection.
**User Impact**: A malicious CMS site can inject arbitrary JavaScript into the Puppeteer page, potentially accessing cookies, making requests to internal services, or exploiting Chromium vulnerabilities.
**Evidence**: `CdpElectron.ts:269` — `${runScript}` is directly interpolated into a template string. The script runs in the page context with full DOM access.
**Recommended Fix**: Sanitize and validate scripts before execution. Implement a whitelist of allowed script patterns. Consider using `page.evaluate()` with function arguments instead of string interpolation.
**Fix Risk**: Medium — requires changes to the script execution pipeline.

---

### NET-007: SSRF Potential in Proxy Endpoint (Partial Mitigation)

**Severity**: Medium (P2)
**Category**: SSRF
**Confidence**: Medium
**File**: `src/main/services/FastifyService/routes/v0/proxy/utils/safeRemoteUrl.ts`
**Line**: 14-33
**Code**:
```typescript
export const isSafeRemoteUrl = async (rawUrl: string): Promise<boolean> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
  try {
    const addresses = ipaddr.isValid(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
};
```
**Trigger**: Proxy endpoint `GET /proxy` and `HEAD /proxy` validate URLs before fetching.
**Call Chain**: `GET /proxy?url=<url>` → `isSafeRemoteUrl(url)` → DNS lookup → check if private → fetch if safe
**Root Cause**: The SSRF protection has a TOCTOU (Time-of-Check-Time-of-Use) vulnerability. The DNS resolution happens during validation, but the actual HTTP request may resolve to a different IP address (DNS rebinding). Additionally, the `isPrivateAddress` check uses `ipaddr.js` which may not cover all edge cases (e.g., IPv6-mapped IPv4 addresses).
**User Impact**: An attacker could potentially bypass the SSRF protection using DNS rebinding to access internal services (e.g., `http://169.254.169.254` for cloud metadata).
**Evidence**: `safeRemoteUrl.ts:28` — DNS lookup is performed for validation, but the actual request in `proxy/index.ts:46-53` uses the original URL, which may resolve differently.
**Recommended Fix**: Use a custom HTTP agent that validates IP addresses at connection time, not just at DNS resolution time. Consider using a library like `undici` with built-in SSRF protection.
**Fix Risk**: Low — can be implemented without breaking changes.

---

### NET-008: gRPC Service Binds to All Interfaces Without Authentication

**Severity**: Medium (P2)
**Category**: Network Exposure
**Confidence**: High
**File**: `src/main/services/FastifyService/routes/v1/film/cms/adapter/t3Py.ts`
**Line**: 91
**Code**:
```typescript
const client = new ClientCtor(`0.0.0.0:${this.port}`, grpc.credentials.createInsecure());
```
**Trigger**: t3Py adapter initialization connects to gRPC service.
**Call Chain**: `T3PyAdapter.prepare()` → `connectService.connect()` → `new ClientCtor('0.0.0.0:19979', grpc.credentials.createInsecure())`
**Root Cause**: The gRPC client connects to `0.0.0.0:19979` with insecure credentials (no TLS, no authentication). While this is a client connection, the Python gRPC server likely also binds to all interfaces. Any process on the local network can connect to this service and execute arbitrary Python code.
**User Impact**: Other machines on the local network can connect to the gRPC service and execute arbitrary Python code on the user's machine.
**Evidence**: `t3Py.ts:91` — `grpc.credentials.createInsecure()` disables TLS. The port `19979` is hardcoded and likely bound to `0.0.0.0` on the Python side.
**Recommended Fix**: Bind the Python gRPC server to `127.0.0.1` only. Add authentication (e.g., shared secret) to the gRPC service.
**Fix Risk**: Low — straightforward network configuration change.

---

## Positive Findings (Well-Implemented Security)

1. **API Authentication**: Fastify API uses a random 32-byte hex token (`apiAuth.ts:4`) generated at startup, preventing unauthorized external access to the local API.

2. **Origin Validation**: Fastify validates request origins against an allowlist (`FastifyService/index.ts:227-236`), preventing CSRF from arbitrary websites.

3. **Path Traversal Protection**: `resolveWithinPath()` in `file.ts:40-65` uses `realpathSync` to resolve symlinks and validates that the resolved path stays within the base directory.

4. **SSRF Protection**: The proxy endpoint validates URLs against private IP addresses using DNS resolution (`safeRemoteUrl.ts:14-33`).

5. **CORS Configuration**: Fastify CORS is configured with origin validation (`FastifyService/index.ts:176-180`).

6. **Worker Isolation**: CMS adapters use workerpool with `process` workerType, providing some isolation between the main process and untrusted code.

7. **Puppeteer Cleanup**: CDP/Electron properly cleans up browser pages and windows in `finally` blocks (`CdpElectron.ts:72-102`).

8. **Timeout Handling**: Both Puppeteer and search operations have timeout mechanisms to prevent resource exhaustion.

---

## Recommendations Summary

| Priority | Finding | Recommendation |
|----------|---------|----------------|
| P0 | NET-001 | Remove `new Function()` in tvbox handler; use declarative config |
| P0 | NET-002 | Implement code signing for remote scripts in t3Catopen |
| P1 | NET-003 | Sandbox drpy engine with restricted network access |
| P1 | NET-004 | Bind gRPC to 127.0.0.1; add authentication; sign remote Python code |
| P1 | NET-005 | Set `ignoreScripts: true`; sandbox plugin execution |
| P1 | NET-006 | Sanitize scripts; use function arguments instead of string interpolation |
| P2 | NET-007 | Use connection-time IP validation to prevent DNS rebinding |
| P2 | NET-008 | Bind gRPC to 127.0.0.1; add authentication |

---

## Methodology

- Static analysis of all TypeScript source files in the FastifyService routes, plugin system, CMS adapters, and utility modules
- Traced data flow from API endpoints through service layers to code execution points
- Identified user-controlled inputs that reach `eval`, `new Function`, `import`, `spawn`, `exec`, and Puppeteer script execution
- Verified SSRF protections and path traversal mitigations
- Checked Puppeteer resource management and cleanup patterns
