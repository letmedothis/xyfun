import { execFile, execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { loggerService } from '@logger';
import type { IFileMode } from '@main/utils/file';
import {
  fileChmod,
  fileChmodSync,
  filePermission,
  filePermissionSync,
  pathExist,
  pathExistSync,
} from '@main/utils/file';
import { isWindows, linebreak } from '@main/utils/systemInfo';
import { LOG_MODULE } from '@shared/config/logger';
import { isArray, isArrayEmpty, isPositiveFiniteNumber, isStrEmpty, isString } from '@shared/modules/validate';

const logger = loggerService.withContext(LOG_MODULE.UTIL_PROCESS);
const execFileAsync = promisify(execFile);

/**
 * Get the appropriate binary name based on the operating system.
 * @param name - Base name of the binary.
 * @returns The binary name with the correct extension for the OS.
 */
export function getBinaryName(name: string): string {
  if (isWindows) return `${name}.exe`;
  return name;
}

/**
 * Run a binary script as a child process.
 * @param scriptPath - Path to the script to run.
 * @returns A promise that resolves when the script completes.
 */
export function downBinary(scriptPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    logger.info(`Running script at: ${scriptPath}`);
    let settled = false;

    const nodeProcess = spawn(process.execPath, [scriptPath], {
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: join(process.resourcesPath, 'app.asar', 'node_modules'),
      },
    });

    nodeProcess.stdout.on('data', (data) => {
      logger.info(`Script output: ${data}`);
    });

    nodeProcess.stderr.on('data', (data) => {
      logger.error(`Script error: ${data}`);
    });

    nodeProcess.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        logger.info('Script completed successfully');
        resolve();
      } else {
        logger.warn(`Script exited with code ${code}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    nodeProcess.once('error', (error) => {
      if (settled) return;
      settled = true;
      logger.error('Failed to start script process', error);
      reject(error);
    });
  });
}

/**
 * Set permissions for a binary file.
 * @param binaryPath - Path to the binary file.
 * @param permission - File mode to set.
 * @returns True if permissions were set successfully, false otherwise.
 */
export async function chmodBinary(binaryPath: string, permission: IFileMode): Promise<boolean> {
  if ((await pathExist(binaryPath)) === false) return false;
  if (isWindows) return true;

  try {
    if ((await filePermission(binaryPath)).code !== permission) {
      if (!(await fileChmod(binaryPath, permission))) return false;
      logger.info(`Set executable permissions for binary: ${binaryPath}`);
    }
    return true;
  } catch (error) {
    logger.error(`Failed to set permissions for binary: ${binaryPath}`, error as Error);
    return false;
  }
}

/**
 * Synchronously set permissions for a binary file.
 * @param binaryPath - Path to the binary file.
 * @param permission - File mode to set.
 * @returns True if permissions were set successfully, false otherwise.
 */
export function chmodBinarySync(binaryPath: string, permission: IFileMode): boolean {
  if (pathExistSync(binaryPath) === false) return false;
  if (isWindows) return true;

  try {
    if (filePermissionSync(binaryPath).code !== permission) {
      if (!fileChmodSync(binaryPath, permission)) return false;
      logger.info(`Set executable permissions for binary: ${binaryPath}`);
    }
    return true;
  } catch (error) {
    logger.error(`Failed to set permissions for binary: ${binaryPath}`, error as Error);
    return false;
  }
}

/**
 * match processes by keyword.
 * @param keyword - Keyword to match processes.
 * @returns Array of matched process IDs.
 */
export async function matchPs(keyword: string): Promise<number[]> {
  if (isPositiveFiniteNumber(keyword)) keyword = String(keyword);
  if (!isString(keyword) || isStrEmpty(keyword)) return [];

  const sanitizedKeyword = keyword.replace(/[^\w\s\-./]/g, '');
  if (isStrEmpty(sanitizedKeyword)) return [];

  try {
    const { stdout: output } = isWindows
      ? await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:ZY_PROCESS_KEYWORD) } | Select-Object -ExpandProperty ProcessId',
          ],
          { encoding: 'utf8', env: { ...process.env, ZY_PROCESS_KEYWORD: sanitizedKeyword } },
        )
      : await execFileAsync('pgrep', ['-f', sanitizedKeyword], { encoding: 'utf8' });
    const outputText = String(output);
    if (!outputText) return [];

    const pids = outputText
      .split(linebreak)
      .map((line) => line.trim())
      .map((line) => (/^\d+$/.test(line) ? Number.parseInt(line) : null))
      .filter((pid): pid is number => pid !== null);

    const equalPids = [...new Set(pids)];
    logger.debug(`Matched PIDs: ${equalPids.join(', ')}`);

    return equalPids;
  } catch (error) {
    logger.error(`Failed to match process: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Synchronously match processes by keyword.
 * @param keyword - Keyword to match processes.
 * @returns Array of matched process IDs.
 */
export function matchPsSync(keyword: string): number[] {
  if (isPositiveFiniteNumber(keyword)) keyword = String(keyword);
  if (!isString(keyword) || isStrEmpty(keyword)) return [];

  const sanitizedKeyword = keyword.replace(/[^\w\s\-./]/g, '');
  if (isStrEmpty(sanitizedKeyword)) return [];

  try {
    const output = isWindows
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:ZY_PROCESS_KEYWORD) } | Select-Object -ExpandProperty ProcessId',
          ],
          { encoding: 'utf8', env: { ...process.env, ZY_PROCESS_KEYWORD: sanitizedKeyword } },
        )
      : execFileSync('pgrep', ['-f', sanitizedKeyword], { encoding: 'utf8' });
    if (!output) return [];

    const pids = output
      .split(linebreak)
      .map((line) => line.trim())
      .map((line) => (/^\d+$/.test(line) ? Number.parseInt(line) : null))
      .filter((pid): pid is number => pid !== null);

    const equalPids = [...new Set(pids)];
    logger.debug(`Matched PIDs: ${equalPids.join(', ')}`);

    return equalPids;
  } catch (error) {
    logger.error(`Failed to match process: ${(error as Error).message}`);
    return [];
  }
}

/**
 * match processes by port.
 * @param port - Port number to match processes.
 * @returns Array of process IDs listening on the specified port.
 */
export async function matchPort(port: number): Promise<number[]> {
  if (isString(port) && !isStrEmpty(port)) port = Number.parseInt(String(port), 10);
  if (!isPositiveFiniteNumber(port)) return [];

  try {
    const { stdout: output } = isWindows
      ? await execFileAsync('netstat', ['-ano'], { encoding: 'utf8' })
      : await execFileAsync('lsof', ['-i', `:${port}`, '-sTCP:LISTEN', '-P', '-n', '-t'], { encoding: 'utf8' });
    const outputText = String(output);
    const filteredOutput = isWindows
      ? outputText
          .split(linebreak)
          .filter((line) => line.includes(`:${port}`) && line.toUpperCase().includes('LISTENING'))
          .map((line) => line.trim().split(/\s+/).at(-1) || '')
          .join('\n')
      : outputText;
    if (!filteredOutput) return [];

    const pids = filteredOutput
      .split(linebreak)
      .map((line) => line.trim())
      .map((line) => (/^\d+$/.test(line) ? Number.parseInt(line) : null))
      .filter((pid): pid is number => pid !== null);

    const equalPids = [...new Set(pids)];
    logger.debug(`Matched PIDs: ${equalPids.join(', ')}`);

    return equalPids;
  } catch (error) {
    logger.error(`Failed to match process: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Synchronously match processes by port.
 * @param port - Port number to match processes.
 * @returns Array of process IDs listening on the specified port.
 */
export function matchPortSync(port: number): number[] {
  if (isString(port) && !isStrEmpty(port)) port = Number.parseInt(String(port), 10);
  if (!isPositiveFiniteNumber(port)) return [];

  try {
    const output = isWindows
      ? execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
          .split(linebreak)
          .filter((line) => line.includes(`:${port}`) && line.toUpperCase().includes('LISTENING'))
          .map((line) => line.trim().split(/\s+/).at(-1) || '')
          .join('\n')
      : execFileSync('lsof', ['-i', `:${port}`, '-sTCP:LISTEN', '-P', '-n', '-t'], { encoding: 'utf8' });
    if (!output) return [];

    const pids = output
      .split(linebreak)
      .map((line) => line.trim())
      .map((line) => (/^\d+$/.test(line) ? Number.parseInt(line) : null))
      .filter((pid): pid is number => pid !== null);

    const equalPids = [...new Set(pids)];
    logger.debug(`Matched PIDs: ${equalPids.join(', ')}`);

    return equalPids;
  } catch (error) {
    logger.error(`Failed to match process: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Kill processes by their PIDs.
 * @param pids - Array of process IDs to kill.
 * @returns True if all processes were killed successfully, false otherwise.
 */
export async function killPid(pids: number[]): Promise<boolean> {
  if (!isArray(pids) || isArrayEmpty(pids)) return true;

  try {
    const validPids = pids.filter((pid) => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
    if (isArrayEmpty(validPids)) return true;

    if (isWindows) await execFileAsync('taskkill', [...validPids.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F']);
    else await execFileAsync('kill', ['-9', ...validPids.map(String)]);
    return true;
  } catch (error) {
    logger.error('Failed to kill process:', error as Error);
    return false;
  }
}

/**
 * Synchronously kill processes by their PIDs.
 * @param pids - Array of process IDs to kill.
 * @returns True if all processes were killed successfully, false otherwise.
 */
export function killPidSync(pids: number[]): boolean {
  if (!isArray(pids) || isArrayEmpty(pids)) return true;

  try {
    const validPids = pids.filter((pid) => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
    if (isArrayEmpty(validPids)) return true;

    if (isWindows) {
      execFileSync('taskkill', [...validPids.flatMap((pid) => ['/PID', String(pid)]), '/T', '/F'], { stdio: 'ignore' });
    } else {
      execFileSync('kill', ['-9', ...validPids.map(String)], { stdio: 'ignore' });
    }
    return true;
  } catch (error) {
    logger.error('Failed to kill process:', error as Error);
    return false;
  }
}

/**
 * Determine if PowerShell is available on Windows system.
 * @returns True if PowerShell is available, false otherwise.
 */
export async function isWindowsPowerShell(): Promise<boolean> {
  try {
    await execFileAsync('where', ['powershell']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronously determine if PowerShell is available on Windows system.
 * @returns True if PowerShell is available, false otherwise.
 */
export function isWindowsPowerShellSync(): boolean {
  try {
    execFileSync('where', ['powershell'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
