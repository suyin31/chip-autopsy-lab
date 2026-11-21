import type { Metadata } from 'next';
import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';

/**
 * The human-readable face of the peer-network URL.
 *
 * MVP Profile 0.3 §3.2 identifies a peer network by `<site-base>/<network-name>`,
 * so this page lives at the network's own address. A runtime never needs it — it
 * reads `agent-manifest.json` — but a person who follows the link from a peer
 * list should land on something that explains what the network is and can be
 * called to do.
 */

export const metadata: Metadata = {
  title: 'chip_autopsy_lab — agent network',
  description:
    'The published Chip Autopsy Lab agent network: four agents over a deterministic wafer-yield engine, callable by any conforming runtime.',
};

interface NetworkDocument {
  readonly metadata?: { readonly description?: string; readonly name?: string };
  readonly llm_config?: { readonly model_name?: string };
  readonly tools?: ReadonlyArray<{
    readonly name?: string;
    readonly function?: { readonly description?: string };
    readonly instructions?: string;
    readonly tools?: ReadonlyArray<string | { readonly url?: string }>;
  }>;
}

async function readNetwork(): Promise<NetworkDocument | null> {
  try {
    const file = path.join(process.cwd(), 'public/agents/chip_autopsy_lab.network.json');
    return JSON.parse(await fs.readFile(file, 'utf8')) as NetworkDocument;
  } catch {
    return null;
  }
}

export default async function NetworkPage() {
  const network = await readNetwork();
  const agents = network?.tools ?? [];
  const frontMan = agents[0]?.name ?? 'autopsy_conductor';

  return (
    <main className="min-h-dvh bg-bg px-5 py-10 text-text-primary">
      <div className="mx-auto flex max-w-[820px] flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Link href="/" className="text-[12px] text-text-tertiary hover:text-text-primary">
            ← Chip Autopsy Lab
          </Link>
          <h1 className="font-mono text-[22px] leading-tight">chip_autopsy_lab</h1>
          <p className="max-w-[62ch] text-[14px] leading-relaxed text-text-secondary">
            {network?.metadata?.description?.replace(/\s+/g, ' ').trim() ??
              'Wafer-lot failure autopsy over a deterministic engine.'}
          </p>
          <p className="text-[12px] leading-relaxed text-text-tertiary">
            Public agent network, MVP Profile 0.3. A conforming runtime loads this network from the
            site manifest and runs it in the visitor’s browser on the visitor’s own router. Nothing
            here executes on a server and no inference is funded by the site.
          </p>
          <div className="flex flex-wrap gap-3 text-[12px]">
            <Link href="/agents" className="text-text-secondary underline">
              Open the agent console
            </Link>
            <a href="/agent-manifest.json" className="text-text-secondary underline">
              agent-manifest.json
            </a>
            <a href="/agents/chip_autopsy_lab.network.json" className="text-text-secondary underline">
              resolved network
            </a>
            <a href="/agents/chip_autopsy_lab.network.hocon" className="text-text-secondary underline">
              authored HOCON
            </a>
            <a href="/links.json" className="text-text-secondary underline">
              links.json
            </a>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] uppercase tracking-wide text-text-tertiary">
            Agents ({agents.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {agents.map((agent) => (
              <li key={agent.name} className="rounded-panel border border-hairline bg-panel p-4">
                <p className="font-mono text-[13px] text-text-primary">
                  {agent.name}
                  {agent.name === frontMan ? (
                    <span className="ml-2 rounded-pill border border-hairline px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                      front agent
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                  {agent.function?.description?.replace(/\s+/g, ' ').trim()}
                </p>
                <p className="mt-2 font-mono text-[11px] text-text-tertiary">
                  tools: {(agent.tools ?? []).map((tool) => (typeof tool === 'string' ? tool : tool.url ?? '')).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-panel border border-hairline bg-panel p-4 text-[12px] leading-relaxed text-text-secondary">
          <p>
            Calling this network from another agentic site: point a tool at this page’s URL. The
            caller’s runtime fetches <code className="font-mono">/agent-manifest.json</code>, matches
            the network name exactly, fetches the resolved definition and runs it locally, on the
            caller’s router and within the caller’s limits. The visitor approves the contact first.
          </p>
          <p className="mt-2 text-text-tertiary">
            Default model hint: {network?.llm_config?.model_name ?? 'not declared'} · every action
            returns aggregate engine facts only; raw STDF bytes never leave the visitor’s browser.
          </p>
        </section>
      </div>
    </main>
  );
}
