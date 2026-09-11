import type { ChildProcessByStdio } from 'node:child_process';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Stream } from 'node:stream';
import { promisify } from 'node:util';

import { loggerService } from '@logger';
import { appLocale } from '@main/services/AppLocale';
import { pathExist } from '@main/utils/file';
import { HOME_BIN_PATH } from '@main/utils/path';
import { chmodBinary, getBinaryName, killPid, matchPort, matchPs } from '@main/utils/process';
import { LOG_MODULE } from '@shared/config/logger';
import { isArray, isArrayEmpty } from '@shared/modules/validate';

const logger = loggerService.withContext(LOG_MODULE.PYTHON);
const execFileAsync = promisify(execFile);

export interface IPythonOptions {
  projectBasePath: string;
}

export class PythonService {
  projectBasePath: string;
  pyprojectTomlPath: string;
  requirementsPath: string;
  registry: string;

  uvBinaryPath: string;
  isUvBinaryCheck: boolean = false;
  isPipCheck: boolean = false;

  childProcess: ChildProcessByStdio<null, Stream.Readable, Stream.Readable> | null = null;

  constructor(options: IPythonOptions) {
    this.projectBasePath = options.projectBasePath;
    this.pyprojectTomlPath = join(this.projectBasePath, 'pyproject.toml');
    this.requirementsPath = join(this.projectBasePath, 'requirements.txt');
    this.uvBinaryPath = join(HOME_BIN_PATH, getBinaryName('uv'));
    this.registry = appLocale.isCHS() ? 'https://mirrors.aliyun.com/pypi/simple' : 'https://pypi.org/simple';
  }

  async checkBinary(): Promise<boolean> {
    if (this.isUvBinaryCheck) return true;

    try {
      if (!(await pathExist(this.uvBinaryPath))) {
        this.isUvBinaryCheck = false;
        return false;
      }

      if (!(await chmodBinary(this.uvBinaryPath, 0o755))) {
        this.isUvBinaryCheck = false;
        return false;
      }

      this.isUvBinaryCheck = true;
      return true;
    } catch (error) {
      logger.error('Failed to check uv binary:', error as Error);
      this.isUvBinaryCheck = false;
      return false;
    }
  }

  async matchProcess(kw: string): Promise<number[]> {
    return await matchPs(kw);
  }

  async matchPort(port: number): Promise<number[]> {
    return await matchPort(port);
  }

  async killProcess(pids: number[]): Promise<boolean> {
    return await killPid(pids);
  }

  async pipInstall(pkgs: string[] = []): Promise<boolean> {
    const isPkgs = isArray(pkgs) && !isArrayEmpty(pkgs);

    try {
      const isPipCheck = await this.pipCheck(pkgs);
      if (isPipCheck) {
        logger.info('Pip dependencies are already satisfied');
        return true;
      }

      let cmdArgs: string[] = [];

      if (isPkgs) {
        cmdArgs = [this.uvBinaryPath, 'pip', 'install', ...pkgs, '-i', this.registry];
      } else if (await pathExist(this.pyprojectTomlPath)) {
        cmdArgs = [this.uvBinaryPath, 'sync', '--native-tls', '--default-index', this.registry];
      } else if (await pathExist(this.requirementsPath)) {
        cmdArgs = [this.uvBinaryPath, 'pip', 'install', '-r', 'requirements.txt', '-i', this.registry];
      }

      if (!cmdArgs.length) {
        logger.warn('No pip dependencies should be installed');
        if (!isPkgs) this.isPipCheck = true;
        return true;
      }

      const [command, ...args] = cmdArgs;
      logger.debug(`Install pip dependencies with command: ${cmdArgs.join(' ')}`);

      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd: this.projectBasePath,
        });

        if (stdout) logger.debug(stdout.toString());
        if (stderr) logger.debug(stderr.toString());

        if (!isPkgs) this.isPipCheck = true;
        return true;
      } catch {
        if (!isPkgs) this.isPipCheck = false;
        return false;
      }
    } catch (error) {
      logger.error('Failed to install dependencies:', error as Error);
      if (!isPkgs) this.isPipCheck = false;
      throw error;
    }
  }

  async pipCheck(pkgs: string[] = []): Promise<boolean> {
    const isPkgs = isArray(pkgs) && !isArrayEmpty(pkgs);
    if (!isPkgs && this.isPipCheck) return true;

    try {
      let cmdArgs: string[] = [];

      if (isPkgs) {
        cmdArgs = [this.uvBinaryPath, 'pip', 'show', ...pkgs];
      } else if (await pathExist(this.pyprojectTomlPath)) {
        cmdArgs = [this.uvBinaryPath, 'sync', '--dry-run', '--native-tls', '--default-index', this.registry];
      } else if (await pathExist(this.requirementsPath)) {
        cmdArgs = [
          this.uvBinaryPath,
          'pip',
          'install',
          '-r',
          'requirements.txt',
          '--dry-run',
          '--strict',
          '-i',
          this.registry,
        ];
      }

      if (!cmdArgs.length) {
        logger.warn('No pip dependencies should be checked');
        if (!isPkgs) this.isPipCheck = true;
        return true;
      }

      const [command, ...args] = cmdArgs;
      logger.debug(`Check pip dependencies with command: ${cmdArgs.join(' ')}`);

      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd: this.projectBasePath,
        });

        if (stdout) logger.debug(stdout.toString());
        if (stderr) logger.debug(stderr.toString());

        if (!isPkgs) this.isPipCheck = true;
        return true;
      } catch {
        if (!isPkgs) this.isPipCheck = false;
        return false;
      }
    } catch (error) {
      logger.error('Failed to check dependencies:', error as Error);
      if (!isPkgs) this.isPipCheck = false;
      throw error;
    }
  }

  runSpawn(
    args: string[] = [],
    venv: boolean = false,
    cb: {
      stdoutCb?: (data: string) => void;
      stderrCb?: (data: string) => void;
      errorCb?: (error: Error) => void;
      closeCb?: (code: number | null) => void;
    } = {},
  ): void {
    try {
      if (this.childProcess && !this.childProcess.killed) {
        logger.warn('Stopping the previous Python process before starting a new one');
        this.childProcess.kill();
        this.childProcess = null;
      }

      logger.debug(`Spawning Python process with args: ${args.join(' ')}`);

      const cmd = ['run', ...(venv ? ['--active'] : []), ...args];
      const child = spawn(this.uvBinaryPath, cmd, {
        cwd: this.projectBasePath,
        detached: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      this.childProcess = child;

      child.stdout.on('data', (data) => {
        cb?.stdoutCb?.(data.toString());
      });

      child.stderr.on('data', (data) => {
        cb?.stderrCb?.(data.toString());
      });

      child.on('error', (error) => {
        cb?.errorCb?.(error);
      });

      child.on('close', (code) => {
        if (this.childProcess === child) this.childProcess = null;
        cb?.closeCb?.(code);
      });
    } catch (error) {
      logger.error('Error while starting Python process:', error as Error);
      throw error;
    }
  }

  async runExec(args: string[], venv: boolean = false): Promise<{ stdout: string; stderr: string }> {
    try {
      const cmd = ['run', ...(venv ? ['--active'] : []), ...args];
      const { stdout, stderr } = await execFileAsync(this.uvBinaryPath, cmd, {
        cwd: this.projectBasePath,
        windowsHide: true,
        encoding: 'utf-8',
      });
      return { stdout: stdout.toString().trim(), stderr: stderr.toString().trim() };
    } catch (error) {
      logger.error('Failed to run Python script:', error as Error);
      throw error;
    }
  }

  runExecSync(args: string[], venv: boolean = false): { stdout: string; stderr: string } {
    try {
      const cmd = ['run', ...(venv ? ['--active'] : []), ...args];
      const output = execFileSync(this.uvBinaryPath, cmd, {
        cwd: this.projectBasePath,
        windowsHide: true,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout: output.trim(), stderr: '' };
    } catch (error) {
      logger.error('Failed to run Python script synchronously:', error as Error);
      throw error;
    }
  }
}
