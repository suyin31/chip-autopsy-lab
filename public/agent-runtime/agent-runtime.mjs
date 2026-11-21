/**
 * Portable Agent Runtime — a dependency-free browser runtime for the
 * *Minimum Viable Specification for a Worldwide Agentic Web* (MVP Profile 0.3).
 *
 * A conforming agent site publishes `agent-manifest.json` plus a resolved,
 * data-only network definition. This module is the second half: it fetches the
 * manifest, parses and validates the network (JSON, or HOCON as authored),
 * runs the front agent and its specialists against a pluggable model router,
 * dispatches registered site actions and third-party capabilities under user
 * consent, and can load another site's network into this same browser tab.
 *
 * Design rules this file keeps (profile §2–§5):
 * - Declarative networks only. Nothing in a published network is executed as
 *   code; an executable definition is rejected before any model call.
 * - Fail closed. Every validation, resolution, consent and budget failure is
 *   raised as an `AgentRuntimeError` with a stable `code`, reported to the
 *   caller, and never presented as a successful result.
 * - The visitor's inference credential never leaves this module's router call:
 *   it is not put in URLs, prompts, action arguments, traces or peer requests.
 * - Site actions run here, on this origin, after argument validation; writes and
 *   irreversible effects wait for the visitor's confirmation and produce a
 *   receipt bound to the arguments that were reviewed.
 * - Private context (`slyData`) is deny-by-default: it reaches an agent only
 *   through an explicit allow rule, and a peer only through `allowPeers`.
 *
 * The runtime is framework-free: it touches no DOM, no storage and no network
 * beyond the injected `fetch` and the callbacks it is given.
 *
 * License: MIT (same as the site that publishes it).
 */

export const AGENT_RUNTIME_VERSION = '1.0.0';
export const AGENT_RUNTIME_PROFILE = 'mvp-0.3';

/** Stable error codes. Every one of them is a *stop*, never a partial success. */
export const ERROR_CODES = Object.freeze({
  manifestInvalid: 'manifest_invalid',
  manifestUnavailable: 'manifest_unavailable',
  networkInvalid: 'network_invalid',
  networkNotFound: 'network_not_found',
  parseFailed: 'parse_failed',
  schemaInvalid: 'schema_invalid',
  toolUnknown: 'tool_unknown',
  toolNotAllowed: 'tool_not_allowed',
  budgetExceeded: 'budget_exceeded',
  depthExceeded: 'depth_exceeded',
  cycleDetected: 'cycle_detected',
  consentDenied: 'consent_denied',
  peerBlocked: 'peer_blocked',
  remoteFailed: 'remote_failed',
  unknownOutcome: 'unknown_outcome',
  routerMissing: 'router_missing',
  routerFailed: 'router_failed',
  keyMissing: 'key_missing',
  mcpFailed: 'mcp_failed',
  unavailable: 'unavailable',
});

export class AgentRuntimeError extends Error {
  /**
   * @param {string} code stable machine-readable code (see ERROR_CODES)
   * @param {string} message human-readable, safe to show to the visitor
   * @param {Record<string, unknown>} [detail]
   */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.detail = detail;
  }
}

/** @param {string} code @param {string} message @param {Record<string, unknown>} [detail] */
function fail(code, message, detail = {}) {
  throw new AgentRuntimeError(code, message, detail);
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/* ------------------------------------------------------------------------- *
 * HOCON reader
 *
 * HOCON is the canonical authoring format for a Neuro SAN agent network. A
 * browser loads the *resolved* form, so this reader is deliberately strict
 * about the two things a resolved artifact must not contain: `include`
 * directives and unresolved `${substitutions}`. It accepts the subset that
 * published networks actually use: objects (with or without braces), arrays,
 * dotted keys, quoted/unquoted/triple-quoted strings, numbers, booleans, null,
 * comments and trailing commas.
 * ------------------------------------------------------------------------- */

/**
 * Parse HOCON (or plain JSON, which is valid HOCON) into a JavaScript value.
 * @param {string} text
 * @param {{ source?: string }} [options]
 * @returns {unknown}
 */
export function parseHocon(text, options = {}) {
  if (typeof text !== 'string') fail(ERROR_CODES.parseFailed, 'HOCON input must be a string.');
  const source = options.source ?? 'hocon';
  let index = 0;

  const position = () => {
    const before = text.slice(0, index);
    const line = before.split('\n').length;
    const column = index - before.lastIndexOf('\n');
    return `${source}:${line}:${column}`;
  };
  const error = (message) => fail(ERROR_CODES.parseFailed, `${message} (${position()})`);

  const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';

  const skipSpaceAndComments = () => {
    for (;;) {
      while (index < text.length && isSpace(text[index])) index += 1;
      if (text.startsWith('//', index)) {
        while (index < text.length && text[index] !== '\n') index += 1;
        continue;
      }
      if (text[index] === '#') {
        while (index < text.length && text[index] !== '\n') index += 1;
        continue;
      }
      return;
    }
  };

  const parseString = () => {
    if (text.startsWith('"""', index)) {
      index += 3;
      const end = text.indexOf('"""', index);
      if (end === -1) error('Unterminated triple-quoted string');
      let raw = text.slice(index, end);
      index = end + 3;
      // A quoted string ends with a quote to be ignored; whitespace after the
      // opening or before the closing quote is not part of the value.
      // HOCON strips the common indentation of a multiline quoted string, so
      // agent instructions survive the file's formatting. Trailing blank lines
      // and the indentation before the closing quotes are not content.
      let lines = raw.split('\n');
      if (lines.length > 0 && lines[0].trim() === '') lines = lines.slice(1);
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      const indents = lines
        .filter((line) => line.trim() !== '')
        .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
      const shared = indents.length > 0 ? Math.min(...indents) : 0;
      raw = lines.map((line) => (shared > 0 ? line.slice(shared) : line)).join('\n');
      return raw;
    }
    if (text[index] === '"') {
      index += 1;
      let out = '';
      while (index < text.length) {
        const ch = text[index];
        if (ch === '\\') {
          const next = text[index + 1];
          index += 2;
          if (next === 'n') out += '\n';
          else if (next === 't') out += '\t';
          else if (next === 'r') out += '\r';
          else if (next === '"') out += '"';
          else if (next === '\\') out += '\\';
          else if (next === '/') out += '/';
          else if (next === 'u') {
            out += String.fromCharCode(Number.parseInt(text.slice(index, index + 4), 16));
            index += 4;
          } else out += next;
          continue;
        }
        if (ch === '"') {
          index += 1;
          return out;
        }
        if (ch === '\n') error('Unterminated quoted string');
        out += ch;
        index += 1;
      }
      error('Unterminated quoted string');
    }
    return null;
  };

  const BARE_STOP = new Set([',', '}', ']', '=', '{', '[', '\n', '\r']);

  const parseBareValue = () => {
    if (text.startsWith('${', index)) {
      error(
        'Unresolved substitution. A published network definition must be fully resolved before it is served.',
      );
    }
    const start = index;
    while (index < text.length) {
      const ch = text[index];
      if (BARE_STOP.has(ch)) break;
      // A colon separates key from value only when whitespace follows it, so an
      // unquoted URL keeps its scheme.
      if (ch === ':' && (index + 1 >= text.length || isSpace(text[index + 1]))) break;
      // "//" starts a comment only at a token boundary: a URL keeps its slashes.
      if (ch === '/' && text[index + 1] === '/' && (index === start || isSpace(text[index - 1]))) break;
      if (ch === '#') break;
      index += 1;
    }
    const raw = text.slice(start, index).trim();
    if (raw === '') error('Missing value');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
    if (/^-?\d*\.\d+(e[+-]?\d+)?$/i.test(raw) || /^-?\d+(e[+-]?\d+)$/i.test(raw)) {
      return Number.parseFloat(raw);
    }
    if (raw.startsWith('${') || raw.includes('${')) {
      error(
        `Unresolved substitution "${raw}". A published network definition must be fully resolved before it is served.`,
      );
    }
    return raw;
  };

  const parseValue = () => {
    skipSpaceAndComments();
    const ch = text[index];
    if (ch === '{') return parseObject('{');
    if (ch === '[') return parseArray();
    const quoted = parseString();
    if (quoted !== null) return quoted;
    return parseBareValue();
  };

  const parseKey = () => {
    skipSpaceAndComments();
    const ch = text[index];
    if (ch === '"') {
      const key = parseString();
      return key ?? '';
    }
    if (ch === '"""') error('A triple-quoted string cannot be a key');
    const start = index;
    while (index < text.length) {
      const c = text[index];
      if (c === '=' || c === ':' || c === '{' || c === '}') break;
      if (isSpace(c)) break;
      index += 1;
    }
    const key = text.slice(start, index).trim();
    if (key === '') error('Missing key');
    return key;
  };

  /** Assign a dotted path into an object, merging plain objects along the way. */
  const assign = (target, dottedKey, value) => {
    const parts = dottedKey.split('.');
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!isPlainObject(cursor[part])) cursor[part] = {};
      cursor = cursor[part];
    }
    const last = parts[parts.length - 1];
    if (isPlainObject(cursor[last]) && isPlainObject(value)) {
      cursor[last] = { ...cursor[last], ...value };
    } else {
      cursor[last] = value;
    }
  };

  function parseObject(open) {
    if (open === '{') index += 1;
    const result = {};
    for (;;) {
      skipSpaceAndComments();
      if (index >= text.length) {
        if (open === '{') error('Unterminated object');
        break;
      }
      if (text[index] === '}') {
        if (open !== '{') error('Unexpected "}"');
        index += 1;
        break;
      }
      if (text.startsWith('include', index) && /[\s"']/.test(text[index + 7] ?? '')) {
        error(
          'HOCON "include" is not allowed in a published network: build-time includes must be resolved before publication.',
        );
      }
      const key = parseKey();
      skipSpaceAndComments();
      if (text[index] === '=' || text[index] === ':') index += 1;
      else if (text[index] !== '{') error(`Expected "=" or ":" after key "${key}"`);
      const value = parseValue();
      assign(result, key, value);
      skipSpaceAndComments();
      if (text[index] === ',') index += 1;
    }
    return result;
  }

  function parseArray() {
    index += 1; // [
    const result = [];
    for (;;) {
      skipSpaceAndComments();
      if (index >= text.length) error('Unterminated array');
      if (text[index] === ']') {
        index += 1;
        break;
      }
      result.push(parseValue());
      skipSpaceAndComments();
      if (text[index] === ',') index += 1;
    }
    return result;
  }

  const value = parseValue();
  skipSpaceAndComments();
  if (index < text.length) error('Unexpected trailing content');
  return value;
}

/* ------------------------------------------------------------------------- *
 * JSON Schema (the subset a callable capability needs)
 * ------------------------------------------------------------------------- */

/**
 * Validate a value against a JSON Schema subset: `type`, `properties`,
 * `required`, `additionalProperties`, `enum`, `items`, `minimum`, `maximum`,
 * `minLength`, `maxLength`, `oneOf`, `anyOf`, `const`.
 *
 * @param {unknown} schema
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]} human-readable violations, empty when valid
 */
export function validateJsonSchema(schema, value, path = 'arguments') {
  if (!isPlainObject(schema)) return [];
  const errors = [];
  const typeOf = (v) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (Number.isInteger(v)) return 'integer';
    return typeof v;
  };

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((s) => validateJsonSchema(s, value, path).length === 0);
    if (matches.length !== 1) errors.push(`${path}: must match exactly one of the allowed forms`);
    return errors;
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter((s) => validateJsonSchema(s, value, path).length === 0);
    if (matches.length === 0) errors.push(`${path}: does not match any allowed form`);
    return errors;
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => entry === value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok =
      allowed.includes(actual) ||
      (actual === 'integer' && allowed.includes('number')) ||
      (actual === 'number' && allowed.includes('integer') && Number.isInteger(value));
    if (!ok) {
      errors.push(`${path}: expected ${allowed.join(' or ')}, received ${actual}`);
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: shorter than ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: longer than ${schema.maxLength} characters`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: must be at most ${schema.maximum}`);
    }
  }
  if (Array.isArray(value) && isPlainObject(schema.items)) {
    value.forEach((entry, i) => {
      errors.push(...validateJsonSchema(schema.items, entry, `${path}[${i}]`));
    });
  }
  if (isPlainObject(value) && (isPlainObject(schema.properties) || schema.additionalProperties === false)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!(key in value)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (properties[key] !== undefined) {
        errors.push(...validateJsonSchema(properties[key], entry, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: not allowed here`);
      }
    }
  }
  return errors;
}

/* ------------------------------------------------------------------------- *
 * Manifest
 * ------------------------------------------------------------------------- */

/**
 * @typedef {object} ManifestNetwork
 * @property {string} name
 * @property {string} front_man
 * @property {string} hocon
 * @property {string} [description]
 * @property {string[]} [tags]
 * @property {string[]} [sample_queries]
 */

/**
 * Validate an `agent-manifest.json` document (profile §3.3).
 * @param {unknown} manifest
 * @returns {string[]} violations; empty when the manifest is usable
 */
export function validateManifest(manifest) {
  if (!isPlainObject(manifest)) return ['manifest: must be a JSON object'];
  const errors = [];
  if (!Array.isArray(manifest.networks) || manifest.networks.length === 0) {
    errors.push('manifest.networks: at least one published network is required');
    return errors;
  }
  const seen = new Set();
  manifest.networks.forEach((network, i) => {
    const at = `manifest.networks[${i}]`;
    if (!isPlainObject(network)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (typeof network.name !== 'string' || network.name.trim() === '') {
      errors.push(`${at}.name: required string`);
    } else if (seen.has(network.name)) {
      errors.push(`${at}.name: duplicate network name "${network.name}"`);
    } else {
      seen.add(network.name);
    }
    if (typeof network.front_man !== 'string' || network.front_man.trim() === '') {
      errors.push(`${at}.front_man: required string naming the front agent`);
    }
    if (typeof network.hocon !== 'string' || network.hocon.trim() === '') {
      errors.push(`${at}.hocon: required path or URL of the resolved network definition`);
    }
  });
  if (manifest.allowed_peers !== undefined && !Array.isArray(manifest.allowed_peers)) {
    errors.push('manifest.allowed_peers: must be an array of origins');
  }
  if (manifest.peer_policy !== undefined) {
    if (!isPlainObject(manifest.peer_policy)) {
      errors.push('manifest.peer_policy: must be an object');
    } else if (!['open', 'closed', undefined].includes(manifest.peer_policy.mode)) {
      errors.push('manifest.peer_policy.mode: must be "open" or "closed"');
    }
  }
  if (manifest.llm_router !== undefined) {
    if (!isPlainObject(manifest.llm_router)) {
      errors.push('manifest.llm_router: must be an object');
    } else if (
      manifest.llm_router.base_url !== undefined &&
      typeof manifest.llm_router.base_url !== 'string'
    ) {
      errors.push('manifest.llm_router.base_url: must be a string');
    } else if (
      manifest.llm_router.base_url !== undefined &&
      !/^https?:\/\//.test(manifest.llm_router.base_url)
    ) {
      errors.push('manifest.llm_router.base_url: must be an http(s) URL');
    }
  }
  return errors;
}

/**
 * @typedef {object} AgentSpec
 * @property {string} name
 * @property {string} description
 * @property {string} instructions
 * @property {Array<string | {url: string, tools?: string[]}>} tools
 */

/**
 * @typedef {object} Network
 * @property {string} name
 * @property {string} description
 * @property {string} frontMan
 * @property {Map<string, AgentSpec>} agents
 * @property {Record<string, unknown>} metadata
 * @property {Record<string, unknown>} raw
 * @property {{baseUrl: string, origin: string, isPeer: boolean}} source
 * @property {string} [modelName]
 * @property {number} [maxExecutionSeconds]
 */

const EXECUTABLE_KEYS = ['code', 'implementation', 'python', 'javascript', 'source', 'module'];

/**
 * Build a validated network from a parsed definition (profile §2.1, §3.1).
 * Rejects malformed networks, duplicate or missing agent references, an invalid
 * front agent and any executable definition.
 *
 * @param {unknown} raw
 * @param {{ name?: string, baseUrl?: string, origin?: string, isPeer?: boolean }} [options]
 * @returns {Network}
 */
export function resolveNetwork(raw, options = {}) {
  if (!isPlainObject(raw)) {
    fail(ERROR_CODES.networkInvalid, 'Network definition must be a JSON object.');
  }
  const metadata = isPlainObject(raw.metadata) ? raw.metadata : {};
  const name =
    (typeof raw.name === 'string' && raw.name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    options.name ||
    'unnamed_network';
  const entries = Array.isArray(raw.tools) ? raw.tools : Array.isArray(raw.agents) ? raw.agents : null;
  if (!entries) {
    fail(ERROR_CODES.networkInvalid, `Network "${name}" must publish a "tools" array of agents.`);
  }

  /** @type {Map<string, AgentSpec>} */
  const agents = new Map();
  /**
   * Capabilities the network declares but does not own: site actions this
   * origin registers, or peer networks resolved through `links.json`. They are
   * data too, so a caller can see every capability before it runs anything.
   * @type {Map<string, {name: string, description: string, toolType: string, url?: string}>}
   */
  const capabilities = new Map();
  for (const [i, entry] of entries.entries()) {
    if (!isPlainObject(entry)) {
      fail(ERROR_CODES.networkInvalid, `Network "${name}": tools[${i}] must be an object.`);
    }
    const agentName = entry.name;
    if (typeof entry.tool_type === 'string') {
      if (typeof agentName !== 'string' || agentName.trim() === '') {
        fail(ERROR_CODES.networkInvalid, `Network "${name}": tools[${i}] capability is missing its name.`);
      }
      if (capabilities.has(agentName)) {
        fail(ERROR_CODES.networkInvalid, `Network "${name}": duplicate capability "${agentName}".`);
      }
      const capabilityDescription =
        (isPlainObject(entry.function) && typeof entry.function.description === 'string'
          ? entry.function.description
          : '') || '';
      capabilities.set(agentName, {
        name: agentName,
        description: capabilityDescription,
        toolType: entry.tool_type,
        ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      });
      continue;
    }
    if (typeof agentName !== 'string' || agentName.trim() === '') {
      fail(ERROR_CODES.networkInvalid, `Network "${name}": tools[${i}] is missing its name.`);
    }
    if (agents.has(agentName)) {
      fail(ERROR_CODES.networkInvalid, `Network "${name}": duplicate agent "${agentName}".`, { agent: agentName });
    }
    for (const key of EXECUTABLE_KEYS) {
      if (entry[key] !== undefined || (isPlainObject(entry.function) && entry.function[key] !== undefined)) {
        fail(
          ERROR_CODES.networkInvalid,
          `Network "${name}": agent "${agentName}" carries an executable definition ("${key}"). Published networks are declarative data only.`,
          { agent: agentName },
        );
      }
    }
    const description =
      (isPlainObject(entry.function) && typeof entry.function.description === 'string'
        ? entry.function.description
        : typeof entry.description === 'string'
          ? entry.description
          : '') || '';
    const declaredParameters =
      isPlainObject(entry.function) && isPlainObject(entry.function.parameters)
        ? entry.function.parameters
        : undefined;
    if (description.trim() === '') {
      fail(
        ERROR_CODES.networkInvalid,
        `Network "${name}": agent "${agentName}" needs a function description.`,
        { agent: agentName },
      );
    }
    let declaredTools = entry.tools ?? [];
    if (typeof declaredTools === 'string') declaredTools = [declaredTools];
    if (!Array.isArray(declaredTools)) {
      fail(
        ERROR_CODES.networkInvalid,
        `Network "${name}": agent "${agentName}" tools must be an array.`,
        { agent: agentName },
      );
    }
    const tools = declaredTools.map((tool, j) => {
      if (typeof tool === 'string') return tool;
      if (isPlainObject(tool) && typeof tool.url === 'string') {
        return { url: tool.url, ...(Array.isArray(tool.tools) ? { tools: tool.tools.map(String) } : {}) };
      }
      if (isPlainObject(tool) && typeof tool.name === 'string') {
        // `{ name: "peer_network" }` in an authored file resolves through links.json.
        return tool.name;
      }
      fail(
        ERROR_CODES.networkInvalid,
        `Network "${name}": agent "${agentName}" has an unusable tool reference at index ${j}.`,
        { agent: agentName },
      );
      return '';
    });
    agents.set(agentName, {
      name: agentName,
      description,
      instructions: typeof entry.instructions === 'string' ? entry.instructions : '',
      tools,
      ...(declaredParameters ? { parameters: declaredParameters } : {}),
    });
  }

  const declaredFront =
    (typeof raw.front_man === 'string' && raw.front_man) ||
    (typeof metadata.front_man === 'string' && metadata.front_man) ||
    entries[0]?.name;
  if (!declaredFront || !agents.has(declaredFront)) {
    fail(
      ERROR_CODES.networkInvalid,
      `Network "${name}": front agent "${declaredFront ?? ''}" is not defined in the network.`,
      { frontMan: declaredFront },
    );
  }

  // Reference integrity: every internal reference must name an agent in this
  // network, a peer network URL, or a capability the site registers at boot.
  for (const agent of agents.values()) {
    for (const tool of agent.tools) {
      if (typeof tool !== 'string') continue;
      const isUrl = /^https?:\/\//i.test(tool);
      if (!isUrl && (agents.has(tool) || capabilities.has(tool))) continue;
      if (isUrl) {
        try {
          new URL(tool);
        } catch {
          fail(
            ERROR_CODES.networkInvalid,
            `Network "${name}": agent "${agent.name}" references a malformed peer URL "${tool}".`,
            { agent: agent.name },
          );
        }
      }
      // A remaining bare name is a site action (or MCP/coded tool) that the
      // caller's registry must provide; dispatch fails closed when it cannot.
    }
  }

  for (const capabilityName of capabilities.keys()) {
    if (agents.has(capabilityName)) {
      fail(
        ERROR_CODES.networkInvalid,
        `Network "${name}": "${capabilityName}" is declared as both an agent and a capability.`,
      );
    }
  }

  const llmConfig = isPlainObject(raw.llm_config) ? raw.llm_config : {};
  const maxExecutionSeconds =
    typeof raw.max_execution_seconds === 'number' ? raw.max_execution_seconds : undefined;

  return {
    name,
    description:
      typeof metadata.description === 'string'
        ? metadata.description
        : typeof raw.description === 'string'
          ? raw.description
          : '',
    frontMan: declaredFront,
    agents,
    capabilities,
    metadata,
    raw,
    modelName: typeof llmConfig.model_name === 'string' ? llmConfig.model_name : undefined,
    maxExecutionSeconds,
    source: {
      baseUrl: options.baseUrl ?? '',
      origin: options.origin ?? '',
      isPeer: options.isPeer === true,
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Routers
 * ------------------------------------------------------------------------- */

/**
 * @typedef {object} RouterChatRequest
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} [content]
 * @property {string} [tool_call_id]
 * @property {string} [name]
 * @property {{id: string, type: 'function', function: {name: string, arguments: string}}[]} [tool_calls]
 */

/**
 * @typedef {object} RouterReply
 * @property {string} content
 * @property {{id: string, name: string, arguments: Record<string, unknown>}[]} toolCalls
 */

/**
 * @typedef {object} Router
 * @property {string} id
 * @property {string} label
 * @property {{kind: 'demo'|'byok'|'site', model?: string, baseUrl?: string, provider?: string}} info
 * @property {(request: {messages: RouterChatRequest[], tools: object[], toolChoice?: string, signal?: AbortSignal, onDelta?: (text: string) => void, context: Record<string, unknown>}) => Promise<RouterReply>} chat
 */

const DEMO_ROUTER_ID = 'demo-deterministic';

/**
 * A deterministic router: it runs a published network without any model.
 *
 * It is not a language model and does not claim to be one. It reads the
 * network's own `metadata.demo_routes` routing table, delegates to the
 * specialist the route names, calls that specialist's declared site actions in
 * order, and returns an answer assembled from the tools' own summaries. Every
 * answer therefore comes from real tool results, and the interface labels it.
 *
 * Networks that carry no `demo_routes` cannot be run this way; the router
 * refuses with `unavailable` instead of inventing an answer.
 *
 * @returns {Router}
 */
export function createDemoRouter() {
  return {
    id: DEMO_ROUTER_ID,
    label: 'Demo router (no model)',
    info: { kind: 'demo' },
    async chat(request) {
      const { context } = request;
      const network = context.network;
      const agent = context.agent;
      const step = context.step ?? 0;
      const results = Array.isArray(context.results) ? context.results : [];
      const demoRoutes = isPlainObject(network.metadata?.demo_routes) ? network.metadata.demo_routes : null;
      if (!demoRoutes) {
        fail(
          ERROR_CODES.unavailable,
          `Network "${network.name}" publishes no demo routing table, so it cannot run without a model. Choose a provider and key in model settings.`,
          { network: network.name, router: DEMO_ROUTER_ID },
        );
      }
      const plan = demoRoutes[agent.name];
      if (!isPlainObject(plan)) {
        fail(
          ERROR_CODES.unavailable,
          `The demo router has no route for agent "${agent.name}". Choose a provider and key in model settings.`,
          { network: network.name, agent: agent.name },
        );
      }

      const input = String(context.input ?? '');
      const callable = new Set(agent.toolNames);

      const matchedRoute = pickDemoRoute(plan, input);
      const delegateRoute = !agent.isFront
        ? null
        : (matchedRoute && typeof matchedRoute.delegate === 'string' ? matchedRoute : null) ??
          (isPlainObject(plan.fallback) && typeof plan.fallback.delegate === 'string' ? plan.fallback : null);

      if (agent.isFront && delegateRoute) {
        if (step > 0) {
          const last = results[results.length - 1];
          const text = last?.text ?? last?.summary ?? 'The specialist returned no answer.';
          return { content: String(text), toolCalls: [] };
        }
        if (!callable.has(delegateRoute.delegate)) {
          fail(
            ERROR_CODES.toolNotAllowed,
            `Agent "${agent.name}" cannot delegate to "${delegateRoute.delegate}": the network does not declare that agent as one of its tools.`,
          );
        }
        return {
          content: '',
          toolCalls: [
            {
              id: `demo-${step}-delegate`,
              name: delegateRoute.delegate,
              arguments: { request: input },
            },
          ],
        };
      }

      // A failed tool ends the plan: answering from a failure is honest, and
      // continuing to the next action would act on data that does not exist.
      const failed = results.find((result) => result && result.ok === false);
      if (failed) {
        return { content: String(failed.summary ?? 'The tool failed.'), toolCalls: [] };
      }

      const route = matchedRoute ?? plan.default ?? { actions: [] };
      const actions = Array.isArray(route.actions) ? route.actions : [];
      if (step < actions.length) {
        const next = actions[step];
        const actionName = typeof next === 'string' ? next : next?.name;
        if (!callable.has(actionName)) {
          fail(
            ERROR_CODES.toolNotAllowed,
            `Agent "${agent.name}" cannot call "${actionName}": the network does not declare it as a tool.`,
          );
        }
        const args = typeof next === 'string' ? {} : substituteDemoArgs(next?.args, input);
        return {
          content: '',
          toolCalls: [{ id: `demo-${step}-${actionName}`, name: actionName, arguments: args }],
        };
      }
      // A route may name the results its answer should be built from, so the
      // answer is not a transcript of every tool the specialist happened to run.
      const answerNames = Array.isArray(route.answer) ? route.answer.map(String) : null;
      const answerResults = answerNames
        ? results.filter((result) => answerNames.includes(String(result?.name ?? '')))
        : results;
      const text = answerResults
        .map((result) => result?.summary ?? result?.text ?? '')
        .filter((line) => typeof line === 'string' && line.trim() !== '')
        .join('\n\n');
      return {
        content:
          text ||
          `I ran ${actions.length} tool${actions.length === 1 ? '' : 's'} on this lot and every one returned an empty summary.`,
        toolCalls: [],
      };
    },
  };
}

/**
 * @param {Record<string, unknown>} plan
 * @param {string} input
 */
function pickDemoRoute(plan, input) {
  const routes = Array.isArray(plan.routes) ? plan.routes : [];
  const haystack = input.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const route of routes) {
    if (!isPlainObject(route) || !Array.isArray(route.match)) continue;
    let score = 0;
    for (const token of route.match) {
      const needle = String(token).toLowerCase();
      if (needle && haystack.includes(needle)) score += needle.length;
    }
    if (score > bestScore) {
      best = route;
      bestScore = score;
    }
  }
  return best;
}

/**
 * @param {Record<string, unknown> | undefined} args
 * @param {string} input
 */
function substituteDemoArgs(args, input) {
  if (!isPlainObject(args)) return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'string' ? value.replaceAll('{{input}}', input) : value;
  }
  return out;
}

/**
 * OpenAI-compatible chat-completions router with streaming and tool calls.
 * Works with Otari, OpenRouter, OpenAI, Groq, vLLM, LM Studio and anything else
 * that speaks `/chat/completions`. The key is held here and attached to this
 * endpoint only.
 *
 * @param {{baseUrl: string, model: string, apiKey?: string, provider?: string, headers?: Record<string,string>, fetchImpl?: typeof fetch, temperature?: number, maxTokens?: number}} options
 * @returns {Router}
 */
export function createOpenAICompatibleRouter(options) {
  const baseUrl = String(options.baseUrl ?? '').replace(/\/+$/, '');
  const model = String(options.model ?? '');
  const apiKey = options.apiKey ?? '';
  const provider = options.provider ?? 'openai-compatible';
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (!baseUrl) fail(ERROR_CODES.routerMissing, 'A router base URL is required.');
  if (typeof doFetch !== 'function') fail(ERROR_CODES.routerMissing, 'No fetch implementation is available.');

  return {
    id: `byok:${provider}`,
    label: `${provider} · ${model || 'no model selected'}`,
    info: { kind: 'byok', baseUrl, model, provider },
    async chat(request) {
      if (!model) {
        fail(ERROR_CODES.keyMissing, 'Choose a model in model settings before sending a message.', { provider });
      }
      if (!apiKey) {
        fail(ERROR_CODES.keyMissing, 'Add an API key in model settings before sending a message.', { provider });
      }
      const body = {
        model,
        stream: true,
        messages: request.messages.map(toWireMessage),
        ...(request.tools.length > 0 ? { tools: request.tools, tool_choice: 'auto' } : {}),
        ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
        ...(typeof options.maxTokens === 'number' ? { max_tokens: options.maxTokens } : {}),
      };
      let response;
      try {
        response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            ...(options.headers ?? {}),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        fail(ERROR_CODES.routerFailed, `Could not reach the model router: ${describeError(error)}`, {
          provider,
        });
      }
      if (!response.ok) {
        const detail = await safeText(response);
        fail(
          ERROR_CODES.routerFailed,
          `${provider} refused the request (${response.status}). ${detail.slice(0, 300)}`.trim(),
          { status: response.status, provider },
        );
      }
      if (!response.body || typeof response.body.getReader !== 'function') {
        const payload = await safeJson(response);
        const choice = payload?.choices?.[0];
        return {
          content: choice?.message?.content ?? '',
          toolCalls: normalizeToolCalls(choice?.message?.tool_calls),
        };
      }
      return readStreamingCompletion(response, request.onDelta);
    },
  };
}

/** @param {RouterChatRequest} message */
function toWireMessage(message) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.tool_call_id,
      content: message.content ?? '',
    };
  }
  if (message.tool_calls) {
    return { role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls };
  }
  return { role: message.role, content: message.content ?? '' };
}

/** @param {unknown} raw */
function normalizeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((call) => isPlainObject(call) && isPlainObject(call.function))
    .map((call, i) => ({
      id: typeof call.id === 'string' && call.id ? call.id : `call-${i}`,
      name: String(call.function.name ?? ''),
      arguments: safeParseArguments(call.function.arguments),
    }));
}

/** @param {unknown} raw */
function safeParseArguments(raw) {
  if (isPlainObject(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    fail(ERROR_CODES.schemaInvalid, 'The model produced tool arguments that are not valid JSON.');
  }
  return {};
}

/**
 * @param {Response} response
 * @param {((text: string) => void) | undefined} onDelta
 * @returns {Promise<RouterReply>}
 */
async function readStreamingCompletion(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  /** @type {Map<number, {id: string, name: string, argumentText: string}>} */
  const calls = new Map();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf('\n');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = payload?.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content !== '') {
        content += delta.content;
        onDelta?.(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const index = typeof call.index === 'number' ? call.index : calls.size;
          const entry = calls.get(index) ?? { id: '', name: '', argumentText: '' };
          if (typeof call.id === 'string' && call.id) entry.id = call.id;
          if (isPlainObject(call.function)) {
            if (typeof call.function.name === 'string' && call.function.name) {
              entry.name = call.function.name;
            }
            if (typeof call.function.arguments === 'string') {
              entry.argumentText += call.function.arguments;
            }
          }
          calls.set(index, entry);
        }
      }
    }
  }

  return {
    content,
    toolCalls: [...calls.values()]
      .filter((entry) => entry.name !== '')
      .map((entry, i) => ({
        id: entry.id || `call-${i}`,
        name: entry.name,
        arguments: safeParseArguments(entry.argumentText),
      })),
  };
}

/** @param {Response} response */
async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** @param {Response} response */
async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** @param {unknown} error */
function describeError(error) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'the request was cancelled';
    return error.message;
  }
  return String(error);
}

/* ------------------------------------------------------------------------- *
 * Minimal MCP client (optional capability, profile §3.1)
 * ------------------------------------------------------------------------- */

/**
 * Minimal Model Context Protocol client over HTTP: `initialize`,
 * `notifications/initialized`, `tools/list`, `tools/call`. Accepts both plain
 * JSON and `text/event-stream` responses. Every entry point takes the caller's
 * consent hook through the runtime; this client itself never asks.
 *
 * @param {{url: string, fetchImpl?: typeof fetch, clientName?: string}} options
 */
function createMcpClient({ url, fetchImpl, clientName = 'portable-agent-runtime' }) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let nextId = 1;
  let initialized = false;
  let sessionId = null;

  const send = async (method, params, { notification = false } = {}) => {
    const id = notification ? undefined : nextId++;
    const response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) sessionId = session;
    if (!response.ok) {
      fail(ERROR_CODES.mcpFailed, `MCP endpoint refused "${method}" (${response.status}).`, { url, method });
    }
    if (notification) return null;
    const payload = await readJsonRpcBody(response);
    if (payload?.error) {
      fail(ERROR_CODES.mcpFailed, `MCP "${method}" failed: ${payload.error.message ?? 'unknown error'}`, {
        url,
        method,
      });
    }
    return payload?.result ?? null;
  };

  return {
    url,
    async initialize() {
      if (initialized) return;
      await send('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: clientName, version: AGENT_RUNTIME_VERSION },
      });
      await send('notifications/initialized', undefined, { notification: true });
      initialized = true;
    },
    async listTools() {
      await this.initialize();
      const result = await send('tools/list', {});
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      return tools.map((tool) => ({
        name: String(tool.name ?? ''),
        description: String(tool.description ?? ''),
        inputSchema: isPlainObject(tool.inputSchema) ? tool.inputSchema : { type: 'object' },
      }));
    },
    async callTool(name, args) {
      await this.initialize();
      const result = await send('tools/call', { name, arguments: args });
      return result;
    },
  };
}

/** @param {Response} response */
async function readJsonRpcBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(trimmed.slice(5).trim());
        if (parsed?.result !== undefined || parsed?.error !== undefined) return parsed;
      } catch {
        // keep looking for a well-formed event
      }
    }
    return null;
  }
  return safeJson(response);
}

/* ------------------------------------------------------------------------- *
 * Runtime
 * ------------------------------------------------------------------------- */

/** @typedef {object} SiteAction */

/**
 * @typedef {object} SiteActionSpec
 * @property {string} name
 * @property {string} purpose
 * @property {Record<string, unknown>} inputSchema JSON Schema for the arguments
 * @property {'read'|'write'|'irreversible'} [effect] defaults to `read`
 * @property {(args: Record<string, unknown>, context: {trace: (type: string, detail?: Record<string, unknown>) => void}) => Promise<{summary?: string, data?: unknown, view?: unknown, outcome?: 'verified'|'unknown'}>} handler
 */

/**
 * @param {import('./agent-runtime.mjs').RuntimeOptions} options
 */
export function createAgentRuntime(options = {}) {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') fail(ERROR_CODES.routerMissing, 'No fetch implementation is available.');
  const baseHref =
    options.baseHref ??
    (typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'http://localhost/');

  const limits = {
    maxStepsPerAgent: 8,
    maxAgentInvocations: 16,
    maxDepth: 3,
    maxRemoteCalls: 4,
    maxExecutionSeconds: 60,
    maxToolResultChars: 8000,
    maxHistoryMessages: 24,
    ...(options.limits ?? {}),
  };

  /** @type {Map<string, SiteActionSpec>} */
  const actions = new Map();
  for (const action of options.actions ?? []) {
    if (!action || typeof action.name !== 'string') continue;
    actions.set(action.name, { ...action, effect: action.effect ?? 'read' });
  }

  /** @type {Map<string, Network>} */
  const networks = new Map();
  /** @type {Map<string, {network: Network, baseUrl: string, origin: string, url: string}>} */
  const peers = new Map();
  /** @type {Map<string, {text: string, data?: unknown, view?: unknown}>} */
  const toolResults = new Map();
  /** @type {Map<string, string>} */
  const peerBindings = new Map();

  let siteManifest = null;
  /** @type {Record<string, Record<string, string>>} publisher-owned peer link map (links.json) */
  let siteLinks = {};
  let siteBaseUrl = options.siteBaseUrl
    ? absolutize(String(options.siteBaseUrl).replace(/\/+$/, ''), baseHref)
    : '';
  let router = options.router ?? createDemoRouter();
  let disposed = false;
  const events = [];
  const approvedOrigins = new Set();

  const emit = (type, detail = {}) => {
    const event = { type, at: new Date().toISOString(), ...detail };
    events.push(event);
    if (events.length > 500) events.shift();
    options.onEvent?.(event);
    return event;
  };

  const requireLive = () => {
    if (disposed) fail(ERROR_CODES.unavailable, 'This runtime has been disposed.');
  };

  const requestConsent = async (request) => {
    const consent = options.consent;
    emit('consent.request', { kind: request.kind, origin: request.origin, purpose: request.purpose });
    if (typeof consent !== 'function') {
      // Fail closed: no consent interface means no third-party contact.
      if (request.kind === 'action' && request.effect === 'read') return true;
      fail(
        ERROR_CODES.consentDenied,
        `This site did not provide a consent interface, so the runtime will not ${describeConsent(request)}.`,
        { kind: request.kind, origin: request.origin },
      );
    }
    const decision = await consent(request);
    emit('consent.decision', {
      kind: request.kind,
      origin: request.origin,
      approved: decision === true,
    });
    if (decision !== true) {
      fail(
        ERROR_CODES.consentDenied,
        `The visitor declined to ${describeConsent(request)}.`,
        { kind: request.kind, origin: request.origin },
      );
    }
    if (request.origin) approvedOrigins.add(request.origin);
    return true;
  };

  const requireOriginAllowed = async (origin, purpose) => {
    if (!origin) return true;
    const policy = siteManifest?.peer_policy;
    if ((policy?.deny_origins ?? []).includes(origin)) {
      fail(ERROR_CODES.peerBlocked, `This site's peer policy denies every contact with ${origin}.`, { origin });
    }
    const allowed = policy?.mode === 'open' || (siteManifest?.allowed_peers ?? []).includes(origin);
    // Consent is required on every contact; a published peer list only removes
    // the warning, never the visitor's decision (profile §3.2, §5).
    await requestConsent({
      kind: 'peer',
      origin,
      purpose: allowed ? purpose : `${purpose} (this origin is not in the site's published peer list)`,
    });
    return true;
  };

  /**
   * Publisher-owned peer-network link map (profile §3.3). A missing file is not
   * an error: the network simply has no symbolic peer references.
   * @param {string} base
   */
  const loadLinkMap = async (base) => {
    const url = resolveAgainst(base, 'links.json');
    try {
      const response = await doFetch(url, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        mode: 'cors',
      });
      if (!response.ok) return {};
      const parsed = await safeJson(response);
      if (!isPlainObject(parsed) || !isPlainObject(parsed.networks)) return {};
      /** @type {Record<string, Record<string, string>>} */
      const map = {};
      for (const [network, entries] of Object.entries(parsed.networks)) {
        if (!isPlainObject(entries)) continue;
        map[network] = {};
        for (const [name, target] of Object.entries(entries)) {
          if (typeof target === 'string') map[network][name] = target;
        }
      }
      emit('links.load', { url, networks: Object.keys(map) });
      return map;
    } catch {
      return {};
    }
  };

  const fetchJson = async (url, what) => {
    let response;
    try {
      response = await doFetch(url, {
        headers: { accept: 'application/json, application/hocon, text/plain;q=0.9' },
        credentials: 'omit',
        mode: 'cors',
      });
    } catch (error) {
      fail(
        ERROR_CODES.manifestUnavailable,
        `${what} could not be fetched from ${url} (${describeError(error)}). A cross-origin host must allow browser access with CORS.`,
        { url },
      );
    }
    if (!response.ok) {
      fail(ERROR_CODES.manifestUnavailable, `${what} returned HTTP ${response.status} from ${url}.`, { url });
    }
    const text = await safeText(response);
    return { text, contentType: response.headers.get('content-type') ?? '' };
  };

  const parseDefinition = (text, source) => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(text);
      } catch (error) {
        // A HOCON object also starts with "{" but allows comments and
        // unquoted keys; fall through to the HOCON reader.
        if (trimmed.includes('//') || trimmed.includes('#') || /[{,]\s*[A-Za-z_"'][^"]*\s*[:=]/.test(text)) {
          return parseHocon(text, { source });
        }
        fail(ERROR_CODES.parseFailed, `Network definition at ${source} is not valid JSON: ${describeError(error)}`);
      }
    }
    return parseHocon(text, { source });
  };

  const loadManifest = async () => {
    if (!options.manifestUrl) fail(ERROR_CODES.manifestInvalid, 'A manifest URL is required.');
    // A site may configure the manifest with a site-relative path; resolve it
    // against the page so every later fetch has an absolute base.
    const manifestUrl = absolutize(options.manifestUrl, baseHref);
    emit('manifest.load', { url: manifestUrl });
    const { text } = await fetchJson(manifestUrl, 'agent-manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch (error) {
      fail(ERROR_CODES.manifestInvalid, `agent-manifest.json is not valid JSON: ${describeError(error)}`, {
        url: manifestUrl,
      });
    }
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      fail(ERROR_CODES.manifestInvalid, `agent-manifest.json does not conform: ${errors.join('; ')}`, {
        url: manifestUrl,
        errors,
      });
    }
    siteManifest = manifest;
    siteBaseUrl = siteBaseUrl || deriveBaseUrl(manifestUrl);
    for (const entry of manifest.networks) {
      const definitionUrl = resolveAgainst(siteBaseUrl, entry.hocon);
      const definition = await loadDefinition(definitionUrl, entry.name, {
        baseUrl: siteBaseUrl,
        origin: new URL(definitionUrl).origin,
        isPeer: false,
      });
      networks.set(entry.name, {
        ...definition,
        description: entry.description ?? definition.description,
        sampleQueries: Array.isArray(entry.sample_queries) ? entry.sample_queries : [],
      });
    }
    if (manifest.linking?.link_map !== false) {
      siteLinks = await loadLinkMap(siteBaseUrl);
    }
    emit('manifest.ready', {
      networks: [...networks.keys()],
      brand: manifest.brand ?? null,
      linkMap: Object.keys(siteLinks).length,
    });
    return siteManifest;
  };

  const loadDefinition = async (url, name, source) => {
    const { text } = await fetchJson(url, `Network definition "${name}"`);
    const parsed = parseDefinition(text, url);
    const network = resolveNetwork(parsed, { name, ...source });
    emit('network.validate', { network: network.name, agents: network.agents.size, origin: source.origin });
    return network;
  };

  /** Resolve a peer-network URL: `<base>/<network-name>` (profile §3.2 step 1). */
  const resolvePeer = async (url) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url, siteBaseUrl || undefined);
    } catch {
      fail(ERROR_CODES.networkNotFound, `"${url}" is not a usable peer-network URL.`, { url });
    }
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      fail(ERROR_CODES.networkNotFound, `A peer URL must end with the network name: ${url}`, { url });
    }
    const networkName = decodeURIComponent(segments[segments.length - 1]);
    const basePath = segments.slice(0, -1).join('/');
    const baseUrl = `${parsedUrl.origin}${basePath ? `/${basePath}` : ''}`;
    const origin = parsedUrl.origin;

    await requireOriginAllowed(origin, `load the agent network "${networkName}" published at ${origin}`);

    emit('peer.load', { url, origin, network: networkName });
    const { text } = await fetchJson(resolveAgainst(baseUrl, 'agent-manifest.json'), `Peer manifest at ${origin}`);
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch (error) {
      fail(ERROR_CODES.manifestInvalid, `The peer manifest at ${origin} is not valid JSON: ${describeError(error)}`, {
        origin,
      });
    }
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      fail(ERROR_CODES.manifestInvalid, `The peer manifest at ${origin} does not conform: ${errors.join('; ')}`, {
        origin,
        errors,
      });
    }
    const entry = manifest.networks.find((network) => network.name === networkName);
    if (!entry) {
      fail(
        ERROR_CODES.networkNotFound,
        `${origin} publishes [${manifest.networks.map((n) => n.name).join(', ')}], not "${networkName}".`,
        { origin, network: networkName },
      );
    }
    const definitionUrl = resolveAgainst(baseUrl, entry.hocon);
    if (new URL(definitionUrl).origin !== origin) {
      // A definition elsewhere is a new destination and needs its own consent.
      await requestConsent({
        kind: 'peer',
        origin: new URL(definitionUrl).origin,
        purpose: `fetch the network definition for "${networkName}"`,
      });
    }
    const network = await loadDefinition(definitionUrl, networkName, {
      baseUrl,
      origin,
      isPeer: true,
    });
    const peer = {
      url,
      baseUrl,
      origin,
      network: { ...network, description: entry.description ?? network.description, sampleQueries: Array.isArray(entry.sample_queries) ? entry.sample_queries : [] },
      manifest,
    };
    peers.set(networkName, peer);
    emit('peer.ready', { origin, network: networkName, agents: network.agents.size });
    return peer;
  };

  /**
   * Build the model-visible tool list for one agent, and keep the mapping from
   * exposed function names back to what they really are.
   * @param {Network} network
   * @param {AgentSpec} agent
   */
  const describeTools = (network, agent) => {
    const exposed = [];
    const byName = new Map();
    for (const tool of agent.tools) {
      if (typeof tool !== 'string') {
        const slug = slugify(tool.url);
        for (const remoteName of tool.tools ?? []) {
          const exposedName = `mcp_${slug}_${slugify(remoteName)}`;
          if (byName.has(exposedName)) continue;
          exposed.push({
            type: 'function',
            function: {
              name: exposedName,
              description: `Calls "${remoteName}" on the MCP server at ${tool.url}.`,
              parameters: {
                type: 'object',
                properties: { arguments: { type: 'object' } },
                required: ['arguments'],
              },
            },
          });
          byName.set(exposedName, { kind: 'mcp', url: tool.url, remoteName });
        }
        continue;
      }
      if (/^https?:\/\//i.test(tool)) {
        const exposedName = `peer_${slugify(tool)}`;
        if (byName.has(exposedName)) continue;
        exposed.push({
          type: 'function',
          function: {
            name: exposedName,
            description: `Asks the agent network published at ${tool} for help with one request.`,
            parameters: {
              type: 'object',
              properties: { query: { type: 'string', description: 'The request for that site.' } },
              required: ['query'],
            },
          },
        });
        byName.set(exposedName, { kind: 'peer', url: tool });
        continue;
      }
      const localAgent = network.agents.get(tool);
      if (localAgent) {
        exposed.push({
          type: 'function',
          function: {
            name: localAgent.name,
            description: localAgent.description,
            parameters:
              isPlainObject(localAgent.parameters) && localAgent.parameters.type
                ? localAgent.parameters
                : {
                    type: 'object',
                    properties: { request: { type: 'string', description: 'What you need from this agent.' } },
                    required: ['request'],
                  },
          },
        });
        byName.set(localAgent.name, { kind: 'agent', agent: localAgent.name });
        continue;
      }
      const capability = network.capabilities?.get(tool);
      if (capability) {
        const peerUrl = capability.url ?? siteLinks[network.name]?.[tool] ?? peerBindings.get(tool);
        if (peerUrl) {
          const exposedName = `peer_${slugify(tool)}`;
          if (byName.has(exposedName)) continue;
          exposed.push({
            type: 'function',
            function: {
              name: exposedName,
              description: capability.description || `Asks ${peerUrl} for help with one request.`,
              parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'The request for that site.' } },
                required: ['query'],
              },
            },
          });
          byName.set(exposedName, { kind: 'peer', url: peerUrl });
          continue;
        }
        const capabilityAction = actions.get(tool);
        if (capabilityAction) {
          exposed.push({
            type: 'function',
            function: {
              name: capabilityAction.name,
              description: `${capabilityAction.purpose}${capabilityAction.effect && capabilityAction.effect !== 'read' ? ` (effect: ${capabilityAction.effect}; the visitor confirms first)` : ''}`,
              parameters: isPlainObject(capabilityAction.inputSchema)
                ? capabilityAction.inputSchema
                : { type: 'object' },
            },
          });
          byName.set(capabilityAction.name, { kind: 'action', action: capabilityAction });
          continue;
        }
        byName.set(tool, { kind: 'missing' });
        continue;
      }
      const linkedPeer =
        siteLinks[network.name]?.[tool] ??
        (isPlainObject(network.raw?.links) ? network.raw.links[tool] : undefined) ??
        (isPlainObject(network.raw?.metadata?.links) ? network.raw.metadata.links[tool] : undefined) ??
        peerBindings.get(tool);
      if (typeof linkedPeer === 'string') {
        const exposedName = `peer_${slugify(tool)}`;
        if (byName.has(exposedName)) continue;
        exposed.push({
          type: 'function',
          function: {
            name: exposedName,
            description: `Asks the agent network published at ${linkedPeer} for help with one request.`,
            parameters: {
              type: 'object',
              properties: { query: { type: 'string', description: 'The request for that site.' } },
              required: ['query'],
            },
          },
        });
        byName.set(exposedName, { kind: 'peer', url: linkedPeer });
        continue;
      }
      const action = actions.get(tool);
      if (action) {
        exposed.push({
          type: 'function',
          function: {
            name: action.name,
            description: `${action.purpose}${action.effect && action.effect !== 'read' ? ` (effect: ${action.effect}; the visitor confirms first)` : ''}`,
            parameters: isPlainObject(action.inputSchema) ? action.inputSchema : { type: 'object' },
          },
        });
        byName.set(action.name, { kind: 'action', action });
        continue;
      }
      byName.set(tool, { kind: 'missing' });
    }
    return { exposed, byName };
  };

  const buildSystemPrompt = (network, agent, slyData) => {
    const lines = [];
    lines.push(`You are "${agent.name}", an agent in the network "${network.name}".`);
    lines.push(agent.description);
    if (agent.instructions.trim()) lines.push('', agent.instructions.trim());
    lines.push(
      '',
      'Rules:',
      '- Use only the tools listed for you. Never invent a measurement, a die, a bin or a fact id.',
      '- Every claim you make about the lot must come from a tool result in this conversation.',
      '- When you cite evidence, use the ids the tools return (for example fact:spatial:primary).',
      '- If a tool fails, say which one failed and what is missing. Do not present a failure as a result.',
    );
    if (network.source.isPeer) {
      lines.push(
        '- You are running on another site as a loaded peer network: you have no access to that site’s functions, only to the tools above.',
      );
    }
    const allowed = slyDataAllowList(network);
    if (allowed.length > 0 && slyData) {
      const subset = {};
      for (const key of allowed) {
        if (slyData[key] !== undefined) subset[key] = slyData[key];
      }
      if (Object.keys(subset).length > 0) {
        lines.push('', `Visitor-approved private context (do not echo verbatim): ${JSON.stringify(subset)}`);
      }
    }
    return lines.join('\n');
  };

  const dispatch = async (network, agent, call, ctx) => {
    const mapping = ctx.tools.byName.get(call.name);
    if (!mapping || mapping.kind === 'missing') {
      fail(
        ERROR_CODES.toolUnknown,
        `Agent "${agent.name}" called "${call.name}", which this site cannot provide. The network declares it, so the caller’s registry must register it before the agent can use it.`,
        { agent: agent.name, tool: call.name },
      );
    }

    if (mapping.kind === 'agent') {
      const subAgent = network.agents.get(mapping.agent);
      const request = stringArg(call.arguments, ['request', 'query', 'input']);
      emit('tool.call', { kind: 'agent', from: agent.name, to: subAgent.name, callId: call.id });
      const text = await runAgent(network, subAgent, request, ctx, ctx.depth + 1);
      return { kind: 'agent', summary: text, text, agent: subAgent.name, callId: call.id };
    }

    if (mapping.kind === 'action') {
      const action = mapping.action;
      const violations = validateJsonSchema(action.inputSchema, call.arguments ?? {});
      if (violations.length > 0) {
        fail(
          ERROR_CODES.schemaInvalid,
          `Arguments for "${action.name}" are invalid: ${violations.join('; ')}`,
          { tool: action.name, violations },
        );
      }
      const effect = action.effect ?? 'read';
      if (effect !== 'read') {
        await requestConsent({
          kind: 'action',
          name: action.name,
          origin: network.source.origin || siteBaseUrl,
          effect,
          args: call.arguments ?? {},
          purpose: action.purpose,
          callId: call.id,
        });
      }
      const requestId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      emit('action.call', { tool: action.name, effect, args: call.arguments ?? {}, requestId });
      let result;
      try {
        result = await action.handler(call.arguments ?? {}, {
          trace: (type, detail) => emit(type, { tool: action.name, ...detail }),
          visit: (id) => visitToolResult(id),
        });
      } catch (error) {
        const outcome = effect === 'read' ? 'failed' : 'unknown';
        emit('action.result', { tool: action.name, ok: false, outcome, requestId });
        return {
          kind: 'action',
          name: action.name,
          callId: call.id,
          ok: false,
          outcome,
          requestId,
          error: describeError(error),
          summary: `"${action.name}" failed: ${describeError(error)}${outcome === 'unknown' ? '. The outcome of this effect is unknown; the runtime will not repeat it.' : ''}`,
        };
      }
      const outcome = result?.outcome ?? (effect === 'read' ? 'verified' : 'verified');
      emit('action.result', { tool: action.name, ok: true, outcome, requestId });
      return {
        kind: 'action',
        name: action.name,
        callId: call.id,
        ok: true,
        effect,
        outcome,
        requestId,
        summary: result?.summary ?? `${action.name} completed.`,
        data: result?.data,
        view: result?.view,
      };
    }

    if (mapping.kind === 'peer') {
      if (ctx.remoteCalls >= limits.maxRemoteCalls) {
        fail(
          ERROR_CODES.budgetExceeded,
          `This run reached its limit of ${limits.maxRemoteCalls} third-party contacts, so "${mapping.url}" was not contacted.`,
        );
      }
      ctx.remoteCalls += 1;
      const query = stringArg(call.arguments, ['query', 'request', 'input']);
      const peer = peers.get(networkNameFromUrl(mapping.url)) ?? (await resolvePeer(resolvePeerUrl(mapping.url, network)));
      emit('tool.call', { kind: 'peer', from: agent.name, url: mapping.url, callId: call.id });
      const text = await runAgent(peer.network, peer.network.agents.get(peer.network.frontMan), query, ctx, ctx.depth + 1, {
        peerOrigin: peer.origin,
      });
      return { kind: 'peer', summary: text, text, origin: peer.origin, callId: call.id };
    }

    if (mapping.kind === 'mcp') {
      if (ctx.remoteCalls >= limits.maxRemoteCalls) {
        fail(ERROR_CODES.budgetExceeded, `This run reached its limit of ${limits.maxRemoteCalls} third-party contacts.`);
      }
      ctx.remoteCalls += 1;
      const origin = new URL(mapping.url).origin;
      await requestConsent({
        kind: 'mcp',
        origin,
        purpose: `call "${mapping.remoteName}" on the MCP server at ${origin}`,
      });
      const client = createMcpClient({ url: mapping.url, fetchImpl: doFetch });
      emit('tool.call', { kind: 'mcp', url: mapping.url, tool: mapping.remoteName, callId: call.id });
      const result = await client.callTool(mapping.remoteName, isPlainObject(call.arguments?.arguments) ? call.arguments.arguments : {});
      return {
        kind: 'mcp',
        summary: summarizeMcpResult(result),
        data: result,
        origin,
        callId: call.id,
      };
    }

    fail(ERROR_CODES.toolUnknown, `Unsupported tool "${call.name}".`);
    return null;
  };

  const runAgent = async (network, agent, input, ctx, depth, extra = {}) => {
    requireLive();
    if (!agent) {
      fail(ERROR_CODES.networkInvalid, `Network "${network.name}" has no such agent.`);
    }
    if (depth > limits.maxDepth) {
      fail(
        ERROR_CODES.depthExceeded,
        `Delegation stopped at depth ${depth}: the network's limit is ${limits.maxDepth} hops.`,
        { network: network.name, agent: agent.name },
      );
    }
    if (ctx.invocations >= limits.maxAgentInvocations) {
      fail(
        ERROR_CODES.budgetExceeded,
        `This run reached its limit of ${limits.maxAgentInvocations} agent invocations.`,
      );
    }
    const key = `${network.source.origin}|${network.name}|${agent.name}`;
    if (ctx.stack.includes(key)) {
      fail(
        ERROR_CODES.cycleDetected,
        `Stopped a composition cycle: "${agent.name}" was asked to run while it was already running.`,
        { agent: agent.name },
      );
    }
    ctx.invocations += 1;
    ctx.stack.push(key);
    const startedAt = Date.now();
    emit('agent.invoke', {
      network: network.name,
      agent: agent.name,
      depth,
      peerOrigin: extra.peerOrigin ?? null,
      input: truncate(input, 400),
    });

    try {
      const tools = describeTools(network, agent);
      const missing = [...tools.byName.entries()].filter(([, value]) => value.kind === 'missing');
      if (missing.length > 0) {
        fail(
          ERROR_CODES.toolUnknown,
          `Agent "${agent.name}" declares ${missing.map(([name]) => `"${name}"`).join(', ')}, which this site does not register. The runtime fails closed instead of dropping the capability.`,
          { agent: agent.name, missing: missing.map(([name]) => name) },
        );
      }
      ctx.tools = tools;
      const messages = [
        { role: 'system', content: buildSystemPrompt(network, agent, ctx.slyData) },
        { role: 'user', content: String(input ?? '') },
      ];
      const agentCtx = {
        network: {
          name: network.name,
          description: network.description,
          metadata: network.metadata,
          frontMan: network.frontMan,
          source: network.source,
        },
        agent: {
          name: agent.name,
          description: agent.description,
          instructions: agent.instructions,
          isFront: agent.name === network.frontMan,
          toolNames: [...tools.byName.keys()],
        },
        input,
        step: 0,
        results: [],
        depth,
      };

      const localResults = [];
      for (let step = 0; step < limits.maxStepsPerAgent; step += 1) {
        if (Date.now() - ctx.startedAt > (ctx.limitMs ?? limits.maxExecutionSeconds * 1000)) {
          fail(
            ERROR_CODES.budgetExceeded,
            `This run reached its ${Math.round((ctx.limitMs ?? limits.maxExecutionSeconds * 1000) / 1000)}s execution limit.`,
          );
        }
        agentCtx.step = step;
        agentCtx.results = localResults;
        emit('model.request', {
          agent: agent.name,
          step,
          router: router.id,
          model: router.info?.model ?? null,
        });
        let reply;
        try {
          reply = await router.chat({
            messages: trimHistory(messages, limits.maxHistoryMessages),
            tools: tools.exposed,
            signal: ctx.signal,
            onDelta: (text) => emit('model.delta', { agent: agent.name, step, text }),
            context: agentCtx,
          });
        } catch (error) {
          if (error instanceof AgentRuntimeError) throw error;
          fail(ERROR_CODES.routerFailed, `The model router failed: ${describeError(error)}`);
        }
        const calls = Array.isArray(reply?.toolCalls) ? reply.toolCalls : [];
        if (calls.length === 0) {
          const content = typeof reply?.content === 'string' ? reply.content : '';
          emit('agent.return', {
            network: network.name,
            agent: agent.name,
            depth,
            ms: Date.now() - startedAt,
            chars: content.length,
          });
          ctx.stack.pop();
          return content;
        }
        messages.push({
          role: 'assistant',
          content: reply.content ?? '',
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
          })),
        });
        for (const call of calls) {
          let result;
          try {
            result = await dispatch(network, agent, call, ctx);
          } catch (error) {
            const detail = error instanceof AgentRuntimeError ? error : null;
            emit('tool.error', {
              tool: call.name,
              code: detail?.code ?? 'error',
              message: describeError(error),
            });
            throw error;
          }
          const summary = result.summary ?? '';
          if (result.kind === 'action' && result.data !== undefined) {
            toolResults.set(result.requestId ?? call.id, {
              text: summary,
              data: result.data,
              view: result.view,
            });
          }
          localResults.push({ ...result, requestId: result.requestId ?? call.id });
          emit('tool.result', {
            tool: call.name,
            kind: result.kind,
            ok: result.ok !== false,
            summary: truncate(summary, 400),
            requestId: result.requestId ?? call.id,
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: truncate(JSON.stringify({ summary, data: result.data ?? null }), limits.maxToolResultChars),
          });
        }
      }
      fail(
        ERROR_CODES.budgetExceeded,
        `Agent "${agent.name}" used all ${limits.maxStepsPerAgent} steps without answering. The runtime stopped instead of looping.`,
        { agent: agent.name },
      );
      return '';
    } finally {
      // `pop` is idempotent here: the success path pops explicitly so the
      // caller's stack stays accurate while the promise resolves.
      if (ctx.stack[ctx.stack.length - 1] === key) ctx.stack.pop();
    }
  };

  const visitToolResult = (requestId) => toolResults.get(requestId) ?? null;

  const runtime = {
    /** @returns {Promise<{networks: string[], brand?: string, manifest: unknown}>} */
    async ready() {
      requireLive();
      if (siteManifest === null) await loadManifest();
      return {
        networks: [...networks.keys()],
        brand: siteManifest?.brand ?? undefined,
        manifest: siteManifest,
      };
    },

    /** @returns {Network[]} */
    listNetworks() {
      return [...networks.values()];
    },

    /** @returns {Network | null} */
    getNetwork(name) {
      return networks.get(name) ?? null;
    },

    get manifest() {
      return siteManifest;
    },

    get routerInfo() {
      return { id: router.id, label: router.label, info: router.info };
    },

    /** Swap the inference path without touching the network (profile §4). */
    setRouter(nextRouter) {
      if (!nextRouter || typeof nextRouter.chat !== 'function') {
        fail(ERROR_CODES.routerMissing, 'A router must implement chat().');
      }
      router = nextRouter;
      emit('router.change', { router: nextRouter.id, model: nextRouter.info?.model ?? null });
    },

    /**
     * Run a published network in this tab.
     * @param {{network?: string, input: string, slyData?: Record<string, unknown>, history?: {role: 'user'|'assistant', content: string}[], signal?: AbortSignal}} request
     */
    async run(request) {
      requireLive();
      if (siteManifest === null) await loadManifest();
      const name = request.network ?? [...networks.keys()][0];
      const network = networks.get(name);
      if (!network) {
        fail(
          ERROR_CODES.networkNotFound,
          `This site publishes [${[...networks.keys()].join(', ')}], not "${name}".`,
          { network: name },
        );
      }
      // A network may tighten its own budget, never raise the caller's.
      const executionLimitMs =
        Math.min(network.maxExecutionSeconds ?? limits.maxExecutionSeconds, limits.maxExecutionSeconds) * 1000;
      const ctx = {
        invocations: 0,
        remoteCalls: 0,
        stack: [],
        slyData: request.slyData ?? {},
        startedAt: Date.now(),
        signal: request.signal,
        tools: { exposed: [], byName: new Map() },
        limitMs: executionLimitMs,
      };
      emit('run.start', { network: network.name, router: router.id, input: truncate(request.input, 400) });
      const runStarted = Date.now();
      try {
        const text = await runAgent(network, network.agents.get(network.frontMan), request.input, ctx, 0);
        const result = {
          ok: true,
          network: network.name,
          router: { id: router.id, label: router.label, info: router.info },
          text,
          ms: Date.now() - runStarted,
          invocations: ctx.invocations,
          remoteCalls: ctx.remoteCalls,
          events: [...events],
        };
        emit('run.end', {
          network: network.name,
          ok: true,
          ms: result.ms,
          invocations: result.invocations,
          remoteCalls: result.remoteCalls,
        });
        return result;
      } catch (error) {
        const runtimeError =
          error instanceof AgentRuntimeError
            ? error
            : new AgentRuntimeError(ERROR_CODES.routerFailed, describeError(error));
        emit('run.end', {
          network: network.name,
          ok: false,
          code: runtimeError.code,
          message: runtimeError.message,
          ms: Date.now() - runStarted,
        });
        throw runtimeError;
      }
    },

    /**
     * Load another site's published network into this tab (profile §3.2).
     * Requires the visitor's approval, resolved through the consent hook.
     * @param {string} url
     */
    async connectPeer(url) {
      requireLive();
      if (siteManifest === null) await loadManifest();
      return resolvePeer(url);
    },

    /**
     * Run a peer network already loaded with `connectPeer`, on this visitor's
     * router and this site's limits.
     * @param {string} url
     * @param {string} input
     */
    async runPeer(url, input) {
      requireLive();
      const peer = peers.get(networkNameFromUrl(url)) ?? (await resolvePeer(url));
      const ctx = {
        invocations: 0,
        remoteCalls: 0,
        stack: [],
        slyData: {}, // private context never crosses an origin boundary
        startedAt: Date.now(),
        tools: { exposed: [], byName: new Map() },
      };
      emit('run.start', { network: peer.network.name, peerOrigin: peer.origin, router: router.id });
      const text = await runAgent(
        peer.network,
        peer.network.agents.get(peer.network.frontMan),
        input,
        ctx,
        0,
        { peerOrigin: peer.origin },
      );
      return { ok: true, network: peer.network.name, peerOrigin: peer.origin, text, ms: 0 };
    },

    /** Caller-owned binding for a symbolic peer reference (profile §3.3). */
    setPeerBinding(name, url) {
      peerBindings.set(name, url);
      emit('peer.binding', { name, url, owner: 'caller' });
    },

    /** Read a stored tool result by the receipt id a tool card shows. */
    getToolResult(requestId) {
      return toolResults.get(requestId) ?? null;
    },

    /** Observable execution for the interface (profile §5). */
    getEvents() {
      return [...events];
    },

    dispose() {
      disposed = true;
      events.length = 0;
      peers.clear();
      networks.clear();
      toolResults.clear();
    },
  };

  return runtime;
}

/* ------------------------------------------------------------------------- *
 * Small helpers
 * ------------------------------------------------------------------------- */

/** @param {Network} network */
function slyDataAllowList(network) {
  const rules = network.metadata?.sly_data;
  if (isPlainObject(rules) && Array.isArray(rules.allow)) return rules.allow.map(String);
  return [];
}

/**
 * @param {{role: string, content?: string}[]} messages
 * @param {number} limit
 */
function trimHistory(messages, limit) {
  if (messages.length <= limit) return messages;
  const [system, ...rest] = messages;
  const keep = rest.slice(rest.length - (limit - 1));
  // Tool results must stay paired with the assistant message that requested
  // them; drop leading orphans instead of breaking the protocol.
  while (keep.length > 0 && keep[0].role === 'tool') keep.shift();
  return [system, ...keep];
}

/** @param {Record<string, unknown>} args @param {string[]} names */
function stringArg(args, names) {
  for (const name of names) {
    const value = args?.[name];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  const [first] = Object.values(args ?? {});
  if (typeof first === 'string' && first.trim() !== '') return first;
  fail(ERROR_CODES.schemaInvalid, 'This tool needs a non-empty request text.');
  return '';
}

/** @param {string} value @param {number} max */
function truncate(value, max) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** @param {string} value */
function slugify(value) {
  return String(value)
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'tool';
}

/** @param {string} href @param {string} base */
function absolutize(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** @param {string} url */
function deriveBaseUrl(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/[^/]*$/, '');
  return `${parsed.origin}${path === '/' ? '' : path}`;
}

/** @param {string} base @param {string} path */
function resolveAgainst(base, path) {
  const normalized = `${String(base ?? '').replace(/\/+$/, '')}/`;
  try {
    return new URL(path, normalized).toString();
  } catch {
    return path;
  }
}

/** @param {string} url */
function networkNameFromUrl(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(segments[segments.length - 1] ?? '');
}

/** @param {string} url @param {Network} network */
function resolvePeerUrl(url, network) {
  if (/^https?:\/\//i.test(url)) return url;
  const binding = network.raw?.metadata?.links?.[url];
  if (typeof binding === 'string') return binding;
  return url;
}

/** @param {unknown} result */
function summarizeMcpResult(result) {
  if (isPlainObject(result) && Array.isArray(result.content)) {
    const text = result.content
      .filter((part) => isPlainObject(part) && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return truncate(JSON.stringify(result ?? null), 800);
}

/** @param {Record<string, unknown>} request */
function describeConsent(request) {
  if (request.kind === 'peer') {
    return `contact ${request.origin} to ${request.purpose ?? 'load another agent site'}`;
  }
  if (request.kind === 'mcp') {
    return `contact ${request.origin} to ${request.purpose ?? 'call an MCP tool'}`;
  }
  if (request.kind === 'action') {
    return `run "${request.name ?? 'an action'}" (${request.effect ?? 'write'})`;
  }
  return 'contact a third party';
}
