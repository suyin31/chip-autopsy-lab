import { ViewTransition } from 'react';
import { AppShell } from '@/ui/layout';
import { resolveServerNarrationEnabled } from './narration-config';

export const dynamic = 'force-dynamic';

interface HomePageProps {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const narrationEnabled = resolveServerNarrationEnabled(
    process.env,
    resolvedParams,
  );
  return (
    <ViewTransition>
      <AppShell narrationEnabled={narrationEnabled} />
    </ViewTransition>
  );
}
