import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { once } from 'events';
import getPort from 'get-port';
import { ensureCLIProxyBinary } from '../../../src/cliproxy/binary-manager';
import { spawnProxy } from '../../../src/cliproxy/executor/lifecycle-manager';
import { ensureCliproxyService, stopCliproxyService } from '../../../src/cliproxy/service-manager';
import { getCcsDir } from '../../../src/utils/config-manager';

describe.skipIf(process.platform === 'win32')('local CLIProxy execution', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let testHome: string;
  let marker: string;
  let binaryPath: string;
  let port: number;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-local-proxy-execution-'));
    process.env.CCS_HOME = testHome;
    process.env.CLAUDE_CONFIG_DIR = path.join(testHome, '.claude');
    delete process.env.CCS_DIR;
    delete process.env.CCS_CONFIG;
    marker = path.join(testHome, 'executed.json');
    binaryPath = path.join(testHome, 'custom proxy');
    port = await getPort();
    fs.writeFileSync(
      binaryPath,
      `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ args, pid: process.pid, writablePath: process.env.WRITABLE_PATH }));
require('net').createServer(socket => socket.end()).listen(${port}, '127.0.0.1');
`,
      { mode: 0o755 }
    );
    process.env.CCS_CLIPROXY_BINARY = binaryPath;
  });

  afterEach(async () => {
    stopCliproxyService();
    if (fs.existsSync(marker)) {
      const { pid } = JSON.parse(fs.readFileSync(marker, 'utf8'));
      // The dashboard process is detached; terminate and wait for our own fixture only.
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already exited */
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          process.kill(pid, 0);
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    process.env = savedEnv;
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  it('executes the override through the CLI spawn path without installing a managed binary', async () => {
    const resolvedPath = await ensureCLIProxyBinary(false, { allowInstall: false });
    const configPath = path.join(testHome, 'config.yaml');
    fs.writeFileSync(configPath, `port: ${port}\n`);
    const child = spawnProxy(resolvedPath, configPath, false);
    try {
      for (let attempt = 0; attempt < 100 && !fs.existsSync(marker); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(fs.existsSync(marker)).toBe(true);
      expect(JSON.parse(fs.readFileSync(marker, 'utf8')).args).toEqual(['--config', configPath]);
      expect(fs.existsSync(path.join(getCcsDir(), 'cliproxy', 'bin'))).toBe(false);
    } finally {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  });

  it('starts the dashboard background service using the override when managed binaries are absent', async () => {
    const result = await ensureCliproxyService(port, false, {
      detectRunningProxyFn: async () => ({ running: false, verified: false }),
      configNeedsRegenerationFn: () => false,
      withStartupLockFn: async (operation) => operation(),
    });
    expect(result).toMatchObject({ started: true, alreadyRunning: false, port });
    const executed = JSON.parse(fs.readFileSync(marker, 'utf8'));
    expect(executed.args[0]).toBe('--config');
    expect(executed.args[1].startsWith(getCcsDir())).toBe(true);
    expect(executed.writablePath.startsWith(getCcsDir())).toBe(true);
    expect(fs.existsSync(path.join(getCcsDir(), 'cliproxy', 'bin'))).toBe(false);
  });
});
