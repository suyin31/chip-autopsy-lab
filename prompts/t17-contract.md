# Task 17 Parallel Implementation Contract: Filter DSL & Cmd-K / Ctrl-K Command Palette

References: `.kiro/steering/*.md`, `.kiro/specs/chip-autopsy-lab/requirements.md` (Req 12.1–12.6, 17.6), `design.md` (§3.7, Property 13), `premium.md` (§3.2, §3.11, §7.12, §7.16, §8.15), and `tasks.md` (Task 17).
**Strict Parallelism Rule**: Never edit files owned by the other coder. Do not install new packages (`cmdk@^1.1.1` is installed in `package.json`; UI coder may use `cmdk` or zero-dependency accessible `role="dialog"` / `role="combobox"` / `role="listbox"` primitives without adding packages). Keep the premium light design and existing tokens (`material-thick`, `surface`, `fill-1..3`, `hairline`, `ink`, `focus-ring`); **no new colours and zero ember/orange in the palette or filter chips**.

---

## 1. Exact TypeScript Types & Signatures (`src/core/query/`)

Existing `src/core/query/selection-predicates.ts` already defines and exports `ComparisonOp`, `DiePredicateClause`, `CapabilityPredicateClause`, `FilterDslAst`, `SpatialBrushRect`, `QuickSelectionFilters`, `FilterEvaluationResult`, and `evaluateSelection`. Re-export both new modules from `src/core/query/index.ts`.

### 1.1 `src/core/query/filter-dsl.ts` (re-exported from `src/core/query/index.ts`)

```typescript
import type { BinMode, LotModel } from '../model/types';
import type { Result } from '../stdf/types';
import type {
  CapabilityPredicateClause,
  ComparisonOp,
  DiePredicateClause,
  FilterDslAst,
  FilterEvaluationResult,
  QuickSelectionFilters,
  SpatialBrushRect,
} from './selection-predicates';

export type {
  CapabilityPredicateClause,
  ComparisonOp,
  DiePredicateClause,
  FilterDslAst,
  FilterEvaluationResult,
  QuickSelectionFilters,
  SpatialBrushRect,
};

export type FilterDslClauseRef =
  | { readonly section: 'die'; readonly index: number; readonly clause: DiePredicateClause }
  | { readonly section: 'capability'; readonly index: number; readonly clause: CapabilityPredicateClause };

export interface FilterDslChipDescriptor {
  readonly id: string;      // Stable key, e.g. 'die:0:bin:ANY_BIN:7' or 'capability:0:cap:cpk:<:1.33'
  readonly label: string;   // Human-readable chip text: 'Bin 7', 'SBIN 7', 'HBIN 4', 'Outer 3 rings', 'Center zone', 'Donut zone', 'Failures', 'Passing', 'W03', 'Site 1:2', 'Cpk < 1.33'
  readonly ref: FilterDslClauseRef;
}

export const EMPTY_FILTER_DSL_AST: FilterDslAst = {
  dieClauses: [],
  capabilityClauses: [],
};

export function isFilterDslEmpty(ast: FilterDslAst | null | undefined): boolean;

/** Normalizes integers (Math.max(0, Math.trunc(n))), deduplicates codes/waferIndices, and normalizes -0 -> 0 on thresholds. */
export function normalizeFilterDslAst(ast: FilterDslAst): FilterDslAst;

/**
 * Canonical deterministic codec (Property 13):
 * Serializes clauses as ';'-joined tokens in order (dieClauses then capabilityClauses), or 'all' when empty:
 * - pass-status:  `status:fail` | `status:pass`
 * - bin:          `bin:${mode}:${codes.join(',')}` (e.g. `bin:ANY_BIN:7`, `bin:SBIN:7`, `bin:HBIN:4`)
 * - edge-ring:    `ring:${maxRing}` (e.g. `ring:3`)
 * - radial-zone:  `zone:center` | `zone:donut`
 * - wafer:        `wafer:${waferIndices.join(',')}` (0-based indices, e.g. `wafer:2`)
 * - site:         `site:${headNum}:${siteNum}` (when headNum defined) | `site:${siteNum}`
 * - capability:   `cap:${metric}:${op}:${Number(threshold)}` (e.g. `cap:cpk:<:1.33`)
 */
export function serializeFilterDsl(ast: FilterDslAst): string;
export function deserializeFilterDsl(encoded: string): Result<FilterDslAst, string>;
export function parseFilterDsl(input: string): Result<FilterDslAst, string>;

/** Applies `ast` (combined with optional `brush` and `quickFilters`) to `lot` via `evaluateSelection`. */
export function applyFilterDslToSelection(
  lot: LotModel,
  ast: FilterDslAst,
  options?: {
    readonly brush?: SpatialBrushRect | null;
    readonly quickFilters?: QuickSelectionFilters;
  },
): FilterEvaluationResult;

/** Removes one clause by `{ section, index }`; returns `null` when no clauses remain. */
export function removeFilterDslClause(
  ast: FilterDslAst,
  ref: Pick<FilterDslClauseRef, 'section' | 'index'>,
): FilterDslAst | null;

/** Builds human-readable removable chip descriptors for each active clause in `ast`. */
export function formatFilterDslChipDescriptors(
  ast: FilterDslAst | null | undefined,
  lot?: Pick<LotModel, 'wafers' | 'sites'> | null,
): readonly FilterDslChipDescriptor[];

/** Joins active chip labels with ', ' (e.g. 'Outer 3 rings, Failures, Cpk < 1.33'). */
export function formatFilterDslSummary(
  ast: FilterDslAst | null | undefined,
  lot?: Pick<LotModel, 'wafers' | 'sites'> | null,
): string;
```

### 1.2 `src/core/query/nl-grammar.ts` (re-exported from `src/core/query/index.ts`)

```typescript
import type { LotModel } from '../model/types';
import type { Result } from '../stdf/types';
import type { FilterDslAst } from './selection-predicates';

export const OFFLINE_QUERY_EXAMPLES = [
  'only bin 7',
  'edge 3 rings',
  'tests with Cpk < 1.33',
  'show edge failures with Cpk < 1.33',
] as const;

export function parseOfflineNaturalQuery(
  query: string,
  lot?: Pick<LotModel, 'wafers' | 'sites' | 'sbins' | 'hbins' | 'tests'> | null,
): Result<FilterDslAst, string>;
```

**Offline Grammar Rules (`parseOfflineNaturalQuery`)**:
1. Reject blank/whitespace strings (`ok: false`). If `query` is a valid canonical DSL string (`deserializeFilterDsl(query)` succeeds with `>= 1` clause), return it.
2. Normalize case, strip polite/filler words (`show`, `only`, `filter`, `find`, `select`, `all`, `dies`, `die`, `tests`, `test`, `where`, `with`, `in`, `on`, `for`, `from`, `by`, `having`, `that`, `are`), split/scan across conjunctions (`and`, `with`, `where`, `,`, `&`, `+`) AND adjacent clause tokens (e.g. `"edge failures"`, `"edge 3 rings failures"`, `"center failures"`):
   - **Bin**: `"only bin 7"`, `"bin 7"`, `"bins 4, 7"` -> `{ kind: 'bin', mode: 'ANY_BIN', codes: [7] }`; `"sbin 7"`, `"soft bin 7"` -> `mode: 'SBIN'`; `"hbin 4"`, `"hard bin 4"` -> `mode: 'HBIN'` (optional `=` after bin keyword; non-negative integer codes).
   - **Spatial ring / zone**: `"edge <N> rings"` / `"outer <N> rings"` / `"edge ring <N>"` / `"ring <N>"` (`N >= 1`) -> `{ kind: 'edge-ring', maxRing: N }`; bare `"edge"` / `"edge-ring"` / `"edge ring"` -> `{ kind: 'edge-ring', maxRing: 3 }`; `"center"` / `"centre"` / `"center zone"` -> `{ kind: 'radial-zone', zone: 'center' }`; `"donut"` / `"donut zone"` -> `{ kind: 'radial-zone', zone: 'donut' }`.
   - **Pass/Fail**: `"failures"` / `"failure"` / `"failing"` / `"failed"` / `"fail"` / `"fails"` -> `{ kind: 'pass-status', status: 'fail' }`; `"passing"` / `"passed"` / `"pass"` / `"good"` -> `{ kind: 'pass-status', status: 'pass' }`.
   - **Wafer / Site**: `"wafer <N>"` / `"w<N>"` / `"w0<N>"` (`N >= 1`) -> match `lot?.wafers` by case-insensitive `waferId` (`W03`) or 1-based index `N - 1` -> `{ kind: 'wafer', waferIndices: [N - 1] }`; `"site <H>:<S>"` / `"head <H> site <S>"` -> `{ kind: 'site', headNum: H, siteNum: S }`; `"site <S>"` -> `{ kind: 'site', siteNum: S }` (`H, S >= 1`).
   - **Capability**: `"cpk <op> <num>"` / `"cp <op> <num>"` (`op` in `<`, `<=`, `>`, `>=`, `=`, `==` normalized to `'='`; finite `num`) -> `{ kind: 'capability', metric: 'cpk' | 'cp', op, threshold: num }`.
3. **Strict error on invalid input (Req 12.4)**: If ANY token remains unrecognized, a numeric argument is missing/invalid (e.g. `"only bin"`, `"edge 0 rings"`, `"cpk < abc"`, `"unknown phrase"`), or `0` clauses are produced, return `{ ok: false, error: '...' }`. Never mutate selection on parse failure.

---

## 2. File Ownership & i18n Keys

| Owner | File Path | Responsibility |
|---|---|---|
| **CORE** | `src/core/query/filter-dsl.ts` | DSL types, `serializeFilterDsl`, `deserializeFilterDsl`, `parseFilterDsl`, `applyFilterDslToSelection`, `removeFilterDslClause`, chip formatters |
| **CORE** | `src/core/query/nl-grammar.ts` | `OFFLINE_QUERY_EXAMPLES`, deterministic `parseOfflineNaturalQuery` |
| **CORE** | `src/core/query/index.ts` | Re-export `./selection-predicates`, `./filter-dsl`, and `./nl-grammar` |
| **CORE** | `src/core/query/filter-dsl.test.ts` | Unit tests for DSL parser/codec, required natural phrases, invalid queries, chip removal, and selection evaluation |
| **CORE** | `src/core/query/filter-dsl-codec.prop.test.ts` | **Property 13** `fast-check` round-trip test (`arbFilterDslAst -> serializeFilterDsl -> deserializeFilterDsl`) |
| **UI** | `src/ui/command-palette/CommandPalette.tsx` & `index.ts` | `0 ms` `Cmd-K`/`Ctrl-K` palette (`z-[var(--z-sheets)]`, `material-thick`, `r-2xl`, `shadow-popover`), recents first (`localStorage["cal.palette.recents.v1"]`), filter examples, right-aligned `<kbd>` shortcuts, inline invalid-query guidance with clickable examples |
| **UI** | `src/ui/command-palette/command-palette.test.ts` | Unit tests for palette rendering, recents ordering, query execution, invalid query error + unchanged selection, and action callbacks |
| **UI** | `src/ui/state/selection-store.ts` & `selection-store.test.ts` | In `setDslFilter`, when `dslFilter` has `capabilityClauses.length > 0` and `lot !== null`, evaluate `evaluateSelection` and auto-select `lowestCpkTestNum` (`activeTestNum`) per Req 12.5 |
| **UI** | `src/ui/wafer-map/ActiveFilterChips.tsx` & `active-filter-chips.test.ts` | Render removable `data-testid="dsl-filter-chip"` (`data-testid="dsl-filter-chip-clear"`) for each active DSL clause via `formatFilterDslChipDescriptors` & `removeFilterDslClause` |
| **UI** | `src/ui/charts/ParametricPanel.tsx` | When `dslFilter?.capabilityClauses.length > 0`, filter displayed catalog rows to `evaluateSelection(...).matchingTestNums` |
| **UI** | `src/ui/layout/LoadedLotOverview.tsx` & `AppShell.tsx` | Wire `CommandPalette` + `Cmd-K`/`Ctrl-K` shortcut in `AppShell.tsx` (**do NOT edit `NavBar.tsx`**); render inline `data-testid="no-results-empty-state"` with `"Clear the filter"` (`data-testid="no-results-clear-filters"`, `variant="secondary"` so loaded view keeps 1 primary button) and `"Open the sample lot"` (`data-testid="no-results-load-demo"`) when `hasActiveFilter && selectedDieCount === 0` |
| **UI** | `src/core/i18n/messages/{en,ja,ko,zh-cn,zh-tw}.ts` | Append the 14 new `palette.*` keys at the **END** of each locale dictionary |
| **UI** | `src/core/i18n/i18n.test.ts` | Update `expect(enKeys.length).toBe(356)` (line 142: `342 + 14`) |
| **UI** | `e2e/palette-t17.spec.ts` | Playwright E2E spec for `Cmd-K`/`Ctrl-K` 0 ms open, recents, DSL filtering, removable chips, invalid query fallback, and 0-die no-results empty state |

### Exact 14 New i18n Keys (UI coder appends at the END of each locale file)
No exclamation marks, no middle dots (`·`), no banned words, no autopsy/death words:
- **`en.ts`**:
  - `'palette.ariaLabel': 'Command palette'`
  - `'palette.placeholder': 'Filter dies or run a command…'`
  - `'palette.group.recents': 'Recent queries'`
  - `'palette.group.filters': 'Filter queries'`
  - `'palette.group.actions': 'Actions'`
  - `'palette.runQuery': 'Apply filter: {query}'`
  - `'palette.error.invalidQuery': 'Query not recognized. Try one of these filter examples:'`
  - `'palette.action.clearFilters': 'Clear active filters'`
  - `'palette.action.modePassFail': 'Wafer mode: Pass/fail'`
  - `'palette.action.modeHbin': 'Wafer mode: Hard bins'`
  - `'palette.action.modeSbin': 'Wafer mode: Soft bins'`
  - `'palette.action.modeParametric': 'Wafer mode: Parametric'`
  - `'palette.action.loadSample': 'Load sample: {name}'`
  - `'palette.action.exportDemo': 'Download sample STDF'`
- **`zh-cn.ts`**: `'命令面板'` / `'筛选晶粒或运行命令…'` / `'最近查询'` / `'筛选查询'` / `'操作'` / `'应用筛选：{query}'` / `'无法识别该查询。可尝试以下筛选示例：'` / `'清除当前筛选'` / `'晶圆模式：良率/失效'` / `'晶圆模式：硬分档'` / `'晶圆模式：软分档'` / `'晶圆模式：参数分布'` / `'加载示例：{name}'` / `'下载示例 STDF'`
- **`zh-tw.ts`**: `'命令面板'` / `'篩選晶粒或執行命令…'` / `'最近查詢'` / `'篩選查詢'` / `'操作'` / `'套用篩選：{query}'` / `'無法識別該查詢。可嘗試以下篩選範例：'` / `'清除目前篩選'` / `'晶圓模式：良率/失效'` / `'晶圓模式：硬分檔'` / `'晶圓模式：軟分檔'` / `'晶圓模式：參數分佈'` / `'載入範例：{name}'` / `'下載範例 STDF'`
- **`ja.ts`**: `'コマンドパレット'` / `'ダイを絞り込むかコマンドを実行…'` / `'最近のクエリ'` / `'フィルタークエリ'` / `'アクション'` / `'フィルターを適用：{query}'` / `'クエリを認識できません。次のフィルター例をお試しください：'` / `'適用中のフィルターを解除'` / `'ウェーハ表示：合否'` / `'ウェーハ表示：ハードビン'` / `'ウェーハ表示：ソフトビン'` / `'ウェーハ表示：パラメトリック'` / `'サンプルを読み込む：{name}'` / `'サンプル STDF をダウンロード'`
- **`ko.ts`**: `'명령 팔레트'` / `'다이 필터링 또는 명령 실행…'` / `'최근 쿼리'` / `'필터 쿼리'` / `'작업'` / `'필터 적용: {query}'` / `'쿼리를 인식할 수 없습니다. 다음 필터 예시를 사용해 보세요:'` / `'적용된 필터 해제'` / `'웨이퍼 모드: 양불'` / `'웨이퍼 모드: 하드 빈'` / `'웨이퍼 모드: 소프트 빈'` / `'웨이퍼 모드: 파라메트릭'` / `'샘플 불러오기: {name}'` / `'샘플 STDF 다운로드'`

---

## 3. Test Checklists

### CORE Coder Checklist
- [ ] **Unit tests (`src/core/query/filter-dsl.test.ts`)**: Verify `parseOfflineNaturalQuery` parses `"only bin 7"`, `"sbin 7"`, `"hbin 4"`, `"tests with Cpk < 1.33"`, `"edge 3 rings"`, `"center"`, `"donut"`, `"failures"`, `"passing"`, `"wafer 3"`, `"site 2"`, `"site 1:2"`, and `"show edge failures with Cpk < 1.33"`; verify invalid inputs (`""`, `"gibberish"`, `"cpk < abc"`, `"edge 0 rings"`) return `ok: false`; verify `applyFilterDslToSelection` on `edge-ring-etch` selects outer-ring failing dies and identifies `IDDQ_LEAK` (`204`) as `lowestCpkTestNum`; verify `formatFilterDslChipDescriptors` and `removeFilterDslClause`.
- [ ] **Property 13 (`src/core/query/filter-dsl-codec.prop.test.ts`)**: `fast-check` (`numRuns: 200`) over arbitrary valid `FilterDslAst` (`dieClauses` + `capabilityClauses`) and `arbLotModel` -> `deserializeFilterDsl(serializeFilterDsl(ast))` returns `ok: true` with structural equality to `normalizeFilterDslAst(ast)`, selects the identical `dieMask`, `matchingTestNums`, and `lowestCpkTestNum` on `lot`, and serialized string contains zero raw STDF magic headers or control bytes.

### UI Coder Checklist
- [ ] **Unit tests (`src/ui/command-palette/command-palette.test.ts`, `active-filter-chips.test.ts`, `selection-store.test.ts`)**: Verify palette renders recents first, filter examples, and right-aligned `<kbd>` shortcuts; submitting a valid query updates `store.getState().dslFilter`, auto-selects `lowestCpkTestNum` when capability clauses exist, and renders removable `dsl-filter-chip` pills; submitting an invalid query leaves `store.getState()` unchanged and renders `palette-parse-error` with clickable examples; `i18n.test.ts` passes with 356 keys across all 5 locales.
- [ ] **Playwright E2E (`e2e/palette-t17.spec.ts`)**: (1) Pressing `Control+k` / `Meta+k` opens `[data-testid="command-palette"]` immediately (`0 ms`), with input focused, right-aligned `<kbd>` shortcuts, and no ember/orange colors; (2) typing `"show edge failures with Cpk < 1.33"` and pressing `Enter` updates wafer map, Bin Pareto, and Parametric panel (auto-selecting `IDDQ_LEAK`), and renders 3 removable `[data-testid="dsl-filter-chip"]` chips; (3) reopening palette shows `"show edge failures with Cpk < 1.33"` under `Recent queries` first; (4) typing an invalid query `"not a valid filter"` and pressing `Enter` keeps the current selection unchanged and displays inline clickable example queries; (5) submitting `"only bin 99"` (0 matching dies) renders `[data-testid="no-results-empty-state"]` with `"Clear the filter"` and `"Open the sample lot"`, and clicking `"Clear the filter"` restores the full lot.
