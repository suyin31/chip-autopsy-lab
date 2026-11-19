#!/usr/bin/env node
/**
 * Bundle Secret Scanner (`tools/scan-bundle-secrets.mjs`).
 *
 * Scans `.next/static` (or a supplied directory) after `pnpm build` for leaked
 * API keys, private keys, or `NEXT_PUBLIC_LLM_*` references (Requirement 16.4).
 * Exits with code 0 when clean, code 1 on any secret hit or missing build output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SECRET_PATTERNS = [
  {
    name: 'sk_api_key',
    regex: /(?<![A-Za-z0-9_-])sk-(?:proj-|ant-|live_|test_)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: 'google_api_key',
    regex: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{20,}/g,
  },
  {
    name: 'github_token',
    regex: /(?<![A-Za-z0-9_-])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  },
  {
    name: 'github_pat',
    regex: /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9_]{20,}/g,
  },
  {
    name: 'aws_access_key',
    regex: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  },
  {
    name: 'private_key_pem',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    name: 'next_public_llm_env',
    regex: /NEXT_PUBLIC_LLM_[A-Z0-9_]*/g,
  },
];

const SCANNABLE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
  '.map',
  '.txt',
  '.html',
  '.svg',
]);

function redactMatch(value) {
  if (value.length <= 10) {
    return `${value.slice(0, 4)}***`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)} (len=${value.length})`;
}

function collectFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SCANNABLE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export function scanDirectory(targetDir) {
  const resolvedDir = path.resolve(targetDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(
      `Target directory does not exist: ${resolvedDir}. Run "pnpm build" first.`,
    );
  }
  const stat = fs.statSync(resolvedDir);
  if (!stat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${resolvedDir}`);
  }

  const startedAt = performance.now();
  const files = collectFiles(resolvedDir).sort();
  if (files.length === 0) {
    throw new Error(
      `No scannable bundle files found under ${resolvedDir}. Run "pnpm build" first.`,
    );
  }

  const findings = [];
  let bytesScanned = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    bytesScanned += Buffer.byteLength(content, 'utf8');

    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(content)) !== null) {
        findings.push({
          file: path.relative(resolvedDir, filePath),
          pattern: pattern.name,
          offset: match.index,
          redacted: redactMatch(match[0]),
        });
      }
    }
  }

  const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
  return {
    targetDir: resolvedDir,
    filesScanned: files.length,
    bytesScanned,
    patternsChecked: SECRET_PATTERNS.length,
    elapsedMs,
    findings,
  };
}

function runCli() {
  const targetDir = process.argv[2] ?? path.join(process.cwd(), '.next', 'static');
  try {
    const report = scanDirectory(targetDir);
    if (report.findings.length > 0) {
      console.error(
        `[scan:secrets] FAIL — found ${report.findings.length} secret pattern hit(s) in ${report.targetDir}:`,
      );
      for (const hit of report.findings) {
        console.error(
          `  - ${hit.file}@${hit.offset} [${hit.pattern}]: ${hit.redacted}`,
        );
      }
      process.exitCode = 1;
      return;
    }

    const kb = (report.bytesScanned / 1024).toFixed(1);
    console.log(
      `[scan:secrets] PASS — scanned ${report.filesScanned} files (${kb} KiB) across ${report.patternsChecked} patterns in ${report.elapsedMs} ms; 0 hits.`,
    );
  } catch (err) {
    console.error(
      `[scan:secrets] ERROR — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli();
}
