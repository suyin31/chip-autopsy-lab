import * as React from 'react';
import type { AutopsyReport } from '@/core/report';
import { Badge } from '@/ui/primitives';

export interface NarrationBadgeProps {
  readonly source: AutopsyReport['source'];
}

/**
 * Restrained provenance badge indicating whether the rendered Autopsy Report
 * prose came from the deterministic offline template or a citation-verified LLM pass.
 */
export function NarrationBadge({
  source,
}: NarrationBadgeProps): React.JSX.Element {
  if (source === 'llm-verified') {
    return <Badge variant="accent">LLM Verified · Fact-Cited</Badge>;
  }
  return <Badge variant="neutral">Template · Offline</Badge>;
}
