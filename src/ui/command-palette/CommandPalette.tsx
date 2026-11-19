'use client';

import {
  Activity,
  CircleAlert,
  CircleDot,
  Clock,
  CornerDownLeft,
  Disc3,
  Download,
  FolderOpen,
  Grid2x2,
  Layers,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { StoreApi } from 'zustand';
import type { DemoPresetId, DemoPresetMeta } from '@/core/demo';
import type { LotModel } from '@/core/model';
import {
  type FilterDslAst,
  formatFilterDslSummary,
  OFFLINE_QUERY_EXAMPLES,
  parseOfflineNaturalQuery,
} from '@/core/query';
import { useT } from '@/ui/i18n';
import { cn, MATERIAL_THICK_CLASS } from '@/ui/primitives';
import {
  type SelectionStoreState,
  useSelectionStore,
  type WaferColorMode,
} from '@/ui/state';

export const PALETTE_RECENTS_STORAGE_KEY = 'cal.palette.recents.v1' as const;
export const MAX_PALETTE_RECENTS = 6 as const;

export interface PaletteStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PaletteQueryExecutionSuccess {
  readonly ok: true;
  readonly ast: FilterDslAst;
  readonly query: string;
  readonly recents: readonly string[];
}

export interface PaletteQueryExecutionFailure {
  readonly ok: false;
  readonly error: string;
  readonly query: string;
}

export type PaletteQueryExecutionResult =
  | PaletteQueryExecutionSuccess
  | PaletteQueryExecutionFailure;

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly lot?: LotModel | null;
  readonly presets?: readonly DemoPresetMeta[];
  readonly selectedPresetId?: DemoPresetId;
  readonly onLoadDemoLot?: (presetId: DemoPresetId) => void;
  readonly onOpenFilePicker?: () => void;
  readonly onDownloadDemoLot?: (presetId: DemoPresetId) => void;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  /** Optional initial recents list (useful for SSR / deterministic tests). */
  readonly initialRecents?: readonly string[];
  /** Optional initial query string (useful for SSR / deterministic tests). */
  readonly initialQuery?: string;
  /** Optional initial parse error string (useful for SSR / deterministic tests). */
  readonly initialParseError?: string | null;
  /** Disable React portal mounting for SSR / static markup tests. */
  readonly disablePortal?: boolean;
}

type PaletteItemKind =
  | { readonly type: 'run-query'; readonly query: string }
  | { readonly type: 'recent'; readonly query: string }
  | { readonly type: 'filter-example'; readonly query: string }
  | { readonly type: 'clear-filters' }
  | { readonly type: 'set-mode'; readonly mode: WaferColorMode }
  | { readonly type: 'load-sample'; readonly presetId: DemoPresetId }
  | { readonly type: 'open-file' }
  | { readonly type: 'export-demo' };

interface PaletteEntry {
  readonly id: string;
  readonly testId: string;
  readonly label: string;
  readonly preview?: string;
  readonly shortcuts?: readonly string[];
  readonly icon: React.ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly className?: string;
    readonly 'aria-hidden'?: boolean | 'true' | 'false';
  }>;
  readonly keywords?: string;
  readonly action: PaletteItemKind;
}

interface PaletteSection {
  readonly id: string;
  readonly testId: string;
  readonly heading: string | null;
  readonly items: readonly PaletteEntry[];
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

function resolveStorage(
  storage?: PaletteStorageLike | null,
): PaletteStorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Safely reads persisted command palette query recents from `localStorage["cal.palette.recents.v1"]`.
 */
export function readPaletteRecents(
  storage?: PaletteStorageLike | null,
): readonly string[] {
  const store = resolveStorage(storage);
  if (!store) {
    return [];
  }
  try {
    const raw = store.getItem(PALETTE_RECENTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') {
        continue;
      }
      const trimmed = item.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(trimmed);
      if (out.length >= MAX_PALETTE_RECENTS) {
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Prepends a successfully executed query to `localStorage["cal.palette.recents.v1"]`,
 * deduplicating case-insensitively and keeping the most recent entries first.
 */
export function recordPaletteRecent(
  query: string,
  storage?: PaletteStorageLike | null,
): readonly string[] {
  const trimmed = query.trim();
  const existing = readPaletteRecents(storage);
  if (trimmed.length === 0) {
    return existing;
  }
  const lower = trimmed.toLowerCase();
  const next = [
    trimmed,
    ...existing.filter((item) => item.toLowerCase() !== lower),
  ].slice(0, MAX_PALETTE_RECENTS);

  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(PALETTE_RECENTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota / private browsing errors
    }
  }
  return next;
}

/**
 * Pure, deterministic query executor for the Command Palette:
 * - Parses `rawQuery` via `parseOfflineNaturalQuery(rawQuery, lot)`
 * - On failure (Req 12.4): leaves `store` untouched and returns `{ ok: false, error }`
 * - On success (Req 12.2, 12.5): writes `dslFilter` into `store` (which also auto-selects
 *   `lowestCpkTestNum` when capability clauses exist) and persists the query to recents
 */
export function executePaletteQuery(
  rawQuery: string,
  store: StoreApi<SelectionStoreState>,
  options?: {
    readonly lot?: LotModel | null;
    readonly storage?: PaletteStorageLike | null;
  },
): PaletteQueryExecutionResult {
  const trimmed = rawQuery.trim();
  const targetLot = options?.lot ?? store.getState().lot;
  const parsed = parseOfflineNaturalQuery(trimmed, targetLot);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      query: trimmed,
    };
  }
  store.getState().setDslFilter(parsed.value);
  const recents = recordPaletteRecent(trimmed, options?.storage);
  return {
    ok: true,
    ast: parsed.value,
    query: trimmed,
    recents,
  };
}

function matchesSearch(needle: string, haystack: string): boolean {
  if (needle.length === 0) {
    return true;
  }
  return haystack.toLowerCase().includes(needle);
}

const KBD_CAP_CLASS =
  'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-xs bg-fill-2 px-1.5 font-sans type-caption leading-none text-text-secondary shadow-[inset_0_0_0_1px_var(--hairline)]';

function KeycapGroup({
  keys,
}: {
  readonly keys: readonly string[];
}): React.JSX.Element {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {keys.map((cap, idx) => (
        <kbd key={`${cap}-${idx}`} className={KBD_CAP_CLASS}>
          {cap}
        </kbd>
      ))}
    </span>
  );
}

function stampAck(event: React.PointerEvent<HTMLElement>): void {
  if (typeof performance !== 'undefined') {
    event.currentTarget.dataset.ack = String(performance.now());
  }
}

/**
 * Instant (`0 ms`) Cmd-K / Ctrl-K Command Palette (`src/ui/command-palette/CommandPalette.tsx`, Task 17):
 * - Opens synchronously with zero transition delay (`premium.md` §3.12 `dur-0`, §8.14)
 * - Uses `material-thick`, `r-2xl`, `shadow-popover`, `z-[var(--z-sheets)]`, and concentric
 *   `r-md` rows inside `p-3` padding (`premium.md` §3.9, §7.12)
 * - Zero ember/orange colours anywhere in the palette
 * - Recents first (`localStorage["cal.palette.recents.v1"]`), then filter examples, then actions
 *   with right-aligned `<kbd>` shortcuts
 * - Invalid filter queries keep selection state untouched and display inline clickable examples
 */
export function CommandPalette({
  open,
  onClose,
  lot = null,
  presets = [],
  selectedPresetId = 'edge-ring-etch',
  onLoadDemoLot,
  onOpenFilePicker,
  onDownloadDemoLot,
  store = useSelectionStore,
  initialRecents,
  initialQuery = '',
  initialParseError = null,
  disablePortal = false,
}: CommandPaletteProps): React.JSX.Element | null {
  const { t } = useT();
  const baseId = React.useId();
  const listboxId = `${baseId}-listbox`;

  const [query, setQuery] = React.useState(initialQuery);
  const [parseError, setParseError] = React.useState<string | null>(
    initialParseError,
  );
  const [recents, setRecents] = React.useState<readonly string[]>(() =>
    initialRecents !== undefined ? initialRecents : readPaletteRecents(),
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [isClientMounted, setIsClientMounted] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const skipFocusRestoreRef = React.useRef(false);

  const effectiveLot = lot ?? store.getState().lot;

  useIsomorphicLayoutEffect(() => {
    setIsClientMounted(true);
  }, []);

  // Refresh recents, reset transient query/error, and focus input synchronously at 0 ms on open
  useIsomorphicLayoutEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }
    skipFocusRestoreRef.current = false;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    if (initialRecents === undefined) {
      setRecents(readPaletteRecents());
    }
    setQuery(initialQuery);
    setParseError(initialParseError);
    setActiveIndex(0);

    inputRef.current?.focus();

    return () => {
      if (skipFocusRestoreRef.current) {
        return;
      }
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        queueMicrotask(() => {
          prev.focus();
        });
      }
    };
  }, [open, initialRecents, initialQuery, initialParseError]);

  const isMac =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl';

  const trimmedQuery = query.trim();
  const searchNeedle = trimmedQuery.toLowerCase();

  const liveParsePreview = React.useMemo(() => {
    if (trimmedQuery.length === 0) {
      return null;
    }
    return parseOfflineNaturalQuery(trimmedQuery, effectiveLot);
  }, [trimmedQuery, effectiveLot]);

  const sections = React.useMemo<readonly PaletteSection[]>(() => {
    const out: PaletteSection[] = [];

    // 1. Recent queries (always first among groups when non-empty)
    const matchingRecents = recents.filter((item) =>
      matchesSearch(searchNeedle, item),
    );
    const recentEntries: PaletteEntry[] = matchingRecents.map((item, idx) => {
      const parsed = parseOfflineNaturalQuery(item, effectiveLot);
      const preview = parsed.ok
        ? formatFilterDslSummary(parsed.value, effectiveLot)
        : undefined;
      return {
        id: `${baseId}-recent-${idx}`,
        testId: 'palette-recent-item',
        label: item,
        ...(preview ? { preview } : {}),
        icon: Clock,
        action: { type: 'recent', query: item },
      };
    });

    // 2. Filter examples
    const matchingExamples = OFFLINE_QUERY_EXAMPLES.filter((example) =>
      matchesSearch(searchNeedle, example),
    );
    const exampleEntries: PaletteEntry[] = matchingExamples.map(
      (example, idx) => {
        const parsed = parseOfflineNaturalQuery(example, effectiveLot);
        const preview = parsed.ok
          ? formatFilterDslSummary(parsed.value, effectiveLot)
          : undefined;
        return {
          id: `${baseId}-example-${idx}`,
          testId: 'palette-filter-example-item',
          label: example,
          ...(preview ? { preview } : {}),
          icon: SlidersHorizontal,
          action: { type: 'filter-example', query: example },
        };
      },
    );

    // 3. Actions with right-aligned <kbd> shortcuts
    const canParametric = effectiveLot === null || effectiveLot.tests.size > 0;
    const allActions: PaletteEntry[] = [
      {
        id: `${baseId}-action-clear`,
        testId: 'palette-action-clear-filters',
        label: t('palette.action.clearFilters'),
        shortcuts: ['Esc'],
        icon: RotateCcw,
        keywords: 'clear reset filters remove',
        action: { type: 'clear-filters' },
      },
      {
        id: `${baseId}-action-mode-pf`,
        testId: 'palette-action-mode-pass-fail',
        label: t('palette.action.modePassFail'),
        shortcuts: ['1'],
        icon: CircleDot,
        keywords: 'pass fail wafer mode',
        action: { type: 'set-mode', mode: 'pass-fail' },
      },
      {
        id: `${baseId}-action-mode-hbin`,
        testId: 'palette-action-mode-hbin',
        label: t('palette.action.modeHbin'),
        shortcuts: ['2'],
        icon: Grid2x2,
        keywords: 'hard bins hbin wafer mode',
        action: { type: 'set-mode', mode: 'hbin' },
      },
      {
        id: `${baseId}-action-mode-sbin`,
        testId: 'palette-action-mode-sbin',
        label: t('palette.action.modeSbin'),
        shortcuts: ['3'],
        icon: Layers,
        keywords: 'soft bins sbin wafer mode',
        action: { type: 'set-mode', mode: 'sbin' },
      },
      ...(canParametric
        ? [
            {
              id: `${baseId}-action-mode-param`,
              testId: 'palette-action-mode-parametric',
              label: t('palette.action.modeParametric'),
              shortcuts: ['4'],
              icon: Activity,
              keywords: 'parametric cpk histogram wafer mode',
              action: { type: 'set-mode', mode: 'parametric' } as const,
            },
          ]
        : []),
      ...presets.map((preset) => ({
        id: `${baseId}-action-sample-${preset.id}`,
        testId: `palette-action-load-sample-${preset.id}`,
        label: t('palette.action.loadSample', { name: preset.title }),
        icon: Disc3,
        keywords: `sample demo lot ${preset.id} ${preset.title}`,
        action: { type: 'load-sample', presetId: preset.id } as const,
      })),
      ...(onOpenFilePicker
        ? [
            {
              id: `${baseId}-action-open-file`,
              testId: 'palette-action-open-file',
              label: t('nav.openFile'),
              shortcuts: [modKey, 'O'],
              icon: FolderOpen,
              keywords: 'open stdf file upload browse',
              action: { type: 'open-file' } as const,
            },
          ]
        : []),
      ...(onDownloadDemoLot
        ? [
            {
              id: `${baseId}-action-export-demo`,
              testId: 'palette-action-export-demo',
              label: t('palette.action.exportDemo'),
              shortcuts: ['D'],
              icon: Download,
              keywords: 'download export sample stdf',
              action: { type: 'export-demo' } as const,
            },
          ]
        : []),
    ];

    const matchingActions = allActions.filter((entry) =>
      matchesSearch(searchNeedle, `${entry.label} ${entry.keywords ?? ''}`),
    );

    const totalMatched =
      recentEntries.length + exampleEntries.length + matchingActions.length;

    // When the user types a valid DSL query (or a free-form query matching no actions),
    // place the live "Apply filter: {query}" action at the top so Enter executes immediately.
    if (
      trimmedQuery.length > 0 &&
      (liveParsePreview?.ok === true || totalMatched === 0)
    ) {
      const preview =
        liveParsePreview?.ok === true
          ? formatFilterDslSummary(liveParsePreview.value, effectiveLot)
          : undefined;
      out.push({
        id: `${baseId}-section-run`,
        testId: 'palette-group-run',
        heading: null,
        items: [
          {
            id: `${baseId}-run-query`,
            testId: 'palette-run-query-item',
            label: t('palette.runQuery', { query: trimmedQuery }),
            ...(preview ? { preview } : {}),
            shortcuts: ['↵'],
            icon: CornerDownLeft,
            action: { type: 'run-query', query: trimmedQuery },
          },
        ],
      });
    }

    if (recentEntries.length > 0) {
      out.push({
        id: `${baseId}-section-recents`,
        testId: 'palette-group-recents',
        heading: t('palette.group.recents'),
        items: recentEntries,
      });
    }

    if (exampleEntries.length > 0) {
      out.push({
        id: `${baseId}-section-filters`,
        testId: 'palette-group-filters',
        heading: t('palette.group.filters'),
        items: exampleEntries,
      });
    }

    if (matchingActions.length > 0) {
      out.push({
        id: `${baseId}-section-actions`,
        testId: 'palette-group-actions',
        heading: t('palette.group.actions'),
        items: matchingActions,
      });
    }

    return out;
  }, [
    baseId,
    effectiveLot,
    liveParsePreview,
    modKey,
    onDownloadDemoLot,
    onOpenFilePicker,
    presets,
    recents,
    searchNeedle,
    t,
    trimmedQuery,
  ]);

  const flatItems = React.useMemo<readonly PaletteEntry[]>(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  const clampedActiveIndex =
    flatItems.length === 0
      ? -1
      : Math.min(Math.max(0, activeIndex), flatItems.length - 1);
  const activeOption =
    clampedActiveIndex >= 0 ? flatItems[clampedActiveIndex] : undefined;

  const submitDslQuery = React.useCallback(
    (rawText: string): void => {
      const result = executePaletteQuery(rawText, store, { lot: effectiveLot });
      if (!result.ok) {
        setParseError(result.error);
        inputRef.current?.focus();
        return;
      }
      setRecents(result.recents);
      setParseError(null);
      setQuery('');
      onClose();
    },
    [effectiveLot, onClose, store],
  );

  const executeEntry = React.useCallback(
    (entry: PaletteEntry): void => {
      const act = entry.action;
      switch (act.type) {
        case 'run-query':
        case 'recent':
        case 'filter-example':
          submitDslQuery(act.query);
          return;
        case 'clear-filters':
          store.getState().clearFilters();
          setParseError(null);
          onClose();
          return;
        case 'set-mode':
          store.getState().setColorMode(act.mode);
          setParseError(null);
          onClose();
          return;
        case 'load-sample':
          setParseError(null);
          onClose();
          onLoadDemoLot?.(act.presetId);
          return;
        case 'open-file':
          skipFocusRestoreRef.current = true;
          setParseError(null);
          onClose();
          onOpenFilePicker?.();
          return;
        case 'export-demo':
          setParseError(null);
          onClose();
          onDownloadDemoLot?.(selectedPresetId);
          return;
      }
    },
    [
      onClose,
      onDownloadDemoLot,
      onLoadDemoLot,
      onOpenFilePicker,
      selectedPresetId,
      store,
      submitDslQuery,
    ],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flatItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % flatItems.length);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flatItems.length > 0) {
        setActiveIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
      }
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      if (flatItems.length > 0) {
        setActiveIndex(0);
      }
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      if (flatItems.length > 0) {
        setActiveIndex(flatItems.length - 1);
      }
      return;
    }

    if (event.key === 'Enter') {
      // Allow clicking inline error example buttons via Enter when focused on one
      if (
        event.target instanceof HTMLButtonElement &&
        event.target.dataset.testid === 'palette-error-example'
      ) {
        return;
      }
      event.preventDefault();
      if (activeOption) {
        executeEntry(activeOption);
      } else if (trimmedQuery.length > 0) {
        submitDslQuery(trimmedQuery);
      }
      return;
    }

    // Keep keyboard focus contained inside the palette dialog
    if (event.key === 'Tab') {
      const dialogEl = dialogRef.current;
      if (!dialogEl || typeof document === 'undefined') {
        return;
      }
      const focusables = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!activeEl || activeEl === first || !dialogEl.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!activeEl || activeEl === last || !dialogEl.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Scroll highlighted row into view smoothly on keyboard navigation
  React.useEffect(() => {
    if (!open || !activeOption || typeof document === 'undefined') {
      return;
    }
    const el = document.getElementById(activeOption.id);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [open, activeOption]);

  if (!open) {
    return null;
  }

  let runningIndex = 0;

  const paletteTree = (
    <div
      className="fixed inset-0 z-[var(--z-sheets)] flex items-start justify-center overscroll-contain px-4 pt-[min(14vh,120px)] pb-6"
      onKeyDown={handleKeyDown}
    >
      {/* Subtle translucent backdrop using existing scrim token */}
      <div
        aria-hidden="true"
        data-testid="command-palette-scrim"
        onClick={onClose}
        className="sheet-scrim-surface absolute inset-0"
      />

      {/* Command palette surface: 0 ms open, material-thick, r-2xl, shadow-popover */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.ariaLabel')}
        data-testid="command-palette"
        className={cn(
          'relative z-10 flex w-full max-w-[580px] flex-col overflow-hidden rounded-2xl text-text-primary outline-none',
          MATERIAL_THICK_CLASS,
        )}
      >
        {/* Top search / DSL command input row */}
        <div className="flex h-14 items-center gap-3 border-b border-hairline px-4">
          <Search
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-text-tertiary"
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={t('palette.ariaLabel')}
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeOption?.id}
            aria-autocomplete="list"
            data-testid="command-palette-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              if (parseError !== null) {
                setParseError(null);
              }
            }}
            placeholder={t('palette.placeholder')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent type-callout text-text-primary placeholder:text-text-tertiary outline-none"
          />
          {query.length > 0 ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('selection.clear')}
              onPointerDown={stampAck}
              onClick={() => {
                setQuery('');
                setParseError(null);
                setActiveIndex(0);
                inputRef.current?.focus();
              }}
              className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-pill text-text-tertiary transition-[background-color,color] duration-[var(--dur-1)] ease-[var(--ease-out)] hover:bg-fill-2 hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
            >
              <X aria-hidden="true" size={14} strokeWidth={1.75} />
            </button>
          ) : null}
          <kbd className={KBD_CAP_CLASS}>Esc</kbd>
        </div>

        {/* Inline invalid-query guidance with clickable examples (Req 12.4, zero ember/orange) */}
        {parseError !== null ? (
          <div
            role="alert"
            data-testid="palette-parse-error"
            className="border-b border-hairline bg-fill-1 px-4 py-3"
          >
            <div className="flex items-start gap-2.5">
              <CircleAlert
                aria-hidden="true"
                size={15}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-text-secondary"
              />
              <div className="min-w-0 flex-1">
                <p className="type-subhead text-text-primary">
                  {t('palette.error.invalidQuery')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {OFFLINE_QUERY_EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      data-testid="palette-error-example"
                      onPointerDown={stampAck}
                      onClick={() => submitDslQuery(example)}
                      className="inline-flex h-7 cursor-pointer items-center rounded-pill border border-hairline-strong bg-surface px-2.5 type-caption text-text-primary transition-[background-color,color] duration-[var(--dur-1)] ease-[var(--ease-out)] hover:bg-fill-2 focus-visible:shadow-focus-ring focus-visible:outline-none"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Grouped results listbox (p-3 + r-md = concentric with r-2xl outer radius) */}
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('palette.ariaLabel')}
          data-testid="command-palette-list"
          className="max-h-[min(56vh,420px)] overflow-y-auto p-3"
        >
          {sections.map((section, sectionIdx) => (
            <div
              key={section.id}
              role="group"
              aria-labelledby={
                section.heading !== null ? `${section.id}-heading` : undefined
              }
              data-testid={section.testId}
              className={cn(
                sectionIdx > 0 && 'mt-2 border-t border-hairline pt-2',
              )}
            >
              {section.heading !== null ? (
                <div
                  id={`${section.id}-heading`}
                  className="px-3 pt-1 pb-1.5 type-caption text-text-tertiary select-none"
                >
                  {section.heading}
                </div>
              ) : null}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const itemIndex = runningIndex;
                  runningIndex += 1;
                  const isActive = itemIndex === clampedActiveIndex;
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      id={item.id}
                      role="option"
                      aria-selected={isActive}
                      data-testid={item.testId}
                      data-selected={isActive ? 'true' : undefined}
                      onMouseEnter={() => setActiveIndex(itemIndex)}
                      onPointerDown={(event) => {
                        stampAck(event);
                        // Keep focus on the combobox input when selecting by pointer
                        event.preventDefault();
                      }}
                      onClick={() => executeEntry(item)}
                      className={cn(
                        'flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 select-none',
                        'transition-[background-color,color] duration-[var(--dur-1)] ease-[var(--ease-out)]',
                        isActive
                          ? 'bg-fill-2 text-text-primary'
                          : 'text-text-primary hover:bg-fill-1',
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        size={15}
                        strokeWidth={1.75}
                        className={cn(
                          'shrink-0',
                          isActive ? 'text-text-primary' : 'text-text-tertiary',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate type-control text-text-primary">
                        {item.label}
                      </span>
                      {item.preview ? (
                        <span
                          className={cn(
                            'hidden max-w-[200px] shrink-0 truncate type-caption sm:inline',
                            isActive
                              ? 'text-text-secondary'
                              : 'text-text-tertiary',
                          )}
                        >
                          {item.preview}
                        </span>
                      ) : null}
                      {item.shortcuts && item.shortcuts.length > 0 ? (
                        <KeycapGroup keys={item.shortcuts} />
                      ) : isActive ? (
                        <KeycapGroup keys={['↵']} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Quiet keyboard legend footer */}
        <div
          aria-hidden="true"
          className="flex items-center justify-between border-t border-hairline px-4 py-2 type-caption text-text-tertiary"
        >
          <div className="flex items-center gap-1.5">
            <kbd className={KBD_CAP_CLASS}>↑</kbd>
            <kbd className={KBD_CAP_CLASS}>↓</kbd>
            <kbd className={KBD_CAP_CLASS}>↵</kbd>
          </div>
          <div className="flex items-center gap-1">
            <kbd className={KBD_CAP_CLASS}>{modKey}</kbd>
            <kbd className={KBD_CAP_CLASS}>K</kbd>
          </div>
        </div>
      </div>
    </div>
  );

  if (disablePortal || !isClientMounted || typeof document === 'undefined') {
    return paletteTree;
  }

  return createPortal(paletteTree, document.body);
}
