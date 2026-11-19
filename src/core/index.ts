/**
 * Framework-free deterministic analysis core (`src/core/`).
 *
 * Enforced by ESLint (`eslint.config.mjs`, Requirement 17.7):
 * zero React, Next.js, UI, Worker, or browser DOM imports/globals are permitted
 * inside `src/core/` so every correctness property executes directly in Node.
 */

export const CHIP_AUTOPSY_CORE_STDF_VERSION = 4 as const;

export * from './analytics';
export * from './demo';
export * from './i18n';
export * from './model';
export * from './patterns';
export * from './query';
export * from './report';
export * from './stdf';
