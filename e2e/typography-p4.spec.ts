import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P4 typography (premium.md §4.1–§4.3): computed styles of the verdict headline
 * (`display-l`), stat value (`stat`), finding headline (`row-title`), and finding sub-line
 * (`subhead`) at 1440 and 390, plus the A40 letter-spacing check for CJK locales.
 */

interface Expected {
  readonly size: number;
  readonly lineHeight: number;
  readonly weight: number;
  readonly trackingEm: number;
}

const ROLES = {
  displayL: '[data-testid="verdict-headline"]',
  stat: '[data-testid="verdict-stat-item"] dd',
  rowTitle: '[data-testid="finding-row-headline"]',
  subhead: '[data-testid="finding-row-subline"]',
} as const;

type Role = keyof typeof ROLES;

const DESKTOP: Record<Role, Expected> = {
  displayL: { size: 48, lineHeight: 1.08, weight: 600, trackingEm: -0.024 },
  stat: { size: 40, lineHeight: 1, weight: 300, trackingEm: -0.022 },
  rowTitle: { size: 15, lineHeight: 1.33, weight: 590, trackingEm: -0.008 },
  subhead: { size: 13, lineHeight: 1.38, weight: 400, trackingEm: -0.003 },
};

const MOBILE: Record<Role, Expected> = {
  displayL: { size: 32, lineHeight: 1.12, weight: 600, trackingEm: -0.02 },
  stat: { size: 28, lineHeight: 1, weight: 300, trackingEm: -0.016 },
  rowTitle: DESKTOP.rowTitle,
  subhead: DESKTOP.subhead,
};

async function loadDemo(
  page: Page,
  width: number,
  height: number,
  locale?: string,
) {
  await page.addInitScript((loc) => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
    if (loc) window.localStorage.setItem("cal.locale", loc);
  }, locale ?? null);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute(
    "data-sweep",
    "done",
    {
      timeout: 5_000,
    },
  );
  await expect(page.getByTestId("verdict-headline")).toBeVisible();
  await expect(page.locator(ROLES.subhead).first()).toBeAttached();
}

async function readStyles(page: Page) {
  return page.evaluate((roles) => {
    const out: Record<
      string,
      {
        size: number;
        lineHeight: number;
        weight: number;
        letterSpacing: string;
        variation: string;
        numeric: string;
        feature: string;
      }
    > = {};
    for (const [role, selector] of Object.entries(roles)) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      const cs = getComputedStyle(el);
      out[role] = {
        size: Number.parseFloat(cs.fontSize),
        lineHeight: Number.parseFloat(cs.lineHeight),
        weight: Number(cs.fontWeight),
        letterSpacing: cs.letterSpacing,
        variation: cs.fontVariationSettings,
        numeric: cs.fontVariantNumeric,
        feature: cs.fontFeatureSettings,
      };
    }
    return out;
  }, ROLES);
}

for (const [label, width, height, expected] of [
  ["1440", 1440, 900, DESKTOP],
  ["390", 390, 844, MOBILE],
] as const) {
  test(`type styles match premium §4.2 at ${label}`, async ({ page }) => {
    await loadDemo(page, width, height);
    const styles = await readStyles(page);
    for (const role of Object.keys(ROLES) as Role[]) {
      const got = styles[role]!;
      const want = expected[role];
      expect(got.size, `${role} size`).toBe(want.size);
      expect(got.lineHeight, `${role} line-height`).toBeCloseTo(
        want.size * want.lineHeight,
        1,
      );
      expect(got.weight, `${role} weight`).toBe(want.weight);
      expect(
        Number.parseFloat(got.letterSpacing),
        `${role} tracking`,
      ).toBeCloseTo(want.size * want.trackingEm, 2);
      expect(got.feature, `${role} features`).toContain('"cv11"');
      expect(got.feature, `${role} features`).toContain('"ss03"');
    }
    expect(styles.displayL!.variation).toContain('"opsz" 32');
    expect(styles.stat!.variation).toContain('"opsz" 32');
    expect(styles.rowTitle!.variation).toBe("normal");
    expect(styles.stat!.numeric).toContain("tabular-nums");
    expect(styles.rowTitle!.numeric).toContain("tabular-nums");
    expect(styles.subhead!.numeric).toContain("tabular-nums");
  });
}

for (const locale of ["ja", "zh-CN", "zh-TW", "ko"] as const) {
  for (const [label, width, height] of [
    ["1440", 1440, 900],
    ["390", 390, 844],
  ] as const) {
    test(`A40: letter-spacing computes to 0 in ${locale} at ${label}`, async ({
      page,
    }) => {
      await loadDemo(page, width, height, locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const styles = await readStyles(page);
      for (const role of Object.keys(ROLES) as Role[]) {
        expect(["0px", "normal"], `${role} letter-spacing`).toContain(
          styles[role]!.letterSpacing,
        );
      }
      const rowTitleLh = styles.rowTitle!.lineHeight / styles.rowTitle!.size;
      expect(rowTitleLh).toBeCloseTo(1.4, 1);
      const breakRules = await page.evaluate(() => {
        const cs = getComputedStyle(
          document.querySelector('[data-testid="verdict-headline"]')!,
        );
        return { lineBreak: cs.lineBreak, wordBreak: cs.wordBreak };
      });
      if (locale === "ko") expect(breakRules.wordBreak).toBe("keep-all");
      else expect(breakRules.lineBreak).toBe("strict");
    });
  }
}
