'use client';

import * as React from 'react';
import {
  type GlossaryCandidate,
  type GlossaryTermId,
  MAX_TERMS_PER_TEXT,
  resolveGlossaryEntry,
  splitGlossaryTerms,
} from '@/core/i18n';
import { Term } from '@/ui/primitives/term';
import { Untranslated } from './I18nProvider';
import { useT } from './use-t';

export interface GlossaryTextProps {
  readonly text: string;
  /** Terms to look for, in priority order (premium §2.2). */
  readonly terms: readonly GlossaryTermId[];
  /** Untranslated values (bin codes, test names, sites) wrapped in `<bdi translate="no">`; never matched as terms. */
  readonly untranslatedTokens?: Readonly<Record<string, string>>;
  /** Defaults to 2 (premium §7.17). */
  readonly max?: number;
}

type Piece =
  | { readonly kind: 'plain'; readonly value: string }
  | { readonly kind: 'token'; readonly value: string };

function splitTokens(
  text: string,
  tokens: Readonly<Record<string, string>> | undefined,
): Piece[] {
  const values = Array.from(
    new Set(Object.values(tokens ?? {}).filter((v) => v.length > 0)),
  ).sort((a, b) => b.length - a.length);
  let pieces: Piece[] = [{ kind: 'plain', value: text }];
  for (const token of values) {
    const next: Piece[] = [];
    for (const piece of pieces) {
      if (piece.kind === 'token' || !piece.value.includes(token)) {
        next.push(piece);
        continue;
      }
      const parts = piece.value.split(token);
      parts.forEach((part, i) => {
        if (part.length > 0) next.push({ kind: 'plain', value: part });
        if (i < parts.length - 1) next.push({ kind: 'token', value: token });
      });
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Renders localized plain text with glossary `Term`s on the first match of each listed term
 * (at most 2), and untranslated tokens in `<bdi translate="no">` (premium §2.3, §7.17, §9.2).
 * Bin codes, test names, and other untranslated tokens never become terms.
 */
export function GlossaryText({
  text,
  terms,
  untranslatedTokens,
  max = MAX_TERMS_PER_TEXT,
}: GlossaryTextProps): React.JSX.Element {
  const { locale } = useT();
  const candidates = React.useMemo<GlossaryCandidate[]>(
    () =>
      terms.map((id) => ({ id, term: resolveGlossaryEntry(locale, id).term })),
    [locale, terms],
  );

  const nodes: React.ReactNode[] = [];
  let budget = max;
  const usedIds = new Set<GlossaryTermId>();
  splitTokens(text, untranslatedTokens).forEach((piece, pieceIdx) => {
    if (piece.kind === 'token') {
      nodes.push(<Untranslated key={`tok-${pieceIdx}`}>{piece.value}</Untranslated>);
      return;
    }
    const open = candidates.filter((c) => !usedIds.has(c.id));
    const segments =
      budget > 0 && open.length > 0
        ? splitGlossaryTerms(piece.value, open, budget)
        : [{ kind: 'text' as const, value: piece.value }];
    segments.forEach((seg, segIdx) => {
      const key = `${pieceIdx}-${segIdx}`;
      if (seg.kind === 'text') {
        nodes.push(<React.Fragment key={key}>{seg.value}</React.Fragment>);
        return;
      }
      budget -= 1;
      usedIds.add(seg.id);
      const entry = resolveGlossaryEntry(locale, seg.id);
      nodes.push(
        <Term key={key} termId={seg.id} term={entry.term} definition={entry.definition}>
          {seg.value}
        </Term>,
      );
    });
  });

  return <>{nodes}</>;
}
