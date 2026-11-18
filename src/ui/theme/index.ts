export {
  applyResolvedTheme,
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  parseThemePreference,
  readStoredThemePreference,
  type ResolvedTheme,
  resolveTheme,
  THEME_COLOR_META,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemeDocumentLike,
  type ThemePreference,
  type ThemeStorageLike,
  writeStoredThemePreference,
} from './theme-preference';
export { THEME_INIT_SCRIPT } from './theme-script';
export { switchThemePreference, ThemeController } from './ThemeController';
export {
  createThemeSwitcher,
  THEME_SWITCHING_ATTRIBUTE,
  type ThemeSwitcher,
  type ViewTransitionLike,
  withTransitionsSuppressed,
} from './theme-transition';
