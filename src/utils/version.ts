/**
 * Version Utility
 *
 * Centralized version management for CCS.
 * Reads version from package.json at runtime.
 */

import * as path from 'path';
import * as fs from 'fs';

// Get version from package.json (relative to dist/ at runtime)
let cachedVersion: string | null = null;

export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    cachedVersion = `${packageJson.version || '0.0.0'}+leynier`;
  } catch {
    cachedVersion = '0.0.0+leynier';
  }

  return cachedVersion ?? '0.0.0';
}
