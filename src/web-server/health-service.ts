/**
 * Health Check Service
 *
 * Orchestrates comprehensive health checks for CCS dashboard matching `ccs doctor` output.
 * Groups: System, Environment, Configuration, Profiles & Delegation, System Health, CLIProxy, OAuth Readiness
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfigPath } from '../utils/config-manager';
import { getVersion } from '../utils/version';

// Import all check functions from modular components
import {
  type HealthCheck,
  type HealthGroup,
  type HealthReport,
  checkClaudeCli,
  checkCcsDirectory,
  checkPermissions,
  checkCcsSymlinks,
  checkSettingsSymlinks,
  checkEnvironment,
  checkConfigFile,
  checkSettingsFiles,
  checkClaudeSettings,
  checkProfiles,
  checkInstances,
  checkDelegation,
  checkCliproxyBinary,
  checkCliproxyConfig,
  checkOAuthProviders,
  checkCliproxyPort,
  checkOAuthPortsForDashboard,
  checkWebSearchClis,
} from './health';
import { getCcsDir } from '../config/config-loader-facade';

// Re-export types for external consumers
export type { HealthCheck, HealthGroup, HealthReport };

/**
 * Run all health checks and return report
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const homedir = os.homedir();
  const ccsDir = getCcsDir();
  const claudeDir = path.join(homedir, '.claude');
  const version = getVersion();

  const groups: HealthGroup[] = [];

  // Group 1: System
  const systemChecks: HealthCheck[] = [];
  systemChecks.push(await checkClaudeCli());
  systemChecks.push(checkCcsDirectory(ccsDir));
  groups.push({ id: 'system', name: 'System', icon: 'Monitor', checks: systemChecks });

  // Group 2: Environment
  const envChecks: HealthCheck[] = [];
  envChecks.push(checkEnvironment());
  groups.push({ id: 'environment', name: 'Environment', icon: 'Laptop', checks: envChecks });

  // Group 3: Configuration
  const configChecks: HealthCheck[] = [];
  configChecks.push(checkConfigFile());
  configChecks.push(...checkSettingsFiles(ccsDir));
  configChecks.push(checkClaudeSettings(claudeDir));
  groups.push({
    id: 'configuration',
    name: 'Configuration',
    icon: 'Settings',
    checks: configChecks,
  });

  // Group 4: Profiles & Delegation
  const profileChecks: HealthCheck[] = [];
  profileChecks.push(checkProfiles(ccsDir));
  profileChecks.push(checkInstances(ccsDir));
  profileChecks.push(checkDelegation(ccsDir));
  groups.push({
    id: 'profiles',
    name: 'Profiles & Delegation',
    icon: 'Users',
    checks: profileChecks,
  });

  // Group 5: System Health
  const healthChecks: HealthCheck[] = [];
  healthChecks.push(checkPermissions(ccsDir));
  healthChecks.push(checkCcsSymlinks());
  healthChecks.push(checkSettingsSymlinks(ccsDir, claudeDir));
  groups.push({ id: 'system-health', name: 'System Health', icon: 'Shield', checks: healthChecks });

  // Group 6: CLIProxy
  const cliproxyChecks: HealthCheck[] = [];
  cliproxyChecks.push(checkCliproxyBinary());
  cliproxyChecks.push(checkCliproxyConfig());
  cliproxyChecks.push(...checkOAuthProviders());
  cliproxyChecks.push(await checkCliproxyPort());
  groups.push({ id: 'cliproxy', name: 'CLIProxy (OAuth)', icon: 'Zap', checks: cliproxyChecks });

  // Group 7: OAuth Readiness
  const oauthReadinessChecks: HealthCheck[] = [];
  oauthReadinessChecks.push(...(await checkOAuthPortsForDashboard()));
  groups.push({
    id: 'oauth-readiness',
    name: 'OAuth Readiness',
    icon: 'Key',
    checks: oauthReadinessChecks,
  });

  // Group 8: WebSearch CLI Providers
  const websearchChecks: HealthCheck[] = [];
  websearchChecks.push(...checkWebSearchClis());
  groups.push({ id: 'websearch', name: 'WebSearch', icon: 'Search', checks: websearchChecks });

  // Flatten all checks for backward compatibility
  const allChecks = groups.flatMap((g) => g.checks);

  // Calculate summary
  const summary = {
    total: allChecks.length,
    passed: allChecks.filter((c) => c.status === 'ok').length,
    warnings: allChecks.filter((c) => c.status === 'warning').length,
    errors: allChecks.filter((c) => c.status === 'error').length,
    info: allChecks.filter((c) => c.status === 'info').length,
  };

  return { timestamp: Date.now(), version, groups, checks: allChecks, summary };
}

/**
 * Fix a health issue by its check ID
 */
export function fixHealthIssue(checkId: string): { success: boolean; message: string } {
  const ccsDir = getCcsDir();

  switch (checkId) {
    case 'ccs-dir':
      fs.mkdirSync(ccsDir, { recursive: true });
      return { success: true, message: `Created ${ccsDir} directory` };

    case 'config-file': {
      // Use appropriate config based on unified mode
      const { isUnifiedMode } = require('../config/config-loader-facade');
      if (isUnifiedMode()) {
        const { mutateConfig } = require('../config/config-loader-facade');
        mutateConfig(() => {});
        return { success: true, message: 'Created/updated config.yaml' };
      }
      const configPath = getConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ profiles: {} }, null, 2) + '\n');
      return { success: true, message: 'Created config.json' };
    }

    case 'profiles-file': {
      // Use appropriate storage based on unified mode
      const { isUnifiedMode: isUnified } = require('../config/config-loader-facade');
      if (isUnified()) {
        // In unified mode, accounts are stored in config.yaml
        return { success: true, message: 'Accounts stored in config.yaml (unified mode)' };
      }
      const profilesPath = path.join(ccsDir, 'profiles.json');
      fs.mkdirSync(ccsDir, { recursive: true });
      fs.writeFileSync(profilesPath, JSON.stringify({ profiles: {} }, null, 2) + '\n');
      return { success: true, message: 'Created profiles.json' };
    }

    default:
      return { success: false, message: 'Cannot auto-fix this issue' };
  }
}
