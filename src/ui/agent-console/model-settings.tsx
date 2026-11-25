'use client';

/**
 * Model and key settings for the agent console (MVP Profile 0.3 §4).
 *
 * The site funds no inference. A visitor either runs the published network on
 * its deterministic demo router, or brings an OpenAI-compatible router, model
 * and key. The key is stored only in this origin's localStorage, is attached
 * only to requests sent to the chosen router, and can be deleted here.
 */

import type { MessageKey } from '@/core/i18n';
import { Untranslated, useT } from '@/ui/i18n';
import * as React from 'react';
import { createOpenAICompatibleRouter, type Router } from '../../../public/agent-runtime/agent-runtime.mjs';
import { Button, cn, SegmentedControl } from '@/ui/primitives';

export interface RouterPreset {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly noteKey: Extract<MessageKey, `agents.model.note.${string}`>;
}

export const ROUTER_PRESETS: readonly RouterPreset[] = [
  {
    id: 'otari',
    label: 'Mozilla Otari (challenge default)',
    shortLabel: 'Otari',
    provider: 'Otari',
    baseUrl: 'https://api.otari.ai/api/v1',
    model: 'alibaba/qwen3.8-flash',
    noteKey: 'agents.model.note.otari',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    provider: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    noteKey: 'agents.model.note.openai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    provider: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    noteKey: 'agents.model.note.openrouter',
  },
  {
    id: 'ollama',
    label: 'Local (Ollama / vLLM / LM Studio)',
    shortLabel: 'Ollama / Local',
    provider: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    noteKey: 'agents.model.note.ollama',
  },
  {
    id: 'custom',
    label: 'Other OpenAI-compatible endpoint',
    shortLabel: 'Custom',
    provider: 'custom',
    baseUrl: '',
    model: '',
    noteKey: 'agents.model.note.custom',
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
  const { t } = useT();
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

  const inputClass =
    'h-11 w-full bg-transparent px-3.5 text-[16px] text-text-primary sm:h-10 sm:text-[12.5px] focus:outline-none';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <SegmentedControl
          ariaLabel={t('agents.model.inference')}
          value={draft.mode}
          onValueChange={(mode) => setDraft((current) => ({ ...current, mode }))}
          options={[
            { value: 'demo', label: t('agents.model.demo') },
            { value: 'byok', label: t('agents.model.own') },
          ]}
        />
        <p className="type-subhead text-text-tertiary">
          {draft.mode === 'demo' ? t('agents.model.demoNote') : t('agents.model.ownNote')}
        </p>
      </div>

      {draft.mode === 'byok' ? (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <span className="type-subhead text-text-secondary">{t('agents.model.provider')}</span>
            <div
              role="radiogroup"
              aria-label={t('agents.model.provider')}
              className="flex flex-wrap gap-1.5"
            >
              {ROUTER_PRESETS.map((entry) => {
                const active = draft.presetId === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={entry.label}
                    onClick={() => selectPreset(entry.id)}
                    className={cn(
                      'cursor-pointer touch-manipulation rounded-pill px-3 py-1.5 type-caption',
                      'transition-[background-color,color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
                      'active:scale-[0.97] motion-reduce:active:scale-100',
                      'focus-visible:shadow-focus-ring focus-visible:outline-none',
                      active
                        ? 'at-pill-iris'
                        : 'at-well-crisp text-text-secondary [@media(hover:hover)]:hover:bg-fill-2 [@media(hover:hover)]:hover:text-text-primary',
                    )}
                  >
                    <Untranslated>{entry.shortLabel}</Untranslated>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="type-subhead text-text-secondary">{t('agents.model.baseUrl')}</span>
            <span className="at-search-well block">
              <input
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, baseUrl: event.target.value }))
                }
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                autoComplete="off"
                inputMode="url"
                className={cn(inputClass, 'font-mono')}
              />
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="type-subhead text-text-secondary">{t('agents.model.model')}</span>
            <span className="at-search-well block">
              <input
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, model: event.target.value }))
                }
                placeholder="model-id"
                spellCheck={false}
                autoComplete="off"
                className={cn(inputClass, 'font-mono')}
              />
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="type-subhead text-text-secondary">{t('agents.model.apiKey')}</span>
            <span className="at-search-well block">
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, apiKey: event.target.value }))
                }
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, 'font-mono')}
              />
            </span>
            <span className="type-caption text-text-tertiary">{t('agents.model.storage')}</span>
          </label>

          <p className="type-caption text-text-tertiary">
            {preset.noteKey === 'agents.model.note.custom'
              ? t('agents.model.note.custom', { base: '{base}' })
              : t(preset.noteKey)}
          </p>
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
          {t('agents.model.apply')}
        </Button>
        <Button variant="secondary" size="md" onClick={onClose}>
          {t('agents.model.cancel')}
        </Button>
        {stored ? (
          <Button variant="text" size="md" onClick={onClear} className="ml-auto">
            {t('agents.model.delete')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
