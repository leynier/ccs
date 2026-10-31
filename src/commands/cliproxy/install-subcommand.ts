/**
 * CLIProxy Binary Installation
 *
 * Handles:
 * - ccs cliproxy (show status)
 * - ccs cliproxy --install <version>
 * - ccs cliproxy --latest
 * - ccs cliproxy --update
 */

import { initUI, color, dim, ok, fail, info } from '../../utils/ui';
import {
  getBinaryStatus,
  checkLatestVersion,
  installVersion,
  installLatest,
} from '../../cliproxy/services';
import { DEFAULT_BACKEND, BACKEND_CONFIG } from '../../cliproxy/binary/platform-detector';
import { CLIProxyBackend } from '../../cliproxy/types';

function getBackendLabel(backend: CLIProxyBackend): string {
  return backend === 'plus' ? 'CLIProxy Plus' : 'CLIProxy';
}

export async function showStatus(verbose: boolean, backend: CLIProxyBackend): Promise<void> {
  await initUI();
  const status = getBinaryStatus(backend);

  console.log('');
  const backendLabel = getBackendLabel(backend);
  console.log(color(`${backendLabel} Status`, 'primary'));
  console.log('');

  console.log(
    `  Backend:    ${color(backend, 'info')}${backend === DEFAULT_BACKEND ? dim(' (default)') : ''}`
  );
  console.log(
    `  Source:     ${status.source === 'local' ? 'CCS_CLIPROXY_BINARY (user-managed)' : 'CCS-managed'}`
  );
  if (status.installed) {
    console.log(`  Installed:  ${color('Yes', 'success')}`);
    const versionLabel = status.pinnedVersion
      ? `${color(`v${status.currentVersion}`, 'info')} ${color('(pinned)', 'warning')}`
      : color(
          status.currentVersion ? `v${status.currentVersion}` : 'Unknown (local binary)',
          'info'
        );
    console.log(`  Version:    ${versionLabel}`);
    console.log(`  Binary:     ${dim(status.binaryPath)}`);
  } else {
    console.log(`  Installed:  ${color('No', 'error')}`);
    console.log(`  Fallback:   ${color(`v${status.fallbackVersion}`, 'info')}`);
    console.log(`  ${dim('Run "ccs gemini" or any provider to auto-install')}`);
  }

  if (status.source === 'local') {
    console.log('');
    console.log(dim('Downloads, version pins, and automatic updates are disabled.'));
    console.log(
      dim('Update the local binary yourself, or unset CCS_CLIPROXY_BINARY for managed installs.')
    );
    console.log('');
    return;
  }

  const latestCheck = await checkLatestVersion(backend);
  if (latestCheck.success && latestCheck.latestVersion) {
    console.log('');
    if (latestCheck.updateAvailable) {
      if (status.pinnedVersion) {
        console.log(
          `  Latest:     ${color(`v${latestCheck.latestVersion}`, 'success')} ${dim('(pinned to v' + status.pinnedVersion + ')')}`
        );
        console.log('');
        console.log(`  ${dim('Run "ccs cliproxy --update" to unpin and update')}`);
      } else {
        console.log(
          `  Latest:     ${color(`v${latestCheck.latestVersion}`, 'success')} ${dim('(update available)')}`
        );
        console.log('');
        console.log(`  ${dim('Run "ccs cliproxy --latest" to update')}`);
      }
    } else {
      console.log(
        `  Latest:     ${color(`v${latestCheck.latestVersion}`, 'success')} ${dim('(up to date)')}`
      );
    }
  } else if (verbose && latestCheck.error) {
    console.log(`  Latest:     ${dim(`Could not fetch (${latestCheck.error})`)}`);
  }

  console.log('');
  console.log(dim('Run "ccs cliproxy --help" for all available commands'));
  console.log('');
}

export async function handleInstallVersion(
  version: string,
  verbose: boolean,
  backend: CLIProxyBackend
): Promise<void> {
  const label = getBackendLabel(backend);
  console.log(info(`Installing ${label} v${version}...`));
  console.log('');

  const result = await installVersion(version, verbose, backend);
  if (!result.success) {
    console.error('');
    console.error(fail(`Failed to install ${label} v${version}`));
    console.error(`    ${result.error}`);
    console.error('');
    console.error('Possible causes:');
    console.error('  1. Version does not exist on GitHub');
    console.error('  2. Network connectivity issues');
    console.error('  3. GitHub API rate limiting');
    console.error('');
    console.error('Check available versions at:');
    console.error(`  https://github.com/${BACKEND_CONFIG[backend].repo}/releases`);
    process.exit(1);
  }

  console.log('');
  console.log(ok(`${label} v${version} installed (pinned)`));
  console.log('');
  console.log(dim('This version will be used until you run:'));
  console.log(
    `  ${color('ccs cliproxy --update', 'command')}  ${dim('# Update to latest and unpin')}`
  );
  console.log('');
}

export async function handleInstallLatest(
  verbose: boolean,
  backend: CLIProxyBackend
): Promise<void> {
  const label = getBackendLabel(backend);
  console.log(info(`Fetching latest ${label} version...`));

  const result = await installLatest(verbose, backend);
  if (!result.success) {
    console.error(fail(`Failed to install latest version: ${result.error}`));
    process.exit(1);
  }

  if (result.error?.startsWith('Already')) {
    console.log(ok(result.error));
    return;
  }

  console.log('');
  console.log(ok(`${label} updated to v${result.version}`));
  console.log(dim('Auto-update is now enabled.'));
  console.log('');
}
