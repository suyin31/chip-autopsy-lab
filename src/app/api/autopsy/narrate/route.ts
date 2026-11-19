/**
 * Next.js App Router endpoint for optional LLM Autopsy Report narration
 * (`src/app/api/autopsy/narrate/route.ts`).
 *
 * Enforces:
 * - Step 1: Inbound privacy & schema gate (`validateNarrateRequestSchema` -> HTTP 400)
 * - Step 2: Server-only `LLM_API_KEY` check (never `NEXT_PUBLIC_` -> HTTP 503)
 * - Step 3: Upstream call (`<= 3500 ms`) & response schema validation (HTTP 200 / HTTP 502)
 *
 * Validates: Requirements 10.5, 10.6, 16.1, 16.3, 16.4
 */

import { handleNarratePostRequest } from '@/core/report/citation-validator';

export async function POST(request: Request): Promise<Response> {
  return handleNarratePostRequest(request);
}
