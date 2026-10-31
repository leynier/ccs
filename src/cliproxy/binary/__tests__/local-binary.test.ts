import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { getLocalBinaryPath } from '../local-binary';
import { ensureBinary } from '../lifecycle';
import { deleteBinary, downloadAndInstall } from '../installer';
import {
  BinaryManager,
  checkCliproxyUpdate,
  ensureCLIProxyBinary,
  getCLIProxyPath,
  getInstalledCliproxyVersion,
  installCliproxyVersion,
  isCLIProxyInstalled,
} from '../../binary-manager';
import { getBinaryStatus, installLatest, installVersion } from '../../services/binary-service';
import { savePinnedVersion, getVersionPinPath } from '../version-cache';
import { getExecutableName } from '../platform-detector';
import { getCcsDir } from '../../../utils/config-manager';
import { installDashboardCliproxyVersion } from '../../../web-server/services/cliproxy-dashboard-install-service';
import { resolveCliproxyVersionsPayload } from '../../../web-server/routes/cliproxy-stats-routes/version-helpers';
import statsRouter from '../../../web-server/routes/cliproxy-stats-routes/router';

describe('CCS_CLIPROXY_BINARY', () => {
  let testHome: string;
  let binaryPath: string;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-local-binary-'));
    process.env.CCS_HOME = testHome;
    delete process.env.CCS_DIR;
    delete process.env.CCS_CONFIG;
    binaryPath = path.join(testHome, 'custom proxy');
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.CCS_CLIPROXY_BINARY = binaryPath;
  });

  afterEach(() => {
    mock.restore();
    process.env = savedEnv;
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  it.each(['', 'relative/proxy', '~/proxy'])(
    'rejects non-absolute value %j without fallback',
    async (value) => {
      process.env.CCS_CLIPROXY_BINARY = value;
      await expect(ensureCLIProxyBinary()).rejects.toThrow('must be an absolute path');
      expect(() => getCLIProxyPath()).toThrow('unset it to use CCS-managed binaries');
      expect(fs.existsSync(getCcsDir())).toBe(false);
    }
  );

  it('rejects missing files and directories', async () => {
    process.env.CCS_CLIPROXY_BINARY = path.join(testHome, 'missing');
    await expect(ensureCLIProxyBinary()).rejects.toThrow('file cannot be accessed');
    process.env.CCS_CLIPROXY_BINARY = testHome;
    await expect(ensureCLIProxyBinary()).rejects.toThrow('regular file');
  });

  it.skipIf(process.platform === 'win32')('rejects a non-executable file', () => {
    fs.chmodSync(binaryPath, 0o644);
    expect(() => getLocalBinaryPath()).toThrow('chmod +x');
  });

  it.skipIf(process.platform === 'win32')(
    'accepts symlinks to executables and revalidates after removal',
    () => {
      const link = path.join(testHome, 'proxy-link');
      fs.symlinkSync(binaryPath, link);
      process.env.CCS_CLIPROXY_BINARY = link;
      expect(getLocalBinaryPath()).toBe(link);
      fs.unlinkSync(binaryPath);
      expect(() => getLocalBinaryPath()).toThrow('file cannot be accessed');
    }
  );

  it('bypasses downloads, update checks, pins and runtime install restrictions for both backends', async () => {
    const network = spyOn(https, 'get').mockImplementation(() => {
      throw new Error('unexpected network');
    });
    const download = mock(async () => {
      throw new Error('unexpected download');
    });
    const check = mock(async () => {
      throw new Error('unexpected update check');
    });
    for (const backend of ['original', 'plus'] as const) {
      savePinnedVersion('1.2.3', backend);
      const pinPath = getVersionPinPath(backend);
      const pinBefore = fs.readFileSync(pinPath, 'utf8');
      const config = {
        binPath: path.join(testHome, 'managed', backend),
        version: '1.2.3',
        releaseUrl: 'https://example.invalid',
        maxRetries: 1,
        verbose: false,
        forceVersion: true,
        skipAutoUpdate: false,
        allowInstall: false,
        backend,
        checkForUpdatesFn: check,
      };
      expect(await ensureBinary(config, { downloadAndInstallFn: download })).toBe(binaryPath);
      expect(await new BinaryManager(config, backend).ensureBinary()).toBe(binaryPath);
      expect(await ensureCLIProxyBinary(false, { backend, allowInstall: false })).toBe(binaryPath);
      expect(getCLIProxyPath(backend)).toBe(binaryPath);
      expect(isCLIProxyInstalled(backend)).toBe(true);
      expect(fs.readFileSync(pinPath, 'utf8')).toBe(pinBefore);
      expect(fs.existsSync(config.binPath)).toBe(false);
      fs.mkdirSync(config.binPath, { recursive: true });
      const managedPath = path.join(config.binPath, getExecutableName(backend));
      fs.writeFileSync(managedPath, 'existing managed binary');
      expect(
        await ensureBinary({ ...config, forceVersion: false }, { downloadAndInstallFn: download })
      ).toBe(binaryPath);
      expect(fs.readFileSync(managedPath, 'utf8')).toBe('existing managed binary');
    }
    expect(network).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('does not migrate the legacy shared pin during startup', async () => {
    const sharedPin = path.join(getCcsDir(), 'cliproxy', 'bin', '.version-pin');
    fs.mkdirSync(path.dirname(sharedPin), { recursive: true });
    fs.writeFileSync(sharedPin, '1.2.3');
    await ensureCLIProxyBinary();
    expect(fs.readFileSync(sharedPin, 'utf8')).toBe('1.2.3');
    expect(fs.existsSync(getVersionPinPath('original'))).toBe(false);
  });

  it('reports local source and unknown version without attributing managed metadata', async () => {
    savePinnedVersion('1.2.3', 'original');
    const network = spyOn(https, 'get').mockImplementation(() => {
      throw new Error('unexpected network');
    });
    const manager = new BinaryManager({}, 'original');
    expect(getInstalledCliproxyVersion('original')).toBe('unknown');
    expect(await manager.getBinaryInfo()).toMatchObject({
      path: binaryPath,
      version: 'unknown',
      source: 'local',
    });
    expect(getBinaryStatus('original')).toMatchObject({
      source: 'local',
      managedUpdates: false,
      binaryPath,
      installed: true,
      currentVersion: null,
      pinnedVersion: null,
    });
    expect(await checkCliproxyUpdate('original')).toMatchObject({
      source: 'local',
      managedUpdates: false,
      binaryPath,
      backend: 'original',
      hasUpdate: false,
      currentVersion: 'unknown',
      isStable: false,
    });
    const fetchVersions = mock(async () => {
      throw new Error('unexpected release listing');
    });
    expect(
      await resolveCliproxyVersionsPayload('original', { fetchAllVersionsFn: fetchVersions })
    ).toMatchObject({
      source: 'local',
      managedUpdates: false,
      versions: [],
      currentVersion: 'unknown',
    });
    expect(fetchVersions).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects managed mutations before network, stopping services, or changing binaries and pins', async () => {
    savePinnedVersion('1.2.3', 'original');
    const pinPath = getVersionPinPath('original');
    const before = fs.readFileSync(binaryPath);
    const stop = mock(async () => ({ stopped: true }));
    const lock = mock(async () => {
      throw new Error('unexpected lock');
    });
    await expect(
      installCliproxyVersion('6.9.45', false, 'original', { stopProxyFn: stop })
    ).rejects.toThrow('unset CCS_CLIPROXY_BINARY');
    await expect(
      installDashboardCliproxyVersion('6.9.45', 'original', {
        getProxyStatus: () => ({ running: true }),
        isCliproxyRunning: async () => true,
        installCliproxyVersion: async () => {
          throw new Error('unexpected install');
        },
        ensureCliproxyService: async () => {
          throw new Error('unexpected restart');
        },
        withInstallLifecycleLock: lock,
      })
    ).rejects.toThrow('unset CCS_CLIPROXY_BINARY');
    expect(await installVersion('6.9.45', false, 'original')).toMatchObject({
      success: false,
      error: expect.stringContaining('CCS_CLIPROXY_BINARY'),
    });
    expect(await installLatest(false, 'original')).toMatchObject({
      success: false,
      error: expect.stringContaining('CCS_CLIPROXY_BINARY'),
    });
    expect(() => new BinaryManager({}, 'original').deleteBinary()).toThrow('disabled');
    expect(() => deleteBinary(testHome)).toThrow('disabled');
    const config = {
      binPath: testHome,
      version: '6.9.45',
      releaseUrl: '',
      maxRetries: 1,
      verbose: false,
      forceVersion: true,
      skipAutoUpdate: false,
      allowInstall: true,
      replaceExisting: true,
    };
    await expect(ensureBinary(config)).rejects.toThrow('disabled');
    await expect(downloadAndInstall(config)).rejects.toThrow('disabled');
    expect(stop).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(fs.readFileSync(binaryPath)).toEqual(before);
    expect(fs.readFileSync(pinPath, 'utf8')).toContain('1.2.3');
  });

  it('restores managed selection and its existing pin when the override is unset', async () => {
    savePinnedVersion('1.2.3', 'original');
    const binDir = path.join(getCcsDir(), 'cliproxy', 'bin', 'original');
    const managedPath = path.join(binDir, getExecutableName('original'));
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(managedPath, 'managed binary');
    fs.writeFileSync(path.join(binDir, '.version'), '1.2.3');
    delete process.env.CCS_CLIPROXY_BINARY;
    expect(await ensureCLIProxyBinary(false, { backend: 'original', allowInstall: false })).toBe(
      managedPath
    );
    expect(getBinaryStatus('original')).toMatchObject({
      source: 'managed',
      managedUpdates: true,
      currentVersion: '1.2.3',
      pinnedVersion: '1.2.3',
    });
  });

  it('returns an actionable HTTP 409 for dashboard installs, even with force=true', async () => {
    const handler = statsRouter.stack.find((layer) => layer.route?.path === '/install').route
      .stack[0].handle;
    const response = {
      status: mock(function (this: unknown, _code: number) {
        return this;
      }),
      json: mock(),
    };
    await handler({ body: { version: '6.9.45', force: true } }, response);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining('unset CCS_CLIPROXY_BINARY'),
    });
    expect(fs.existsSync(getCcsDir())).toBe(false);
  });
});
