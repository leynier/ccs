import * as fs from 'fs';
import * as path from 'path';
import { BinaryError } from '../../errors/error-types';

export const LOCAL_BINARY_ENV = 'CCS_CLIPROXY_BINARY';

/** Resolve on every call so long-lived processes do not cache an invalid path. */
export function getLocalBinaryPath(): string | undefined {
  const binaryPath = process.env[LOCAL_BINARY_ENV];
  if (binaryPath === undefined) return undefined;

  const recovery = `Set ${LOCAL_BINARY_ENV} to an absolute path to an executable CLIProxy-compatible file, or unset it to use CCS-managed binaries.`;
  if (!path.isAbsolute(binaryPath)) {
    throw new BinaryError(`${LOCAL_BINARY_ENV} must be an absolute path. ${recovery}`, binaryPath);
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(binaryPath);
  } catch {
    throw new BinaryError(
      `${LOCAL_BINARY_ENV} file cannot be accessed: ${binaryPath}. ${recovery}`,
      binaryPath
    );
  }
  if (!stat.isFile()) {
    throw new BinaryError(
      `${LOCAL_BINARY_ENV} must point to a regular file: ${binaryPath}. ${recovery}`,
      binaryPath
    );
  }
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch {
    throw new BinaryError(
      `${LOCAL_BINARY_ENV} file is not executable: ${binaryPath}. Grant execute permission (chmod +x on Unix). ${recovery}`,
      binaryPath
    );
  }
  return binaryPath;
}

/** Reject managed mutations before any network, pin, or process lifecycle work. */
export function assertManagedBinary(): void {
  if (process.env[LOCAL_BINARY_ENV] !== undefined) {
    throw new BinaryError(
      `CCS-managed binary installation, update, and deletion are disabled while ${LOCAL_BINARY_ENV} is set. Update the local binary yourself, or unset ${LOCAL_BINARY_ENV} to manage CCS binaries.`,
      process.env[LOCAL_BINARY_ENV]
    );
  }
}
