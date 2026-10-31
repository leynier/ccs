import { describe, expect, test } from 'bun:test';
import { checkForUpdates, checkCachedUpdate } from '../../../src/utils/update-checker';
import { handleUpdateCommand } from '../../../src/commands/update-command';
import { getVersion } from '../../../src/utils/version';

describe('Leynier source-managed variant', () => {
  test('identifies the variant without bumping the upstream package version', () => {
    expect(getVersion()).toBe(`${require('../../../package.json').version}+leynier`);
  });

  test('does not offer registry or cached updates', async () => {
    expect(await checkForUpdates('8.10.0+leynier', true)).toEqual({
      status: 'no_update',
      reason: 'source_managed',
      current: '8.10.0+leynier',
    });
    expect(checkCachedUpdate('8.10.0+leynier')).toBeNull();
  });

  for (const options of [{}, { force: true }, { beta: true }, { force: true, beta: true }]) {
    test(`refuses npm replacement for ${JSON.stringify(options)}`, async () => {
      const messages: unknown[] = [];
      const unexpected = () => {
        throw new Error('Source builds must not inspect or update a package-manager install');
      };
      await handleUpdateCommand(options, {
        getVersion: () => '8.10.0+leynier',
        initUI: async () => {},
        log: (...args) => messages.push(args),
        detectCurrentInstall: unexpected,
        checkForUpdates: unexpected,
        spawn: unexpected,
      });
      expect(JSON.stringify(messages)).toContain('fork.md');
    });
  }
});
