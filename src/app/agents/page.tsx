import type { Metadata } from 'next';
import { ViewTransition } from 'react';
import { AgentConsole } from '@/ui/agent-console/AgentConsole';

export const metadata: Metadata = {
  title: 'Agent console — Chip Autopsy Lab',
  description:
    'Run the Chip Autopsy Lab agent network in your browser: a yield-analysis troupe of agents over the lot you have open, on a deterministic engine, with every claim cited.',
};

export default function AgentsPage() {
  return (
    <ViewTransition enter="cal-page-enter" exit="cal-page-exit" default="none">
      <AgentConsole />
    </ViewTransition>
  );
}
