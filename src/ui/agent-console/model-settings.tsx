'use client';

/**
 * Model and key settings for the agent console (MVP Profile 0.3 §4).
 *
 * The site funds no inference. A visitor either runs the published network on
 * its deterministic demo router, or brings an OpenAI-compatible router, model
 * and key. The key is stored only in this origin's localStorage, is attached
 * only to requests sent to the chosen router, and can be deleted here.
 */

import * as React from 'react';
import { createOpenAICompatibleRouter, type Router } from '../../../public/agent-runtime/agent-runtime.mjs';
import { Button, cn } from '@/ui/primitives';

export interface RouterPreset {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly note: string;
}

export const ROUTER_PRESETS: readonly RouterPreset[] = [
  {
    id: 'otari',
    label: 'Mozilla Otari (challenge default)',
    provider: 'Otari',
    baseUrl: 'https://api.otari.ai/api/v1',
    model: 'alibaba/qwen3.8-flash',
    note: 'OpenAI-compatible. Otari credits are available to challenge registrants.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: 'Uses /chat/completions with streaming and tool calls.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    note: 'Any OpenRouter model id works; browser calls need the account CORS setting.',
  },
  {
    id: 'ollama',
    label: 'Local (Ollama / vLLM / LM Studio)',
    provider: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    note: 'Runs on your machine. The key can be any non-empty string.',
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible endpoint',
    provider: 'custom',
    baseUrl: '',
    model: '',
    note: 'Any router that speaks POST {base}/chat/completions.',
  },
];

export interface ModelSettings {
  readonly mode: 'demo' | 'byok';
  readonly presetId: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

const STORAGE_KEY = 'chip-autopsy-lab:agent-model';

export const DEFAULT_SETTINGS: ModelSettings = {
  mode: 'demo',
  presetId: 'otari',
  baseUrl: ROUTER_PRESETS[0].baseUrl,
  model: ROUTER_PRESETS[0].model,
  apiKey: '',
};

function parseStored(raw: string | null): ModelSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    if (parsed.mode !== 'demo' && parsed.mode !== 'byok') return null;
    return {
      mode: parsed.mode,
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : DEFAULT_SETTINGS.presetId,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_SETTINGS.model,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return null;
  }
}

/**
 * Holds the visitor's router choice. Reading and writing storage happens here
 * so nothing else in the console touches the key.
 */
export function useModelSettings(): {
  readonly settings: ModelSettings;
  readonly stored: boolean;
  update(next: ModelSettings): void;
  clear(): void;
} {
  const [settings, setSettings] = React.useState<ModelSettings>(DEFAULT_SETTINGS);
  const [stored, setStored] = React.useState(false);

  React.useEffect(() => {
    const loaded = parseStored(window.localStorage.getItem(STORAGE_KEY));
    if (loaded) {
      setSettings(loaded);
      setStored(loaded.apiKey !== '' || loaded.mode === 'byok');
    }
  }, []);

  const update = React.useCallback((next: ModelSettings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStored(true);
    } catch {
      setStored(false);
    }
  }, []);

  const clear = React.useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      setStored(false);
    } catch {
      setStored(false);
    }
  }, []);

  return { settings, stored, update, clear };
}

/** Builds the router the runtime will use for the next message. */
export function routerForSettings(settings: ModelSettings, demoRouter: Router): Router {
  if (settings.mode === 'demo') return demoRouter;
  const preset = ROUTER_PRESETS.find((entry) => entry.id === settings.presetId);
  return createOpenAICompatibleRouter({
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    provider: preset?.provider ?? 'custom',
    temperature: 0.2,
    maxTokens: 900,
  });
}

export interface ModelSettingsPanelProps {
  readonly settings: ModelSettings;
  readonly stored: boolean;
  readonly onUpdate: (next: ModelSettings) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
}

export function ModelSettingsPanel({
  settings,
  stored,
  onUpdate,
  onClear,
  onClose,
}: ModelSettingsPanelProps) {
  const [draft, setDraft] = React.useState<ModelSettings>(settings);
  const preset = ROUTER_PRESETS.find((entry) => entry.id === draft.presetId) ?? ROUTER_PRESETS[0];

  const selectPreset = (id: string) => {
    const next = ROUTER_PRESETS.find((entry) => entry.id === id) ?? ROUTER_PRESETS[0];
    setDraft((current) => ({
      ...current,
      presetId: id,
      baseUrl: next.baseUrl || current.baseUrl,
      model: next.model || current.model,
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-panel border border-hairline bg-fill-1 p-3">
        <p className="text-[13px] leading-relaxed text-text-secondary">
          This site does not pay for model calls. Choose how the agent network should run:
          with the deterministic demo router (no model, no key), or with your own
          OpenAI-compatible router. Your key stays in this browser and is sent only to the
          router you pick.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12px] uppercase tracking-wide text-text-tertiary">Inference</legend>
        {(
          [
            {
              mode: 'demo' as const,
              title: 'Demo router — no model, no key',
              body: 'Runs the published network deterministically. Answers are assembled from the site tools’ own summaries; the interface labels every such answer.',
            },
            {
              mode: 'byok' as const,
              title: 'Your own model (BYOK)',
              body: 'The network runs on your model through an OpenAI-compatible router, with streaming and tool calls.',
            },
          ] satisfies { mode: ModelSettings['mode']; title: string; body: string }[]
        ).map((option) => (
          <label
            key={option.mode}
            className={cn(
              'flex cursor-pointer gap-3 rounded-panel border p-3 transition-[background-color,color] duration-[120ms]',
              draft.mode === option.mode
                ? 'border-ink bg-fill-2'
                : 'border-hairline hover:bg-fill-1',
            )}
          >
            <input
              type="radio"
              name="agent-model-mode"
              value={option.mode}
              checked={draft.mode === option.mode}
              onChange={() => setDraft((current) => ({ ...current, mode: option.mode }))}
              className="mt-1 accent-[var(--ink)]"
            />
            <span className="flex flex-col gap-1">
              <span className="text-[13px] text-text-primary">{option.title}</span>
              <span className="text-[12px] leading-relaxed text-text-tertiary">{option.body}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {draft.mode === 'byok' ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
            <span>Provider preset</span>
            <select
              value={draft.presetId}
              onChange={(event) => selectPreset(event.target.value)}
              className="h-10 rounded-control border border-hairline bg-surface px-3 text-[13px] text-text-primary"
            >
              {ROUTER_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
            <span>Router base URL</span>
            <input
              value={draft.baseUrl}
              onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className="h-10 rounded-control border border-hairline bg-surface px-3 font-mono text-[12px] text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
            <span>Model</span>
            <input
              value={draft.model}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
              placeholder="model-id"
              spellCheck={false}
              className="h-10 rounded-control border border-hairline bg-surface px-3 font-mono text-[12px] text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
            <span>API key</span>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              className="h-10 rounded-control border border-hairline bg-surface px-3 font-mono text-[12px] text-text-primary"
            />
            <span className="text-[11px] leading-relaxed text-text-tertiary">
              Stored in this browser’s localStorage for this origin only. Never sent to the
              site, to another agent site, or into the network definition, prompts or traces.
            </span>
          </label>
          <p className="text-[11px] leading-relaxed text-text-tertiary">{preset.note}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            onUpdate(draft);
            onClose();
          }}
        >
          Apply
        </Button>
        <Button variant="secondary" size="md" onClick={onClose}>
          Cancel
        </Button>
        {stored ? (
          <Button variant="text" size="md" onClick={onClear}>
            Delete stored settings
          </Button>
        ) : null}
      </div>
    </div>
  );
}
