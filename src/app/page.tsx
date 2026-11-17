export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-between px-6 py-8">
      <header className="flex items-center justify-between border-b border-hairline pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] leading-tight text-text-primary">
            Chip Autopsy Lab
          </h1>
          <span className="font-mono text-[12px] text-text-tertiary">
            STDF V4 · Local-First Workbench
          </span>
        </div>
        <span className="rounded-control border border-hairline bg-raised px-2 py-1 font-mono text-[12px] text-text-tertiary">
          Browser Sandbox
        </span>
      </header>

      <section
        aria-label="Autopsy Report Workspace"
        className="my-auto rounded-panel border border-hairline bg-panel p-8"
      >
        <p className="font-mono text-[12px] uppercase tracking-wider text-text-tertiary">
          Autopsy Report
        </p>
        <h2 className="mt-2 text-[28px] leading-snug text-text-primary">
          Awaiting STDF V4 wafer sort telemetry.
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] text-text-secondary">
          All decompression, binary record decoding, retest resolution, spatial
          classification, and statistical capability metrics execute locally in
          browser memory.
        </p>
      </section>

      <footer className="flex items-center justify-between border-t border-hairline pt-4 text-[12px] text-text-tertiary">
        <span>Zero server STDF uploads</span>
        <span className="font-mono">0 bytes ingested</span>
      </footer>
    </main>
  );
}
