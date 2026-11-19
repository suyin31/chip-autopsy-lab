/**
 * Task 20 Privacy & Secret Hygiene Unit Tests (`src/app/narration-config.test.ts`):
 * - Verifies `resolveServerNarrationEnabled` defaults to `false` when `LLM_API_KEY`
 *   is unset or blank so the client never calls `POST /api/autopsy/narrate`
 *   (no HTTP 503, no console error).
 * - Verifies `isPublicNarrationFlagEnabled` defaults to `false`.
 * - Verifies `tools/scan-bundle-secrets.mjs` exits cleanly on clean bundles and
 *   flags `sk-`, `AIza`, `ghp_`, and PEM private key patterns.
 *
 * Validates: Requirements 10.6, 16.4
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isPublicNarrationFlagEnabled } from '@/ui/report';
import { resolveServerNarrationEnabled } from './narration-config';

const SCANNER_PATH = path.resolve(
  process.cwd(),
  'tools',
  'scan-bundle-secrets.mjs',
);

describe('Server-safe narration configuration flag (Task 20 / Requirement 16.4)', () => {
  const originalPublicFlag = process.env.NEXT_PUBLIC_NARRATION_ENABLED;

  afterEach(() => {
    if (originalPublicFlag === undefined) {
      delete process.env.NEXT_PUBLIC_NARRATION_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_NARRATION_ENABLED = originalPublicFlag;
    }
  });

  it('returns false when no LLM_API_KEY, public flag, or query override is configured', () => {
    expect(resolveServerNarrationEnabled({})).toBe(false);
    expect(resolveServerNarrationEnabled({ LLM_API_KEY: '' })).toBe(false);
    expect(resolveServerNarrationEnabled({ LLM_API_KEY: '   \t\n ' })).toBe(
      false,
    );
    expect(
      resolveServerNarrationEnabled({ NEXT_PUBLIC_NARRATION_ENABLED: 'false' }),
    ).toBe(false);
    expect(
      resolveServerNarrationEnabled({ NEXT_PUBLIC_NARRATION_ENABLED: '0' }),
    ).toBe(false);
  });

  it('returns true only when LLM_API_KEY is non-empty, NEXT_PUBLIC_NARRATION_ENABLED is truthy, or narrate=1', () => {
    expect(
      resolveServerNarrationEnabled({ LLM_API_KEY: 'configured-key-value' }),
    ).toBe(true);
    expect(
      resolveServerNarrationEnabled({ NEXT_PUBLIC_NARRATION_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      resolveServerNarrationEnabled({ NEXT_PUBLIC_NARRATION_ENABLED: '1' }),
    ).toBe(true);
    expect(resolveServerNarrationEnabled({}, { narrate: '1' })).toBe(true);
    expect(resolveServerNarrationEnabled({}, { narrate: 'true' })).toBe(true);
    expect(resolveServerNarrationEnabled({}, { narrate: '0' })).toBe(false);
  });

  it('defaults isPublicNarrationFlagEnabled() to false when unset', () => {
    delete process.env.NEXT_PUBLIC_NARRATION_ENABLED;
    expect(isPublicNarrationFlagEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_NARRATION_ENABLED = 'true';
    expect(isPublicNarrationFlagEnabled()).toBe(true);
  });
});

describe('tools/scan-bundle-secrets.mjs CLI verification (Requirement 16.4)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempBundle(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-secret-scan-'));
    tempDirs.push(dir);
    for (const [relPath, contents] of Object.entries(files)) {
      const full = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents, 'utf8');
    }
    return dir;
  }

  it('exits 0 on a clean bundle directory', () => {
    const dir = makeTempBundle({
      'chunks/app.js':
        'console.log("Chip Autopsy Lab local-first STDF workbench");',
      'css/app.css': ':root{--bg:#F6F3EE;--ember:#FF6B2C;}',
    });

    const output = execFileSync(process.execPath, [SCANNER_PATH, dir], {
      encoding: 'utf8',
    });
    expect(output).toContain('[scan:secrets] PASS');
    expect(output).toContain('0 hits');
  });

  it('exits nonzero on sk-, AIza, ghp_, and PEM private key leaks', () => {
    // Construct synthetic test tokens via join so this test file itself never holds literal secrets
    const samples: ReadonlyArray<{
      readonly label: string;
      readonly token: string;
    }> = [
      { label: 'sk_api_key', token: ['sk', 'proj', '0123456789abcdefghij1234'].join('-') },
      { label: 'google_api_key', token: ['AIza', 'SyDummyTestKey0123456789abcdef12345'].join('') },
      { label: 'github_token', token: ['ghp', '0123456789abcdefghij0123456789abcdef'].join('_') },
      {
        label: 'private_key_pem',
        token: ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
      },
    ];

    for (const sample of samples) {
      const dir = makeTempBundle({
        'chunks/leak.js': `const leaked = "${sample.token}";`,
      });

      let exitCode = 0;
      let stderr = '';
      try {
        execFileSync(process.execPath, [SCANNER_PATH, dir], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const execErr = err as { status?: number; stderr?: string };
        exitCode = execErr.status ?? 1;
        stderr = execErr.stderr ?? '';
      }

      expect(exitCode, `expected nonzero exit for ${sample.label}`).not.toBe(0);
      expect(stderr).toContain('[scan:secrets] FAIL');
      expect(stderr).toContain(sample.label);
    }
  });
});
