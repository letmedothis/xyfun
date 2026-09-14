# Fix Queue

## Batch 1 - Security Critical (P0)
- [x] NET-001 - RCE via tvbox new Function → FIXED
- [x] NET-002 - RCE via t3Catopen dynamic import → NEEDS_PRODUCT_DECISION

## Batch 2 - Security (P1)
- [x] ELECT-001/002/003/009 - FS IPC path sandboxing → FIXED
- [x] ELECT-004 - Arbitrary process execution via CALL_PLAYER → FIXED
- [x] NET-005 - Plugin ignoreScripts → FIXED
- [x] NET-006 - Puppeteer script injection → PARTIALLY_FIXED

## Batch 3 - Memory / Lifecycle (P1)
- [x] Frontend-1 - Player page IPC listeners never removed → FIXED
- [x] Frontend-2 - Auth IPC listener never removed → FIXED
- [x] Frontend-3 - Setting base IPC listener never removed → FIXED
- [x] Frontend-4 - Search panel emitter listeners never removed → FIXED
- [x] Frontend-5 - AsideFilm emitter listener never removed → FIXED
- [x] Frontend-6 - Test player emitter listener never removed → FIXED
- [x] Frontend-7 - Monaco editor never disposed → FIXED

## Batch 4 - Security (P2)
- [x] ELECT-005 - shell.openPath validation → FIXED
- [x] ELECT-006 - Shell injection in tgz → FIXED
- [x] ELECT-008 - WINDOW_DESTROY sender validation → FIXED

## Batch 5 - Performance (P2)
- [ ] NET-007 - SSRF DNS rebinding → DEFERRED
- [ ] NET-008 - gRPC bind to 127.0.0.1 → DEFERRED
- [x] Frontend-10 - Search association race condition → FIXED
- [x] Frontend-12 - measureText creates canvas on every call → FIXED
- [x] Frontend-14 - App.vue deep watch on reactive object → FIXED
