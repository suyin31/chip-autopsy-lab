# WM-811K tuning notes — what published non-deep methods do

Written before any tuning (step 1). Goal: pick deterministic, explainable, browser-cheap techniques
from the feature-based literature that address our two measured failure modes on real WM-811K maps:
(a) ~10% scattered background fails make `None` wafers look `Random`, and (b) the same background
dilutes the spatial features of structured patterns so they fall to `None`/`Random`.

No code was copied from any of the repos below; only the ideas (feature definitions) are used.

## 1. Compute features twice: on the raw map and on a denoised map (Wu et al. 2015, WMFPR)

- Wu, Jang & Chen, "Wafer Map Failure Pattern Recognition and Similarity Ranking for Large-Scale
  Data Sets", IEEE Trans. Semicond. Manuf. 28(1):1-12, 2015, doi:10.1109/TSM.2014.2364237.
  PDF: http://mirlab.org/jang/research/paper/download/Wafer%20Map%20Failure%20Pattern%20Recognition%20and%20Similarity%20Ranking%20for%20Large-scale%20Datasets.pdf
- Sec. VI-B: no single noise-reduction scheme is safe ("noise reduction effectively exposes Donut …
  the same noise reduction destructs Edge-ring", Fig. 11). Their fix: extract every feature **with and
  without** median-filter denoising and concatenate both (116-dim). The combined set gave the best
  DET curve (Fig. 12). Overall test accuracy 94.63% with an RBF SVM.
- Two-stage decision: stage 1 Pattern vs Nonpattern with a cost weight (c_pattern = 20) to trade false
  positives vs false negatives; stage 2 one-vs-one among the 8 patterns with class costs ∝ 1/size.
- **Take-away for us:** keep the raw-map features (they protect Edge-Ring / Scratch) and add the same
  features on a denoised map (they expose Center / Donut / Loc). Make the None-vs-pattern decision a
  separate, explicitly weighted step instead of a fixed 1.5 % noise gate.

## 2. Spatial (neighbourhood) filter to strip random background fails

- C.-H. Wang, "Recognition of semiconductor defect patterns using spatial filtering and spectral
  clustering", Expert Syst. Appl. 34(3):1914-1924, 2008 — spatial filter separates random clutter
  (particle-related, uniform) from systematic clusters (process-related).
  https://www.sciencedirect.com/science/article/abs/pii/S0957417407000681
- Polar-coordinate CNN paper (Electronics 13(7):1360, 2024, https://www.mdpi.com/2079-9292/13/7/1360):
  a fail die is reset to pass when fewer than N fails lie in its 3×3 window; N = 3 works, N = 4 starts
  destroying thin Scratch lines.
- Fuzzy-inference WM-811K classifier (Electronics 15(1):130, 2025, https://www.mdpi.com/2079-9292/15/1/130):
  same 3×3 count filter used as the noise-removal step before interpretable (fuzzy) rules.
- Image processing for wafer defect clusters (NSYSU, IEEE Design & Test,
  https://vlsi.ee.nsysu.edu.tw/papers/Journal/J_036.pdf): median filter removes salt-and-pepper
  isolated fails, then re-dilate surviving clusters by their 8-neighbours to undo erosion.
- **Take-away:** a 3×3 neighbour-count filter (keep a fail if ≥ k of its 8 neighbours fail) is cheap,
  D4-invariant and is the standard denoiser. Keep k low (thin scratches), and keep raw features too.

## 3. Zone / ring densities (density-based features)

- 13-region density features (4 edge regions + 9 central regions of a 5×5-style partition), used by
  the widely reused Kaggle notebook "WM-811k Wafermap" (NowYSM / ashishpatel26, Apache-2.0,
  https://www.kaggle.com/code/ashishpatel26/wm-811k-wafermap) and its derivatives, e.g.
  DMkelllog/WMPC_MFE_TF2 (MIT, https://github.com/DMkelllog/WMPC_MFE_TF2) and
  DMkelllog/wafermap_handcrafted_features (https://github.com/DMkelllog/wafermap_handcrafted_features):
  13 density + 6 geometry + 20/40 Radon = 59 features.
- Wu et al. also use the local defect ratio of the **two outermost rings** (8-connected) as a dedicated
  Edge-Ring / Edge-Loc feature.
- arijit-m/Wafer-map-defect-classification (https://github.com/arijit-m/Wafer-map-defect-classification):
  a 10-ring radial density profile (center→edge) to separate Center / Donut / Edge-Ring / None.
- **Take-away:** the 13-region grid is not rotation-invariant; for our D4-invariant classifier use
  concentric radial bins (normalized radius) + outermost-ring densities + angular-sector statistics
  (max / mean sector density), each *relative to the wafer's own median/background density* so the
  ~10 % background is subtracted per wafer (adaptive noise baseline).

## 4. Geometry of the most salient region (region labeling)

- Wu et al. Sec. III-B-1, Table III: label connected defect regions, take the region with the
  largest area (and the one with the largest perimeter), and describe it by: area / wafer area,
  perimeter / wafer radius, max and min distance to the wafer center, major / minor axis of the
  fitted ellipse, solidity, eccentricity. Statistical attributes: global defect ratio and the defect
  ratio of the two outermost rings. Linear attribute: number of Hough lines longer than 10 % of the
  diameter, allowing gaps < 3 % of the diameter.
- **Take-away:** our classifier already has bridged components + PCA elongation + a Hough-like
  line-band extractor (Scratch). Recompute the salient-region geometry on the **denoised** map, where
  the background no longer merges everything into one giant component.

## 5. Radon projections (rotation-invariant profile)

- Wu et al. Sec. III-A: Radon transform G(ρ, θ), min-max normalised; row mean and row std over θ,
  each resampled to 20 values (R_μ, R_σ). Center → narrow central peak, Donut → wider central band,
  Edge-Ring → response at the band border. Piao et al. 2018 (doi:10.1109/TSM.2018.2806931) use
  max/min/mean/std of the Radon projections with a decision-tree ensemble.
- **Take-away:** the radial-bin densities (item 3) carry most of the same "where along the radius"
  information at a fraction of the cost; a full Radon transform is optional for a browser classifier.

## Expectations / honesty

- Published feature+SVM numbers (94.6 %) use their own split and a training set curated to be
  pattern-rich; feature-based SVM *balanced* accuracy on WM-811K is reported well below 50 % in
  another study (UCSB ITC'21, https://web.ece.ucsb.edu/~lip/publications/ConstrastiveLearning-ITC2021-Submitted.pdf).
  Our target is a big, honest improvement over the 51 % / 0.29 baseline, not matching CNNs.
- Any learned part must be trained on the fixed train ids only; test is run once after freezing.
