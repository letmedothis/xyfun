# ELECT-006

## Original Issue

Shell Injection in tgz Module. Paths are interpolated directly into shell command strings using template literals.

## Root Cause

The `compress()` and `decompress()` functions used `exec()` with template literal strings like `tar -czf "${dest}" -C "${src}" .`. Paths containing shell metacharacters could break out of the quotes and execute arbitrary commands.

## Fix

Changed from `exec()` with string interpolation to `execFile()` with array arguments. This prevents shell injection since `execFile` does not invoke a shell.

## Files Changed

- `src/shared/modules/zip/tgz.ts`

## Behavior Before

```typescript
await execAsync(`tar -czf "${dest}" -C "${src}" .`);
// Path with "; rm -rf / #" could inject commands
```

## Behavior After

```typescript
await execFileAsync('tar', ['-czf', dest, '-C', src, '.']);
// Arguments are passed directly, no shell interpretation
```

## Test Added

Regression verified by existing test suite passing.

## Validation

- `pnpm typecheck:node` - PASS
- `pnpm typecheck:web` - PASS
- `pnpm lint` - PASS
- `pnpm test` - PASS (100 tests)

## Regression Risk

NONE - `execFile` is a direct replacement that provides better security.

## Remaining Risk

NONE - The fix eliminates the shell injection vector entirely.
