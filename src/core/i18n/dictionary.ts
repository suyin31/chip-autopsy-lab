/**
 * Strongly typed dictionary lookup, `{param}` interpolation, and plural helper
 * (`src/core/i18n/dictionary.ts`).
 *
 * Implements redesign §6.3 with compile-time key and placeholder verification
 * derived directly from `en.ts`.
 */

import { formatInteger, getLocaleFormatters } from './format';
import type { Locale } from './locales';
import { en } from './messages/en';
import { ja } from './messages/ja';
import { ko } from './messages/ko';
import { zhCN } from './messages/zh-cn';
import { zhTW } from './messages/zh-tw';

export type MessageKey = keyof typeof en;

export type Dictionary = { readonly [K in MessageKey]: string };

type ExtractParamNames<S extends string> =
  S extends `${string}{${infer P}}${infer Rest}`
    ? P | ExtractParamNames<Rest>
    : never;

export type MessageParamName<K extends MessageKey> = ExtractParamNames<
  (typeof en)[K]
>;

export type MessageParams<K extends MessageKey> = [MessageParamName<K>] extends [
  never,
]
  ? Record<string, never>
  : { readonly [P in MessageParamName<K>]: string | number };

export type TArgs<K extends MessageKey> = [MessageParamName<K>] extends [never]
  ? []
  : [params: MessageParams<K>];

export type PluralBaseKey = {
  [K in MessageKey]: K extends `${infer Base}.one`
    ? `${Base}.other` extends MessageKey
      ? Base
      : never
    : never;
}[MessageKey];

export type PluralArgs<B extends PluralBaseKey> = [
  Exclude<MessageParamName<`${B}.other`>, 'count'>,
] extends [never]
  ? [params?: MessageParams<`${B}.other`>]
  : [params: MessageParams<`${B}.other`>];

export const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
};

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? en;
}

const PLACEHOLDER_REGEX = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Returns the sorted unique `{placeholder}` names appearing in a template string.
 */
export function extractPlaceholders(template: string): readonly string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_REGEX)) {
    const token = match[1];
    if (token) {
      found.add(token);
    }
  }
  return Array.from(found).sort();
}

function interpolateTemplate(
  template: string,
  params: Readonly<Record<string, string | number>> | undefined,
): string {
  if (!params) {
    return template;
  }
  return template.replace(PLACEHOLDER_REGEX, (fullMatch, paramName: string) => {
    if (Object.prototype.hasOwnProperty.call(params, paramName)) {
      return String(params[paramName]);
    }
    return fullMatch;
  });
}

/**
 * Translates `key` in `locale` with compile-time checked `{placeholder}` params (§6.3).
 */
export function t<K extends MessageKey>(
  locale: Locale,
  key: K,
  ...args: TArgs<K>
): string {
  const dict = getDictionary(locale);
  const template = dict[key] ?? en[key];
  const params = args[0] as
    | Readonly<Record<string, string | number>>
    | undefined;
  return interpolateTemplate(template, params);
}

/**
 * Resolves a `.one` / `.other` plural key via `Intl.PluralRules(locale)` (§6.3).
 */
export function pluralKey<B extends PluralBaseKey>(
  locale: Locale,
  baseKey: B,
  count: number,
): `${B}.one` | `${B}.other` {
  const { pluralRules } = getLocaleFormatters(locale);
  const safeCount = Number.isFinite(count) ? Math.abs(count) : 0;
  const category = pluralRules.select(safeCount);
  return category === 'one' ? `${baseKey}.one` : `${baseKey}.other`;
}

/**
 * Translates a `.one` / `.other` plural entry using `Intl.PluralRules(locale)`.
 * When `params` is omitted for `{count}`-only messages, `count` is formatted via `formatInteger(locale, count)`.
 */
export function tPlural<B extends PluralBaseKey>(
  locale: Locale,
  baseKey: B,
  count: number,
  ...args: PluralArgs<B>
): string {
  const resolvedKey = pluralKey(locale, baseKey, count);
  const template = getDictionary(locale)[resolvedKey];
  const providedParams = args[0] as
    | Readonly<Record<string, string | number>>
    | undefined;
  const effectiveParams: Readonly<Record<string, string | number>> =
    providedParams ?? { count: formatInteger(locale, count) };
  return interpolateTemplate(template, effectiveParams);
}
