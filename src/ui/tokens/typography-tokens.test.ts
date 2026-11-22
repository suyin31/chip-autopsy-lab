import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_FONT_WEIGHTS,
  CJK_TYPOGRAPHY_OVERRIDES,
  TYPOGRAPHY_DESKTOP_STEPS_PX,
  TYPOGRAPHY_TOKENS,
  type TypeRoleSpec,
} from "./index";

const css = fs.readFileSync(
  path.resolve(__dirname, "../../app/globals.css"),
  "utf8",
);

const kebab = (name: string): string =>
  name
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

/** Returns the body of the first block whose selector text matches exactly. */
function blockAfter(marker: string, from = 0): string {
  const start = css.indexOf(marker, from);
  expect(start, `missing block ${marker}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed block ${marker}`);
}

const fmtEm = (em: number): string => `${em}em`;

describe("type styles (premium.md §4.2)", () => {
  const entries = Object.entries(TYPOGRAPHY_TOKENS);

  it("covers every §4.2 style", () => {
    expect(entries.map(([name]) => kebab(name))).toEqual([
      "display-xl",
      "display-l",
      "title-1",
      "title-2",
      "title-3",
      "stat",
      "stat-s",
      "headline",
      "body",
      "row-title",
      "callout",
      "control",
      "subhead",
      "caption",
      "mono-data",
    ]);
  });

  it("locks the acceptance roles at desktop and mobile", () => {
    expect(TYPOGRAPHY_TOKENS.displayL.desktop).toMatchObject({
      sizePx: 48,
      lineHeight: 1.08,
      weight: 520,
      trackingEm: -0.03,
    });
    expect(TYPOGRAPHY_TOKENS.displayL.mobile).toMatchObject({
      sizePx: 32,
      lineHeight: 1.12,
      weight: 520,
      trackingEm: -0.02,
    });
    expect(TYPOGRAPHY_TOKENS.stat.desktop).toMatchObject({
      sizePx: 40,
      lineHeight: 1,
      weight: 300,
      trackingEm: -0.022,
    });
    expect(TYPOGRAPHY_TOKENS.stat.mobile).toMatchObject({
      sizePx: 28,
      lineHeight: 1,
      weight: 300,
      trackingEm: -0.016,
    });
    expect(TYPOGRAPHY_TOKENS.rowTitle.desktop).toEqual(
      TYPOGRAPHY_TOKENS.rowTitle.mobile,
    );
    expect(TYPOGRAPHY_TOKENS.rowTitle.desktop).toMatchObject({
      sizePx: 15,
      lineHeight: 1.33,
      weight: 590,
      trackingEm: -0.008,
    });
    expect(TYPOGRAPHY_TOKENS.subhead.desktop).toMatchObject({
      sizePx: 13,
      lineHeight: 1.38,
      weight: 400,
      trackingEm: -0.003,
    });
    expect(TYPOGRAPHY_DESKTOP_STEPS_PX).toEqual({
      displayL: { 1280: 44, 1024: 36 },
      stat: { 1280: 36, 1024: 32 },
    });
  });

  it("uses only allowed weights, 300 only on stats, nothing under 12 px", () => {
    for (const [name, token] of entries) {
      for (const spec of [token.desktop, token.mobile]) {
        expect(ALLOWED_FONT_WEIGHTS).toContain(spec.weight);
        expect(spec.sizePx).toBeGreaterThanOrEqual(12);
        if (spec.weight === 300) expect(name.startsWith("stat")).toBe(true);
      }
    }
  });

  it("declares matching desktop CSS variables and a utility per style", () => {
    for (const [name, token] of entries) {
      const k = kebab(name);
      const d = token.desktop;
      expect(css).toContain(`--size-${k}: ${d.sizePx}px;`);
      expect(css).toContain(`--leading-${k}: ${d.lineHeight};`);
      expect(css).toContain(`--tracking-${k}: ${fmtEm(d.trackingEm)};`);
      const utility = blockAfter(`.type-${k} {`);
      expect(utility).toContain(`font-weight: ${d.weight};`);
      expect(utility).toContain(`letter-spacing: var(--tracking-${k});`);
      expect(utility.includes('"opsz" 32')).toBe((d as TypeRoleSpec).opsz === 32);
      expect(utility.includes("tabular-nums")).toBe(token.tabularNums);
    }
  });

  it("declares the mobile values under max-width 639px", () => {
    const mobile = blockAfter("@media (max-width: 639px) {");
    for (const [name, token] of entries) {
      const k = kebab(name);
      const { desktop: d, mobile: m } = token;
      if (m.sizePx !== d.sizePx)
        expect(mobile).toContain(`--size-${k}: ${m.sizePx}px;`);
      if (m.lineHeight !== d.lineHeight)
        expect(mobile).toContain(`--leading-${k}: ${m.lineHeight};`);
      if (m.trackingEm !== d.trackingEm)
        expect(mobile).toContain(`--tracking-${k}: ${fmtEm(m.trackingEm)};`);
    }
  });

  it("sets the Inter feature settings globally and uppercases eyebrows only (premium §12.4)", () => {
    const html = blockAfter("  html {");
    expect(html).toContain('font-feature-settings: "cv11", "ss03";');
    expect(html).toContain("font-optical-sizing: auto;");
    expect(html).toContain("-webkit-font-smoothing: antialiased;");
    expect(html).toContain("text-rendering: optimizeLegibility;");
    const uppercaseRules = css.match(/[^{}]*\{[^{}]*text-transform\s*:\s*uppercase[^{}]*\}/g) ?? [];
    expect(uppercaseRules.map((rule) => rule.slice(0, rule.indexOf("{")).trim().split("\n").pop()?.trim())).toEqual([
      ".type-eyebrow",
    ]);
  });
});

describe("CJK typography (premium.md §4.3)", () => {
  const cjk = blockAfter("/* CJK typography (premium.md §4.3)");

  it("zeroes tracking on every token and the element itself", () => {
    for (const name of Object.keys(TYPOGRAPHY_TOKENS)) {
      expect(cjk).toContain(`--tracking-${kebab(name)}: 0em;`);
    }
    expect(cjk).toMatch(/\n\s*letter-spacing: 0;/);
    expect(cjk).toContain("font-style: normal;");
  });

  it("sets the CJK line-heights and display sizes", () => {
    const lh = CJK_TYPOGRAPHY_OVERRIDES.lineHeight;
    expect(cjk).toContain(`--leading-display-xl: ${lh.displayXl};`);
    expect(cjk).toContain(`--leading-display-l: ${lh.displayL};`);
    for (const t of ["title-1", "title-2", "title-3"])
      expect(cjk).toContain(`--leading-${t}: ${lh.title};`);
    expect(cjk).toContain(`--leading-headline: ${lh.headline};`);
    expect(cjk).toContain(`--leading-row-title: ${lh.rowTitle};`);
    expect(cjk).toContain(`--leading-body: ${lh.body};`);
    expect(cjk).toContain(`--leading-callout: ${lh.callout};`);
    expect(cjk).toContain(`--leading-subhead: ${lh.subhead};`);
    expect(cjk).toContain(`--leading-caption: ${lh.caption};`);
    expect(cjk).toContain(
      `--size-display-xl: ${CJK_TYPOGRAPHY_OVERRIDES.displayXlDesktopPx}px;`,
    );
    expect(cjk).toContain(
      `--size-display-l: ${CJK_TYPOGRAPHY_OVERRIDES.displayLDesktopPx}px;`,
    );
  });

  it("applies strict line breaking for zh/ja and keep-all for ko", () => {
    expect(
      blockAfter(":is(:lang(zh-CN), :lang(zh-TW), :lang(ja)) {"),
    ).toContain("line-break: strict;");
    expect(blockAfter(":lang(ko) {")).toContain("word-break: keep-all;");
  });
});
