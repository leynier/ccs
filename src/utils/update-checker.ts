/**
 * Update Checker - Check for new CCS versions from npm registry or GitHub
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { getCcsDir } from './config-manager';

const CACHE_DIR = path.join(getCcsDir(), 'cache');
const UPDATE_CHECK_FILE = path.join(CACHE_DIR, 'update-check.json');
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const GITHUB_API_URL = 'https://api.github.com/repos/kaitranntt/ccs/releases/latest';
const NPM_REGISTRY_BASE = 'https://registry.npmjs.org/@kaitranntt/ccs';
const REQUEST_TIMEOUT = 5000; // 5 seconds

interface UpdateCache {
  last_check: number;
  latest_version: string | null;
  dev_version: string | null; // Version for @dev tag
  dismissed_version: string | null;
}

export interface UpdateResult {
  status: 'update_available' | 'no_update' | 'check_failed';
  reason?: string;
  latest?: string;
  current?: string;
  message?: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null; // e.g., 'dev'
  prereleaseNum: number | null; // e.g., 3 for '-dev.3'
}

/**
 * Parse version string into components
 */
function parseVersion(version: string): ParsedVersion {
  // Remove leading 'v' if present
  const cleaned = version.replace(/^v/, '');

  // Match: X.Y.Z or X.Y.Z-prerelease.N
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/i);

  if (!match) {
    // Fallback for invalid versions
    return { major: 0, minor: 0, patch: 0, prerelease: null, prereleaseNum: null };
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    prereleaseNum: match[5] ? parseInt(match[5], 10) : null,
  };
}

/**
 * Compare semantic versions
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Compare versions with prerelease support
 *
 * Prerelease convention: X.Y.Z-dev.N is a development version AFTER X.Y.Z
 * For example: 6.7.1-dev.3 > 6.7.1 (dev version is work toward next release)
 *
 * @returns 1 if v1 > v2 (upgrade), -1 if v1 < v2 (downgrade), 0 if equal
 */
export function compareVersionsWithPrerelease(v1: string, v2: string): number {
  const p1 = parseVersion(v1);
  const p2 = parseVersion(v2);

  // Compare base version (major.minor.patch)
  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

  // Same base version - check prerelease
  // Prerelease (dev) > Release: 6.7.1-dev.3 > 6.7.1 (dev is work AFTER release)
  if (p1.prerelease !== null && p2.prerelease === null) return 1;
  if (p1.prerelease === null && p2.prerelease !== null) return -1;

  // Both are prereleases - compare prerelease numbers
  if (p1.prereleaseNum !== null && p2.prereleaseNum !== null) {
    if (p1.prereleaseNum > p2.prereleaseNum) return 1;
    if (p1.prereleaseNum < p2.prereleaseNum) return -1;
  }

  return 0;
}

/**
 * Fetch latest version from GitHub releases
 */
function fetchLatestVersionFromGitHub(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_API_URL,
      {
        headers: { 'User-Agent': 'CCS-Update-Checker' },
        timeout: REQUEST_TIMEOUT,
      },
      (res) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }

            const release = JSON.parse(data) as { tag_name?: string };
            const version = release.tag_name?.replace(/^v/, '') || null;
            resolve(version);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Fetch version from specific npm tag
 * @param tag - npm tag to fetch ('latest' or 'dev')
 */
function fetchVersionFromNpmTag(tag: 'latest' | 'dev'): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `${NPM_REGISTRY_BASE}/${tag}`;
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'CCS-Update-Checker' },
        timeout: REQUEST_TIMEOUT,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }
            const packageData = JSON.parse(data) as { version?: string };
            resolve(packageData.version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Read update check cache
 */
export function readCache(): UpdateCache {
  try {
    if (!fs.existsSync(UPDATE_CHECK_FILE)) {
      return { last_check: 0, latest_version: null, dev_version: null, dismissed_version: null };
    }

    const data = fs.readFileSync(UPDATE_CHECK_FILE, 'utf8');
    const parsed = JSON.parse(data) as UpdateCache;
    // Ensure dev_version exists (backward compatibility)
    if (parsed.dev_version === undefined) {
      parsed.dev_version = null;
    }
    return parsed;
  } catch {
    return { last_check: 0, latest_version: null, dev_version: null, dismissed_version: null };
  }
}

/**
 * Write update check cache
 */
export function writeCache(cache: UpdateCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(UPDATE_CHECK_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Silently fail - not critical
  }
}

/**
 * Check for updates (async, non-blocking)
 * @param currentVersion - Current CCS version
 * @param force - Force check even if within interval
 * @param installMethod - Installation method ('npm' or 'direct')
 * @param targetTag - Target npm tag ('latest' or 'dev')
 */
export async function checkForUpdates(
  currentVersion: string,
  force = false,
  installMethod: 'npm' | 'direct' = 'direct',
  targetTag: 'latest' | 'dev' = 'latest'
): Promise<UpdateResult> {
  if (currentVersion.includes('+leynier')) {
    return { status: 'no_update', reason: 'source_managed', current: currentVersion };
  }
  const cache = readCache();
  const now = Date.now();

  // Get cached version for the target tag
  const cachedVersion = targetTag === 'dev' ? cache.dev_version : cache.latest_version;

  // Check if we should check for updates (only use cache for same-tag checks)
  if (!force && now - cache.last_check < CHECK_INTERVAL && cachedVersion) {
    // Use cached result if available for this tag
    if (compareVersionsWithPrerelease(cachedVersion, currentVersion) > 0) {
      // Don't show if user dismissed this version
      if (cache.dismissed_version === cachedVersion) {
        return { status: 'no_update', reason: 'dismissed' };
      }
      return { status: 'update_available', latest: cachedVersion, current: currentVersion };
    }
    // Check for channel switch: if current is on different channel than target
    // Only trigger if target version matches the target channel type
    const currentIsDevChannel = currentVersion.includes('-dev.');
    const targetIsDevChannel = targetTag === 'dev';
    const cachedIsDevVersion = cachedVersion.includes('-dev.');
    if (
      currentIsDevChannel !== targetIsDevChannel &&
      cachedIsDevVersion === targetIsDevChannel &&
      cachedVersion !== currentVersion
    ) {
      // Channel switch - treat as update available
      return { status: 'update_available', latest: cachedVersion, current: currentVersion };
    }
    return { status: 'no_update', reason: 'cached' };
  }

  // Direct install doesn't support beta channel
  if (installMethod === 'direct' && targetTag === 'dev') {
    return {
      status: 'check_failed',
      reason: 'beta_not_supported',
      message: '--beta requires npm installation method',
    };
  }

  // Fetch latest version from appropriate source
  let latestVersion: string | null;
  let fetchError: string | null = null;

  if (installMethod === 'npm') {
    latestVersion = await fetchVersionFromNpmTag(targetTag);
    if (!latestVersion) fetchError = 'npm_registry_error';
  } else {
    latestVersion = await fetchLatestVersionFromGitHub();
    if (!latestVersion) fetchError = 'github_api_error';
  }

  // Update cache with tag-specific version
  cache.last_check = now;
  if (latestVersion) {
    if (targetTag === 'dev') {
      cache.dev_version = latestVersion;
    } else {
      cache.latest_version = latestVersion;
    }
  }
  writeCache(cache);

  // Handle fetch errors
  if (fetchError) {
    return {
      status: 'check_failed',
      reason: fetchError,
      message: `Failed to check for updates: ${fetchError.replace(/_/g, ' ')}`,
    };
  }

  // Check if update available
  if (latestVersion) {
    const versionComparison = compareVersionsWithPrerelease(latestVersion, currentVersion);

    // Update available if newer version
    if (versionComparison > 0) {
      // Don't show if user dismissed this version
      if (cache.dismissed_version === latestVersion) {
        return { status: 'no_update', reason: 'dismissed' };
      }
      return { status: 'update_available', latest: latestVersion, current: currentVersion };
    }

    // Check for channel switch (stable <-> dev)
    // Only trigger if: switching channels AND target version is on the target channel
    const currentIsDevChannel = currentVersion.includes('-dev.');
    const targetIsDevChannel = targetTag === 'dev';
    const latestIsDevVersion = latestVersion.includes('-dev.');

    // Channel switch is valid only when:
    // 1. User is switching channels (current != target)
    // 2. Target version matches the target channel type
    // 3. Version is different from current
    if (
      currentIsDevChannel !== targetIsDevChannel &&
      latestIsDevVersion === targetIsDevChannel &&
      latestVersion !== currentVersion
    ) {
      // Channel switch - treat as update even if "downgrade"
      return { status: 'update_available', latest: latestVersion, current: currentVersion };
    }
  }

  return { status: 'no_update', reason: 'latest' };
}

/**
 * Show update notification (async - initializes UI first)
 */
export async function showUpdateNotification(updateInfo: {
  current: string;
  latest: string;
}): Promise<void> {
  // Lazy import UI to ensure modules are loaded
  const { initUI, warnBox, color } = await import('./ui');
  await initUI();

  const content = [
    `Update available: ${updateInfo.current} -> ${updateInfo.latest}`,
    '',
    `Run ${color('ccs update', 'command')} to update`,
  ].join('\n');

  console.log('');
  console.log(warnBox(content, 'UPDATE AVAILABLE'));
  console.log('');
}

/**
 * Dismiss update notification for a specific version
 */
export function dismissUpdate(version: string): void {
  const cache = readCache();
  cache.dismissed_version = version;
  writeCache(cache);
}

/**
 * Check cached update result synchronously (no network call)
 * Returns update info if cached result indicates update available, null otherwise
 */
export function checkCachedUpdate(
  currentVersion: string
): { current: string; latest: string } | null {
  if (currentVersion.includes('+leynier')) return null;
  const cache = readCache();

  // Check if cache has a newer version
  if (
    cache.latest_version &&
    compareVersionsWithPrerelease(cache.latest_version, currentVersion) > 0
  ) {
    // Don't show if user dismissed this version
    if (cache.dismissed_version === cache.latest_version) {
      return null;
    }
    return { current: currentVersion, latest: cache.latest_version };
  }

  return null;
}

/**
 * Check if cache is stale (older than CHECK_INTERVAL)
 */
export function isCacheStale(): boolean {
  const cache = readCache();
  const now = Date.now();
  return now - cache.last_check >= CHECK_INTERVAL;
}
