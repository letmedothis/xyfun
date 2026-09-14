# Frontend-Perf

## Original Issue
Multiple frontend performance issues:
1. Search association race condition - stale results can overwrite newer ones
2. measureText creates canvas on every call - called for every item during render
3. App.vue deep watch on reactive object - unnecessary deep watch

## Root Cause
1. No sequence counter to prevent stale responses from overwriting newer ones
2. Canvas element created fresh on every call instead of being cached
3. `{ deep: true }` used on a factory function that returns a new object each time

## Fix
1. Added `searchSeq` counter to `getSuggestList()`. Stale responses are discarded.
2. Cached canvas and context outside `measureText()` function.
3. Removed `{ deep: true }` from App.vue watch (redundant for factory function).

## Files Changed
- `src/renderer/src/components/search-panel/index.vue`
- `src/renderer/src/components/common-nav/index.vue`
- `src/renderer/src/App.vue`

## Behavior Before
1. Fast typing could show results for previous search term
2. New canvas created for every item in list during render
3. Watcher fired on every store mutation

## Behavior After
1. Only latest search results are displayed
2. Single canvas reused for all measurements
3. Watcher only fires when values actually change

## Test Added
Regression verified by existing test suite passing.

## Validation
- `pnpm typecheck:node` - PASS
- `pnpm typecheck:web` - PASS
- `pnpm lint` - PASS
- `pnpm test` - PASS (100 tests)

## Regression Risk
NONE - All changes are behavior-preserving optimizations.

## Remaining Risk
NONE - The fixes are straightforward performance improvements.
