Continue Chip Autopsy Lab (Kiroween 2026). Phase 1 already produced .kiro/steering/{product,tech,design-language,structure}.md, LICENSE, README, .gitignore. Read them plus docs/oss-references.md (final stack research). Do NOT use web fetch or web search at all in this session; all research is already in docs/.

Do, in order, and finish within ~15 minutes:
1. Lock the stack in .kiro/steering/tech.md per docs/oss-references.md: Next.js (App Router) + React + TypeScript strict + Tailwind v4 + shadcn/ui (Radix) + cmdk + Motion + Sonner + visx; own TypeScript STDF V4 parser in a Web Worker; own TypeScript synthetic STDF writer for demo lots; Canvas2D two-layer wafer map; Zustand; Vitest + fast-check + Playwright; LLM narrator behind a Next.js route handler (server-side key, deterministic template fallback when no key). Replace the TBD table with the decision and one-line reasons.
2. Create .kiro/specs/chip-autopsy-lab/requirements.md (EARS acceptance criteria, user stories, numbered correctness properties for property-based tests). Delegate drafting to the carbon MCP tool `carbon_task` (cwd = this repo absolute path), then review and tighten it yourself.
3. Write logs/phase2-summary.md (one paragraph).
Then stop.
