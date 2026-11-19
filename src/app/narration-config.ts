/**
 * Server-only configuration resolver for optional LLM Autopsy Report narration
 * (`src/app/narration-config.ts`).
 *
 * Reads `process.env.LLM_API_KEY` exclusively on the server and returns only a
 * boolean availability flag for `HomePage` -> `AppShell` -> `AutopsyReportCard`.
 * Never imported by client bundles (Requirements 10.6, 16.4).
 */

function isTruthyFlag(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '1' || raw === 'true';
}

export function resolveServerNarrationEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
  searchParams?: Readonly<Record<string, string | string[] | undefined>>,
): boolean {
  const hasServerKey = Boolean(env.LLM_API_KEY?.trim());
  const hasPublicFlag = isTruthyFlag(env.NEXT_PUBLIC_NARRATION_ENABLED);
  const hasQueryOverride = isTruthyFlag(searchParams?.narrate);
  return hasServerKey || hasPublicFlag || hasQueryOverride;
}
