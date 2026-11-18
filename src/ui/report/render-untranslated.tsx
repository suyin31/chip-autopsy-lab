import * as React from 'react';
import { Untranslated } from '@/ui/i18n';

/**
 * Splits a localized string by any non-empty technical tokens (`pattern`, `bin`,
 * `test`, `wafer`, `site`) and wraps matched substrings in `<Untranslated>`
 * (`<bdi translate="no">`, `redesign.md` §6.6).
 *
 * Uses strictly React plain-text nodes (Requirement 2.4).
 */
export function renderWithUntranslatedTokens(
  text: string,
  tokens: Readonly<Record<string, string>>,
): React.ReactNode {
  if (text.length === 0) {
    return text;
  }

  const uniqueValues = Array.from(
    new Set(
      Object.values(tokens).filter((v) => typeof v === 'string' && v.length > 0),
    ),
  ).sort((a, b) => b.length - a.length);

  if (uniqueValues.length === 0) {
    return text;
  }

  type Segment =
    | { readonly kind: 'plain'; readonly value: string }
    | { readonly kind: 'token'; readonly value: string };

  let segments: Segment[] = [{ kind: 'plain', value: text }];

  for (const token of uniqueValues) {
    const next: Segment[] = [];
    for (const seg of segments) {
      if (seg.kind === 'token' || !seg.value.includes(token)) {
        next.push(seg);
        continue;
      }
      const parts = seg.value.split(token);
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]!;
        if (part.length > 0) {
          next.push({ kind: 'plain', value: part });
        }
        if (i < parts.length - 1) {
          next.push({ kind: 'token', value: token });
        }
      }
    }
    segments = next;
  }

  if (segments.length === 1 && segments[0]?.kind === 'plain') {
    return text;
  }

  return segments.map((seg, idx) =>
    seg.kind === 'token' ? (
      <Untranslated key={`tok-${idx}`}>{seg.value}</Untranslated>
    ) : (
      <React.Fragment key={`txt-${idx}`}>{seg.value}</React.Fragment>
    ),
  );
}
