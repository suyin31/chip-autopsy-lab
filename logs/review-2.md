# Code Review — Task 2: STDF V4 Binary Reader and Writer

**Reviewer:** ATE/STDF Senior Engineer  
**Date:** 2026-11-17  
**Scope:** `src/core/stdf/*.ts`, `src/core/stdf/__test-utils__/golden-fixtures.ts`, `src/core/__test-utils__/arbitraries.ts`, and all associated tests  
**Spec baseline:** STDF V4 (Teradyne), Requirements 1.5–1.9, 2.1–2.5, 3.1; design.md §3.1

---

## Findings (Prioritised)

### BLOCKER

**None.**

---

### MAJOR

#### M1 — FAR REC_LEN is read with the *guessed* endianness before that endianness is established
- **File:** [stdf-parser.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-parser.ts#L911-L984)
- **Detail:** The parser inspects `rawOrDecompressed[0..1]` for a zero-length check (`[0] === 0 && [1] === 0`), reads `cpuType` at byte 4 to determine endianness, then reads `farRecLen = headerView.getUint16(0, littleEndian)` at line 973 using the just-determined endianness. Per STDF V4 spec, the FAR record is *always* 2 payload bytes (`CPU_TYPE` + `STDF_VER`), so `REC_LEN` is *always* `0x0002` regardless of byte order. The parser correctly handles this because `0x0002` is symmetric in both endiannesses.  However, the code has an implicit assumption: it checks `[0] === 0 && [1] === 0` to reject zero-length FARs *before* knowing the byte order. For a hypothetical big-endian FAR with REC_LEN = 256 (`0x01 0x00`), the check passes correctly. For the standard FAR (REC_LEN = 2), `0x02 0x00` LE or `0x00 0x02` BE: the big-endian FAR will have byte [0] = 0x00 and byte [1] = 0x02, hitting the `[0] === 0 && [1] === 0` check — but `[1]` is `0x02`, not `0x00`, so the check passes. Actually, reviewing further, this check is correct in rejecting `REC_LEN == 0` in both endiannesses (both bytes must be zero). **Downgraded — not an actual bug.** See M2 instead.

#### M2 — `stdf-parser-safety.prop.test.ts` (Property 2) is completely missing
- **File:** Expected at `src/core/stdf/stdf-parser-safety.prop.test.ts`
- **Detail:** Task 2.5 requires a `fast-check` property test validating "parser bounds safety and truncated-stream recovery" (Property 2 from requirements.md): for all arbitrary `Uint8Array` byte sequences (including fuzz bytes, corrupted headers, valid streams truncated at any byte offset k), the parser must terminate in finite time without throwing uncaught exceptions. This file does not exist. The existing deterministic tests in `stdf-parser.test.ts` cover specific truncation and malformed scenarios, but do **not** fuzz random byte sequences.
- **Impact:** Without this, there is no randomized fuzz coverage. A malicious or badly corrupted file could trigger an uncaught exception or infinite loop.
- **Fix:** Create `src/core/stdf/stdf-parser-safety.prop.test.ts` using `fc.uint8Array()` and `fc.integer()` to generate random buffers and truncation offsets. Assert `parseStdfBytes` returns `Result` without throwing. Assert truncation prefix recovery per Property 2 spec.

#### M3 — OPT_FLAG bits 4/5 semantics for inheriting *LLM_SCAL/HLM_SCAL* have an edge case
- **File:** [stdf-parser.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-parser.ts#L573-L635)
- **Detail:** Per STDF V4 spec §13.3.1 (PTR record), `OPT_FLAG` bit 4 (`0x10`) means "LO_LIMIT value is not valid; use the value from the first PTR for this test." Bit 5 (`0x20`) is the same for HI_LIMIT. The code (lines 584–606) correctly inherits `loLimit` from `existing.loLimit` when bit 4 is set. However, when bit 4 is set (inherit loLimit), the code at line 589–592 conditionally inherits `llmScal`: it only inherits if `rawLlmScal === undefined` **or** bit 4 is set in the guard. But the logic at line 590 checks `(rawOptFlag & PTR_OPT_FLAG.LO_LIMIT_INVALID) === 0` — if LO_LIMIT_INVALID is set, it uses `existing.llmScal`. This is correct. The analogous logic for `hlmScal` is also correct. **On re-examination, this is correct — bit 4 inherits the limit and bit 5 inherits the limit; the scale is inherited alongside.** Downgrading to observation.

#### M4 — `packSiteKey` can collide for HEAD_NUM > 255 or SITE_NUM > 255
- **File:** [types.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/types.ts#L192-L194)
- **Detail:** `packSiteKey` does `((headNum & 0xff) << 8) | (siteNum & 0xff)`, masking both to 8 bits. STDF V4 spec defines HEAD_NUM and SITE_NUM as `U*1` (0–255), so the mask is exactly correct for spec-compliant files. However, there is no validation that parsed values are within range. Since the cursor's `readU1()` returns a `Uint8` (0–255), the values are inherently in range. **Not a bug for spec-compliant code.** Downgrading to observation.

#### M5 — Writer's FAR record header REC_LEN is written with the target endianness, but FAR itself should be recognizable before endianness is known
- **File:** [stdf-writer.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-writer.ts#L41-L51)
- **Detail:** The writer serializes the FAR record header (including REC_LEN = 2) using the requested endianness. This is correct per STDF V4 spec: the FAR record uses the same byte order as the rest of the file, and `CPU_TYPE` at the fixed position within the payload tells the reader what order to use. The parser handles this correctly by reading `CPU_TYPE` from a known byte offset before interpreting `REC_LEN`. **Not a bug.**

---

### MINOR

#### m1 — `readOptU4()` throws on partial trailing bytes instead of returning `undefined`
- **File:** [binary-cursor.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.ts#L481-L483)
- **Detail:** `readOptU4()` returns `undefined` only when `atEnd` is true (zero remaining bytes). If 1–3 bytes remain, it calls `readU4()` which throws `RecordBoundsError`. Per Requirement 1.7, optional trailing fields that terminate at `recordEnd` should be treated as missing. If a record body ends with 1–3 bytes beyond the last fully consumed field, `readOptU4()` will throw rather than returning `undefined`. This is caught by the per-record try/catch in `parseStdfBytes` and results in a `MALFORMED_RECORD_FIELD` warning, which is a reasonable behavior — it indicates the record has a partial field, not a cleanly omitted one. This is a design choice rather than a bug, but could be more lenient: the STDF V4 spec states optional fields that are entirely absent (record terminates before the field) should be treated as "missing," but a *partial* field is genuinely malformed.
- **Fix (optional):** Consider returning `undefined` when `remaining < 4` for truly optional trailing fields. The current behavior is defensible — flag only as a documentation note.

#### m2 — No test for CPU_TYPE values 3–255 (unknown but non-VAX)
- **File:** [stdf-parser.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-parser.test.ts#L241-L308)
- **Detail:** The parser correctly rejects CPU_TYPE=0 (VAX) and unknown CPU_TYPE values 3+ at lines 953–962, returning `MISSING_FAR_HEADER`. But the test suite only tests CPU_TYPE=0 (VAX), not CPU_TYPE=3 or other out-of-range values. The error code returned for CPU_TYPE 3+ is `MISSING_FAR_HEADER`, which is semantically misleading — a code like `UNSUPPORTED_CPU_TYPE` would be more precise.
- **Fix:** Add a test case with CPU_TYPE=3. Consider adding an `UNSUPPORTED_CPU_TYPE` error code or at minimum document that `MISSING_FAR_HEADER` covers unknown CPU_TYPE values.

#### m3 — Writer does not validate that generated PTR/MPR `RESULT` values are finite
- **File:** [stdf-writer.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-writer.ts#L224)
- **Detail:** `writePtrRecord` calls `builder.writeR4(spec.result)` without checking `Number.isFinite(spec.result)`. If called with `NaN` or `Infinity`, the writer silently emits a non-finite IEEE 754 value. The parser then correctly flags this with `NON_FINITE_MEASUREMENT`. For a *deterministic synthetic writer*, this means a caller could inadvertently create an STDF file that triggers its own parser's warnings.
- **Fix:** Add a debug assertion or clamp in the writer, or document that callers must ensure finite results.

#### m4 — `BinaryCursor` constructor ignores `startOffset`/`recordEnd` and uses full buffer before `setWindow`
- **File:** [binary-cursor.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.ts#L105-L117)
- **Detail:** The constructor sets `this.currentOffset = 0` and `this.recordEndOffset = bytes.byteLength` before calling `setWindow(startOffset, recordEnd)`. This means the initial member values are immediately overwritten. No real issue, but the initial assignments on lines 114–115 are dead code.
- **Fix:** Remove lines 114–115 or refactor to set directly. Cosmetic only.

#### m5 — `BinaryRecordBuilder.endRecord` writes REC_LEN using builder's endianness — correct but subtle
- **File:** [binary-cursor.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.ts#L590-L598)
- **Detail:** `endRecord` writes the payload length back to the header position using `setUint16(headerOffset, payloadBytes, this.littleEndian)`. This is correct: STDF V4 specifies that multi-byte numeric fields (including the record header's REC_LEN) follow the byte order indicated by FAR.CPU_TYPE. No fix needed.

#### m6 — Arbitrary generator for property tests does not exercise MPR or FTR records in round-trips
- **File:** [arbitraries.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/__test-utils__/arbitraries.ts)
- **Detail:** `arbStdfWriteLotSpec` only generates `ptrs` arrays on parts — no `mprs` or `ftrs`. Property 1 (round-trip) therefore does not fuzz-test MPR and FTR record serialization/parsing symmetry. The deterministic tests in `stdf-parser.test.ts` lines 118–139 do cover a manual MPR/FTR example, but no randomized property coverage exists for these record types.
- **Fix:** Add `arbMprSpec` and `arbFtrSpec` arbitraries and include `mprs`/`ftrs` fields in `buildPartArbitrary`.

#### m7 — TSR `TEST_TIM`, `TEST_MIN`, `TEST_MAX`, `TST_SUMS`, `TST_SQRS` fields are `R*4` per spec but parser silently drops non-finite values
- **File:** [stdf-parser.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-parser.ts#L467-L472)
- **Detail:** The TSR decoder checks `Number.isFinite(testTim)` etc. and omits them when non-finite. This is reasonable defensive coding, but no warning is emitted for non-finite TSR statistical fields (unlike PTR where `NON_FINITE_MEASUREMENT` is emitted). This inconsistency is minor since TSR is a summary record, not a per-die test record.
- **Fix:** Consider emitting a warning, or document the intentional asymmetry.

#### m8 — `sanitizeStdfString` strips control chars but does not strip NUL-terminated padding
- **File:** [binary-cursor.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.ts#L24-L44)
- **Detail:** Some STDF files from real testers pad `C*n` fields with trailing NUL (`0x00`) bytes within the declared length. `sanitizeStdfString` strips all `< 0x20` characters including NUL, so this is handled correctly. **Not a bug.**

#### m9 — `D*n` bit-count prefix uses endianness but STDF V4 spec says it should be a U*2
- **File:** [binary-cursor.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.ts#L326-L348)
- **Detail:** `readDn()` reads the bit count with `this.view.getUint16(this.currentOffset, this.littleEndian)`. Per STDF V4 spec, the `D*n` data type has a U*2 bit-count prefix that follows the file's byte order. This is correct.

#### m10 — `readKxCn` pre-check underestimates required bytes
- **File:** [binary-cursor.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.ts#L435-L453)
- **Detail:** `readKxCn(count)` checks `this.currentOffset + count > this.recordEndOffset` as a minimum-length guard (each C*n needs at least 1 byte for the length prefix). This is a *lower bound* check only — individual `readCn()` calls within the loop will throw `RecordBoundsError` if the actual string data exceeds the record. This is correct and matches the defensive style.

#### m11 — Nominal test coverage for `C*1` non-printable byte handling
- **File:** [binary-cursor.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/binary-cursor.test.ts#L88-L89)
- **Detail:** The test verifies that `readC1()` for a `0x00` byte returns `' '` (space). This covers the fallback. However, there is no test for bytes 0x7F (DEL) or 0x01–0x1F (other controls). The implementation at line 272–275 handles all `< 0x20` and `> 0x7e` by returning `' '`, which is correct. Additional edge case tests (e.g., 0x7F, 0x1F, 0x80) would strengthen coverage.
- **Fix:** Add `expect(cursor.readC1()).toBe(' ')` for 0x7F and 0x80 test vectors.

#### m12 — Writer does not emit `C_RESFMT`, `C_LLMFMT`, `C_HLMFMT` or `LO_SPEC`/`HI_SPEC` on PTR
- **File:** [stdf-writer.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-writer.ts#L207-L319)
- **Detail:** The writer emits PTR records ending at `UNITS` (line 287) and does not write `C_RESFMT`, `C_LLMFMT`, `C_HLMFMT`, `LO_SPEC`, or `HI_SPEC` optional trailing fields. The parser correctly reads and discards these if present (lines 674–678). Since these are optional display-format fields and the design explicitly states they are not needed, this is acceptable. The only risk is that round-trip tests with real STDF files from testers that include these fields would see them stripped on re-serialization. Since the writer is for synthetic test data only, this is fine.

#### m13 — Property test `normalizeSpecToExpectedLot` has a subtle PTR default tracking bug for multi-wafer lots
- **File:** [stdf-roundtrip.prop.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-roundtrip.prop.test.ts#L121-L255)
- **Detail:** The `normalizeSpecToExpectedLot` function creates a single `ptrDefaults` Map for the entire lot and processes wafers sequentially. The writer also uses a single `firstPtrMap` per lot (line 625 in `stdf-writer.ts`). So both track PTR defaults at lot scope, not wafer scope. Per STDF V4, `PTR` default inheritance is indeed per TEST_NUM across the entire data stream (not per wafer), so this is correct.

#### m14 — Requirement 1.8 mentions OPT_FLAG bit 0 for `RES_SCAL` invalid, but tasks.md says bits "0/4/5" for inherit — the code and tests check the right bits
- **File:** [stdf-parser.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-parser.ts#L574-L577) and [stdf-parser.test.ts](file:///workspace/projects/90e552d5-724b-49e1-bd52-acbbadbf680c/repos/chip-autopsy-lab/src/core/stdf/stdf-parser.test.ts#L404-L531)
- **Detail:** The code correctly handles bit 0 (0x01 = RES_SCAL_INVALID → inherit resScal), bit 4 (0x10 = LO_LIMIT_INVALID → inherit loLimit), bit 5 (0x20 = HI_LIMIT_INVALID → inherit hiLimit), bit 6 (0x40 = NO_LO_LIMIT → force null), and bit 7 (0x80 = NO_HI_LIMIT → force null). Tests exercise all five bits. Requirement 1.8 says "OPT_FLAG bits 4, 5, 6, and 7" (omitting bit 0 from the list) but bit 0 is separately mentioned as resScal being display-only. Code and tests are aligned to the full STDF V4 spec. No issue.

---

### OBSERVATIONS (Informational, No Fix Needed)

1. **All 22 tests pass.** Test suite is comprehensive for the implemented scope.

2. **Record schemas in `types.ts`** accurately reflect STDF V4 field layouts, types, and byte widths for all 16 decoded record types. Field order matches the Teradyne spec. `U*1`→1 byte, `U*2`→2 bytes, `U*4`→4 bytes, `I*1`→1 byte, `I*2`→2 bytes, `R*4`→4 bytes, `C*1`→1 byte, `C*n`→length-prefixed variable, `B*1`→1 byte, `B*n`→length-prefixed variable, `D*n`→bit-count-prefixed variable, `kxU*1`/`kxU*2`/`kxN*1`/`kxR*4`→counted arrays. All correct.

3. **Endianness from FAR.CPU_TYPE** is correctly determined: CPU_TYPE 1 → big, 2 → little, 0 → rejected with `UNSUPPORTED_CPU_TYPE_VAX`. All `DataView` reads use the resolved `littleEndian` flag consistently throughout cursor and parser.

4. **REC_LEN bounds checking** is thorough: the parser checks `recordEnd > totalBytes` before dispatching, and the cursor's `ensureAvailable` checks `offset + byteCount <= recordEndOffset` on every read. The try/catch in the main loop (line 1370) catches `RecordBoundsError` from any per-record decode failure and emits `MALFORMED_RECORD_FIELD`.

5. **Optional trailing fields** are correctly handled via `readOpt*()` methods that return `undefined` when `atEnd` is true. All 16 record decoders use these for optional fields.

6. **PTR default inheritance** is correctly keyed by `TEST_NUM` in a `Map<number, PtrDefaultContext>`. The first PTR for a TEST_NUM populates the map; subsequent PTRs inherit based on OPT_FLAG bits and field presence.

7. **Scaling exponents** (`RES_SCAL`, `LLM_SCAL`, `HLM_SCAL`) are stored as-is and documented as "display exponent only" in comments and type interfaces. `RESULT`, `LO_LIMIT`, and `HI_LIMIT` are stored in base units. No rescaling is ever applied. Correct per Requirement 1.8.

8. **Multi-site PIR/PRR handling** via `openParts: Map<number, OpenPartContext>` keyed by `packSiteKey(headNum, siteNum)` is correct. PIR opens a context, interleaved PTR/MPR/FTR records attach to the matching open part, and PRR closes it. Orphan test records (no matching open PIR) emit `ORPHAN_TEST_RECORD` warnings.

9. **kxTYPE array reads** (kxU*1, kxU*2, kxN*1, kxR*4) correctly pre-check byte count before reading and use endian-aware DataView accessors for multi-byte elements. `kxN*1` nibble packing/unpacking is correct (lo nibble first per STDF V4 spec).

10. **Error handling on truncated/malformed data** is robust: truncated header → `TRUNCATED_TAIL_RECORD` warning and `break`; truncated body → same; malformed field within record → `RecordBoundsError` caught → `MALFORMED_RECORD_FIELD` warning → advance by REC_LEN. The parser never crashes the Web Worker.

11. **Test quality assessment:**
    - **binary-cursor.test.ts:** Strong — covers all data types in both endiannesses, bounds errors, variable-length overflows, optional trailing fields, and string sanitization. Not tautological.
    - **stdf-parser.test.ts:** Strong — 7 substantive tests covering all 16 record types, FAR rejection cases (7 scenarios), optional trailing fields, PTR inheritance (5 OPT_FLAG combos), multi-site interleaving with orphan/unclosed parts, unknown record skipping + bins-only mode, truncated/malformed recovery, and gzip round-trip + ceiling. Assertions are specific and meaningful.
    - **stdf-fixtures.test.ts:** Good — tests deterministic reproducibility and cross-endianness equivalence of golden fixtures. Verifies truncated and malformed fixtures.
    - **stdf-roundtrip.prop.test.ts:** Good — the normalization oracle in `normalizeSpecToExpectedLot` independently computes expected values from the write spec, then compares to parsed output. 200 randomized runs cover endianness, retests, PTR inheritance, optional field omission. Gzip round-trip is also property-tested. Weakness: no MPR/FTR coverage (see m6).

---

## Summary of Actionable Items

| # | Severity | File | Fix |
|---|----------|------|-----|
| M2 | MAJOR | (missing) `stdf-parser-safety.prop.test.ts` | Create Property 2 fuzz test per task 2.5 |
| m2 | MINOR | `stdf-parser.test.ts` | Add test for CPU_TYPE=3 rejection; consider dedicated error code |
| m3 | MINOR | `stdf-writer.ts:224` | Add debug-mode assertion for finite PTR `RESULT` values |
| m6 | MINOR | `arbitraries.ts` | Add MPR/FTR arbitraries to property test generator |
| m7 | MINOR | `stdf-parser.ts:467–472` | Emit warning for non-finite TSR statistical fields (consistency) |
| m11 | MINOR | `binary-cursor.test.ts` | Add edge-case readC1 tests for 0x7F, 0x80 |

---

## Verdict

**NEEDS-FIX** — The core STDF V4 reader/writer implementation is high quality and correctly implements the spec. However, task 2.5 (`stdf-parser-safety.prop.test.ts`, Property 2) is completely missing, which is a required deliverable. The minor items are non-blocking improvements.
