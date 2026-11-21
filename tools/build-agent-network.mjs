#!/usr/bin/env node
/**
 * Resolve the authored HOCON network into the JSON artifact the site publishes.
 *
 * A published network must be data-only and fully resolved (MVP Profile 0.3
 * §2.2). This script parses `chip_autopsy_lab.network.hocon`, validates it with
 * the same runtime the browser uses, and writes `chip_autopsy_lab.network.json`
 * next to it. Run it after editing the HOCON:
 *
 *     node tools/build-agent-network.mjs
 *
 * It fails, and writes nothing, when the network does not validate.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHocon, resolveNetwork } from '../public/agent-runtime/agent-runtime.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hoconPath = path.join(root, 'public/agents/chip_autopsy_lab.network.hocon');
const jsonPath = path.join(root, 'public/agents/chip_autopsy_lab.network.json');

const text = await readFile(hoconPath, 'utf8');
const parsed = parseHocon(text, { source: 'chip_autopsy_lab.network.hocon' });
const network = resolveNetwork(parsed, {
  name: 'chip_autopsy_lab',
  baseUrl: '.',
  origin: 'self',
  isPeer: false,
});

await writeFile(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
console.log(
  `resolved ${network.name}: ${network.agents.size} agents, front ${network.frontMan} -> ${path.relative(root, jsonPath)}`,
);
