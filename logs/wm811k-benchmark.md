# WM-811K benchmark — wafer-map pattern classifier

Run on Fri 2026-11-20 (UTC+08:00) with `npx tsx tools/bench-wm811k.ts /workspace/work/wm811k`, after the classifier was frozen. The **baseline** rows are the earlier run of the original, untuned rule-based classifier on the same data, split and adapter; they are kept for comparison (also stored under `baseline` in `logs/wm811k-benchmark.json`).

## TL;DR

On the held-out **test split (51,886 wafers, never used for any tuning)** the classifier now gets **97.8% accuracy** (was 51.3%) and **macro-F1 0.885** (was 0.289). Per-class test recall: Center 0.92, Donut 0.91, Edge-Loc 0.82, Edge-Ring 0.98, Loc 0.70, Near-full 0.98, Random 0.88, Scratch 0.66, None 0.995. The false-alarm rate on `None` wafers dropped from 44.5% to 0.5%. Weakest classes: Scratch and Loc, which are still mostly lost to `None` when they are faint.

## What changed (see `logs/wm811k-tuning-notes.md` for the sources)

1. **Denoised features next to raw features** (Wu et al. 2015; Wang 2008). A 3×3 neighbour-count filter keeps a fail only if ≥3 of its 8 neighbours fail; a gentler ≥2 version keeps 1-die-wide scratch lines. Features are computed on the raw map and on both denoised maps.
2. **Adaptive per-wafer background.** Zone densities (6 radial bins, outermost ring, ring 1, rings 2–3) are also expressed as log-ratios to the wafer's own global fail fraction, plus clustering in excess of what a random scatter at that density would give. This is what stops ~10%-background `None` wafers from being called `Random`.
3. **Salient-region geometry** (Wu et al. Table III) of the largest 8-connected region in each denoised map: area, share, centroid/min/max radius, PCA major/minor axis, eccentricity, fill ratio, edge fraction, angular concentration, second-largest region.
4. **Small learned stage**: multinomial logistic regression on 87 handcrafted features (71 new + the 16 original rule scores/statistics), standardized and clipped to ±8. Fit with scikit-learn (C = 0.3, no class weights) **only on the train ids**; exported as plain TS constants in `src/core/patterns/wm811k-model.ts` (9×87 weights + 9 biases + 2×87 scaling constants). No runtime ML dependency.
5. **Rule override kept for decisive calls**: if the original rule score of a structured class (not `Random`) is ≥ 0.6, the rule's class is kept (on the inner validation split those calls were 870/873 correct; cost < 0.001 in accuracy/macro-F1). This keeps the designed behavior on clean, sparse STDF-style wafers.
6. **Site-driven lots** (STDF only): if one test site carries ≥ half the fails at ≥ 3× the other sites' rate, the rules decide alone. WM-811K maps have no site data, so this never fires in this benchmark.
7. The 1.5% / 5-die noise gate is unchanged (836 of 172,950 wafers stop there and are called `None`).

## Protocol (how leakage was avoided)

- Fixed stratified 70/30 split (seed 20261120) from `export.py`; ids in `split.json`.
- All choices (feature set, denoise thresholds, C ∈ {0.1, 0.3, 1, 3}, class-weight power ∈ {0, 0.25, 0.5}, logistic regression vs decision tree, override threshold) were made on a stratified 75/25 split **inside the train ids** (`tools/train-wm811k.py`, random_state 7), plus `tools/bench-wm811k.ts --only train`, which skips test wafers unread. Logistic regression beat depth-8/10/12 decision trees (validation macro-F1 0.867 vs ≤ 0.808).
- Inner-validation result of the final feature set: accuracy 0.980, macro-F1 0.888. The final model was then refit on all train rows, the code was frozen, and the test split was run **once**.

## Results

| Version | Split | Wafers | Accuracy | Acc. excl. None | Macro-F1 (9 cls) | Macro-F1 (8 defect) | Defect detected | None false-alarm |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline (rules only) | **Test (30%)** | 51,886 | 51.3% | 27.4% | 0.289 | 0.241 | 46.2% | 44.5% |
| Baseline (rules only) | Train (70%) | 121,064 | 51.3% | 27.6% | 0.285 | 0.237 | 46.5% | 44.6% |
| Baseline (rules only) | All | 172,950 | 51.3% | 27.5% | 0.286 | 0.238 | 46.5% | 44.6% |
| **New (rules + features + LR)** | **Test (30%)** | 51,886 | 97.8% | 87.8% | 0.885 | 0.871 | 91.6% | 0.5% |
| **New (rules + features + LR)** | Train (70%) | 121,064 | 98.0% | 88.8% | 0.898 | 0.886 | 92.2% | 0.5% |
| **New (rules + features + LR)** | All | 172,950 | 97.9% | 88.5% | 0.894 | 0.881 | 92.1% | 0.5% |

Train is in-sample for the learned stage, so the train–test gap (macro-F1 0.898 → 0.885) is the honest overfitting estimate: small.

### Per-class — test split (30%), with baseline for comparison

| Class | Support | Predicted | Precision | Recall | F1 | Baseline recall | Baseline F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Center | 1,288 | 1,250 | 0.950 | **0.922** | 0.936 | 0.012 | 0.025 |
| Donut | 167 | 173 | 0.879 | **0.910** | 0.894 | 0.036 | 0.069 |
| Edge-Loc | 1,557 | 1,441 | 0.881 | **0.816** | 0.847 | 0.003 | 0.006 |
| Edge-Ring | 2,904 | 2,874 | 0.989 | **0.979** | 0.984 | 0.634 | 0.776 |
| Loc | 1,078 | 893 | 0.850 | **0.704** | 0.770 | 0.043 | 0.081 |
| Near-full | 45 | 50 | 0.880 | **0.978** | 0.926 | 0.956 | 0.945 |
| Random | 260 | 259 | 0.884 | **0.881** | 0.882 | 0.519 | 0.013 |
| Scratch | 358 | 291 | 0.814 | **0.662** | 0.730 | 0.006 | 0.011 |
| None | 44,229 | 44,655 | 0.986 | **0.995** | 0.990 | 0.555 | 0.673 |

### Confusion matrix — test split (rows = expert label, columns = prediction)

| true \ pred | Center | Donut | Edge-Loc | Edge-Ring | Loc | Near-full | Random | Scratch | None |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Center** | 1,188 | 7 | 1 | 0 | 11 | 0 | 0 | 0 | 81 |
| **Donut** | 3 | 152 | 0 | 0 | 9 | 0 | 1 | 0 | 2 |
| **Edge-Loc** | 4 | 0 | 1,270 | 19 | 39 | 0 | 5 | 2 | 218 |
| **Edge-Ring** | 0 | 0 | 26 | 2,842 | 0 | 0 | 2 | 0 | 34 |
| **Loc** | 28 | 8 | 43 | 0 | 759 | 0 | 9 | 19 | 212 |
| **Near-full** | 0 | 0 | 0 | 0 | 0 | 44 | 1 | 0 | 0 |
| **Random** | 7 | 1 | 7 | 0 | 7 | 6 | 229 | 0 | 3 |
| **Scratch** | 0 | 2 | 4 | 1 | 21 | 0 | 2 | 237 | 91 |
| **None** | 20 | 3 | 90 | 12 | 47 | 0 | 10 | 33 | 44,014 |

### Per-class — train split (in-sample)

| Class | Support | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| Center | 3,006 | 0.952 | 0.922 | 0.937 |
| Donut | 388 | 0.917 | 0.912 | 0.915 |
| Edge-Loc | 3,632 | 0.887 | 0.850 | 0.868 |
| Edge-Ring | 6,776 | 0.988 | 0.986 | 0.987 |
| Loc | 2,515 | 0.860 | 0.706 | 0.775 |
| Near-full | 104 | 0.944 | 0.981 | 0.962 |
| Random | 606 | 0.922 | 0.881 | 0.901 |
| Scratch | 835 | 0.838 | 0.665 | 0.741 |
| None | 103,202 | 0.987 | 0.995 | 0.991 |

All/train/test confusion matrices are in `logs/wm811k-benchmark.json`.

**Runtime:** 88 s wall for all 172,950 wafers including JSON parsing and map conversion; 60.3 s inside the classifier = **0.35 ms/wafer** (baseline 0.19 ms), Node v22.23.5, 2-vCPU sandbox, single thread.

## Where it still goes wrong (test split)

1. **Faint patterns → None**: Edge-Loc 218 (14%), Loc 212 (20%), Scratch 91 (25%), Center 81 (6%). These are the weakest signals on top of ~10% background; several look like `None` by eye too.
2. **Loc is the catch-all confusion**: Loc ↔ Edge-Loc (43 / 39), Loc → Center 28, Scratch → Loc 21 — the same boundary Wu et al. report as hardest.
3. **None false alarms are rare but not zero**: 229 of 44,229 (0.5%), mostly Edge-Loc (90) and Loc (47).

## Limitations (read before quoting these numbers)

- The learned part is fit to WM-811K (one fab, one era, expert labels that are known to be noisy). Its confidence is a WM-811K class probability, not calibrated for STDF lots from other fabs or testers.
- WM-811K semantics are now the reference: a uniform ~10% scatter is `None`, because that is what labeled `None` wafers look like (median background fail rate ~10%). Real `Random` wafers fail ~42–55% of dies (train IQR).
- Not comparable one-to-one with published numbers: Wu et al. (SVM, 94.6%) used the dataset's own train/test partition; CNN papers usually train on balanced subsets. This is a 70/30 stratified split over all 172,950 labeled wafers, where accuracy is dominated by `None` (85%) — use macro-F1 and per-class recall.
- The bundled model is about 970 numbers (weights, biases, feature scaling) derived from WM-811K labels; no wafer maps are bundled. The Hugging Face mirror states no license; check the original MIR Lab / Kaggle terms before redistributing anything derived from it.

## Reproduce

```bash
# 1. download LSWMD.pkl (2.1 GB) outside the repo
curl -L -o /workspace/work/wm811k/LSWMD.pkl https://huggingface.co/datasets/lslattery/wafer-defect-detection/resolve/main/LSWMD.pkl
# 2. export labeled maps + fixed split (python + pandas)
(cd /workspace/work/wm811k && python3 "$OLDPWD/tools/wm811k-export.py")   # -> labeled.jsonl, split.json (run from repo root)
# 3. (optional) re-train the learned stage — train ids only
npx tsx tools/wm811k-export-features.ts /workspace/work/wm811k /tmp/wm811k-features.csv
pip install scikit-learn pandas numpy
python3 tools/train-wm811k.py /tmp/wm811k-features.csv   # rewrites src/core/patterns/wm811k-model.ts
# 4. benchmark (from the repo root); add --only train while tuning
npx tsx tools/bench-wm811k.ts /workspace/work/wm811k
```
