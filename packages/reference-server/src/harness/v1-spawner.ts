/**
 * v2.2 harness — v1 server auto-spawner.
 *
 * Boots v1's `test-harness/server.js` as a child process on :3847 so
 * the v2.2 "V1 Legacy" mode can reverse-proxy /v1-api/* to it. This
 * saves us porting v1's 30+ convention-based merchant routes into
 * TypeScript — v1's own server handles them authentically.
 *
 * Lifecycle:
 *   1. On v2.2 reference-server boot (when env.harnessMode=true), call
 *      `ensureV1Running()` which probes :3847/api/health.
 *   2. If already running, record the fact and skip spawn.
 *   3. If not running, spawn `node server.js` with cwd set to the v1
 *      test-harness directory, pipe stdout/stderr to a ring buffer,
 *      and wait up to 10s for /api/health to return 200.
 *   4. On SIGTERM/SIGINT/process exit, SIGTERM the child and wait 3s
 *      before SIGKILL.
 *
 * If the v1 directory doesn't exist or spawn fails, V1 mode reports
 * the failure via /v2/harness/v1-status — the rest of the harness is
 * unaffected.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const V1_PORT = 3847;
const V1_DIR = resolve(__dirname, '..', '..', '..', '..', '..', 'test-harness');
const V1_ENTRY = resolve(V1_DIR, 'server.js');
const LOG_BUFFER_SIZE = 200;

export interface V1SpawnerStatus {
  spawned: boolean;
  /** 'starting' | 'running' | 'failed' | 'external' | 'not-configured' */
  status: 'starting' | 'running' | 'failed' | 'external' | 'not-configured';
  pid: number | null;
  port: number;
  uptime: number; // seconds
  error?: string;
  /** true when v1 was already running on :3847 before we probed it. */
  external?: boolean;
}

class V1Spawner {
  private child: ChildProcess | null = null;
  private startedAt: number | null = null;
  private status: V1SpawnerStatus['status'] = 'not-configured';
  private errorMessage: string | null = null;
  private isExternal = false;
  private logBuffer: string[] = [];

  async ensureRunning(): Promise<V1SpawnerStatus> {
    // 1. Probe :3847 first — if v1 is already running externally, we just
    //    use it and do NOT spawn a duplicate.
    const externalAlive = await this.probeHealth();
    if (externalAlive) {
      this.isExternal = true;
      this.startedAt = Date.now();
      this.status = 'running';
      this.errorMessage = null;
      this.pushLog('[spawner] v1 detected running externally on :3847');
      return this.getStatus();
    }

    // 2. Check the v1 directory + entry file exist.
    if (!existsSync(V1_ENTRY)) {
      this.status = 'not-configured';
      this.errorMessage = `v1 server.js not found at ${V1_ENTRY}`;
      this.pushLog('[spawner] ' + this.errorMessage);
      return this.getStatus();
    }

    // 3. Spawn the child process.
    this.status = 'starting';
    this.errorMessage = null;
    this.pushLog(`[spawner] spawning node ${V1_ENTRY}`);

    try {
      this.child = spawn('node', [V1_ENTRY], {
        cwd: V1_DIR,
        env: { ...process.env, PORT: String(V1_PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.startedAt = Date.now();

      this.child.stdout?.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) this.pushLog('[v1] ' + line);
        }
      });
      this.child.stderr?.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) this.pushLog('[v1 err] ' + line);
        }
      });
      this.child.on('exit', (code, signal) => {
        this.pushLog(`[spawner] v1 child exited code=${code} signal=${signal}`);
        this.status = 'failed';
        this.errorMessage = `v1 child exited: code=${code} signal=${signal}`;
        this.child = null;
      });
      this.child.on('error', (err) => {
        this.pushLog(`[spawner] v1 spawn error: ${err.message}`);
        this.status = 'failed';
        this.errorMessage = err.message;
      });
    } catch (err) {
      this.status = 'failed';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.pushLog('[spawner] spawn threw: ' + this.errorMessage);
      return this.getStatus();
    }

    // 4. Wait up to 10s for /api/health to respond.
    const ok = await this.waitForHealth(10_000);
    if (ok) {
      this.status = 'running';
      this.pushLog(`[spawner] v1 ready on :${V1_PORT}`);
    } else {
      this.status = 'failed';
      this.errorMessage = this.errorMessage ?? 'timeout waiting for /api/health';
      this.pushLog('[spawner] ' + this.errorMessage);
    }
    return this.getStatus();
  }

  async probeHealth(): Promise<boolean> {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 500);
      const res = await fetch(`http://127.0.0.1:${V1_PORT}/api/health`, { signal: ac.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.probeHealth()) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  private pushLog(line: string): void {
    const ts = new Date().toISOString();
    this.logBuffer.push(`${ts} ${line}`);
    if (this.logBuffer.length > LOG_BUFFER_SIZE) {
      this.logBuffer.splice(0, this.logBuffer.length - LOG_BUFFER_SIZE);
    }
  }

  getStatus(): V1SpawnerStatus {
    const isRunning = this.status === 'running';
    return {
      spawned: isRunning,
      status: this.status,
      pid: this.child?.pid ?? null,
      port: V1_PORT,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      error: this.errorMessage ?? undefined,
      external: this.isExternal || undefined,
    };
  }

  getLogs(tail = 50): string[] {
    return this.logBuffer.slice(-tail);
  }

  async stop(): Promise<void> {
    if (!this.child || this.isExternal) return;
    this.pushLog('[spawner] stopping v1 child');
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (this.child && Date.now() < deadline) {
      if (this.child.killed || this.child.exitCode != null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.child && !this.child.killed) {
      this.pushLog('[spawner] SIGKILL');
      this.child.kill('SIGKILL');
    }
    this.child = null;
  }

  hasV1Directory(): boolean {
    return existsSync(V1_ENTRY);
  }

  get v1Port(): number {
    return V1_PORT;
  }
}

export const v1Spawner = new V1Spawner();
