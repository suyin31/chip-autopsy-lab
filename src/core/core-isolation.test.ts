import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { CHIP_AUTOPSY_CORE_STDF_VERSION } from './index';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const coreProbeFile = path.join(repoRoot, 'src/core/__isolation_probe__.ts');
const uiProbeFile = path.join(repoRoot, 'src/ui/__secret_probe__.ts');

describe('src/core/ framework and DOM isolation ESLint gate (Requirement 17.7)', () => {
  const eslint = new ESLint({ cwd: repoRoot });

  it('exports the STDF V4 core constant without framework dependencies', () => {
    expect(CHIP_AUTOPSY_CORE_STDF_VERSION).toBe(4);
  });

  it('allows pure TypeScript, TypedArrays, DataView, and DecompressionStream inside src/core/', async () => {
    const [result] = await eslint.lintText(
      [
        'export function readU2(bytes: Uint8Array, littleEndian: boolean): number {',
        '  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);',
        '  const stream = typeof DecompressionStream;',
        '  return view.getUint16(0, littleEndian) + stream.length;',
        '}\n',
      ].join('\n'),
      { filePath: coreProbeFile },
    );

    expect(result.errorCount).toBe(0);
  });

  it('blocks React, Next.js, and UI layer imports inside src/core/', async () => {
    const forbiddenImports = [
      "import { useState } from 'react';\nexport const x = useState;\n",
      "import { NextResponse } from 'next/server';\nexport const x = NextResponse;\n",
      "import { COLOR_TOKENS } from '@/ui/tokens';\nexport const x = COLOR_TOKENS;\n",
      "import { COLOR_TOKENS } from '../ui/tokens/palette';\nexport const x = COLOR_TOKENS;\n",
    ];

    for (const source of forbiddenImports) {
      const [result] = await eslint.lintText(source, { filePath: coreProbeFile });
      expect(result.errorCount).toBeGreaterThan(0);
      expect(
        result.messages.some((msg) => msg.ruleId === 'no-restricted-imports'),
      ).toBe(true);
    }
  });

  it('blocks browser DOM globals (window, document, navigator, HTMLCanvasElement) inside src/core/', async () => {
    const forbiddenGlobals = [
      'export const href = window.location.href;\n',
      "export const el = document.querySelector('canvas');\n",
      'export const online = navigator.onLine;\n',
      'export const ctor = HTMLCanvasElement;\n',
    ];

    for (const source of forbiddenGlobals) {
      const [result] = await eslint.lintText(source, { filePath: coreProbeFile });
      expect(result.errorCount).toBeGreaterThan(0);
      expect(
        result.messages.some((msg) => msg.ruleId === 'no-restricted-globals'),
      ).toBe(true);
    }
  });

  it('blocks NEXT_PUBLIC_LLM_* environment variable access across the repository (Requirement 16.4)', async () => {
    const [result] = await eslint.lintText(
      'export const leaked = process.env.NEXT_PUBLIC_LLM_API_KEY;\n',
      { filePath: uiProbeFile },
    );
    expect(result.errorCount).toBeGreaterThan(0);
    expect(
      result.messages.some((msg) => msg.ruleId === 'no-restricted-syntax'),
    ).toBe(true);
  });
});
