/**
 * Pre-hydration inline accent script (`src/ui/theme/accent-script.ts`).
 *
 * Injected into `<head>` in `src/app/layout.tsx` next to `THEME_INIT_SCRIPT`, so
 * `<html data-accent="...">` is set before first paint with zero flash.
 * Logic mirrors `readStoredAccentPreference` and `applyAccent`.
 */

import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT_PREFERENCE,
} from './accent-preference';

export const ACCENT_INIT_SCRIPT = `(function(){var KEY=${JSON.stringify(ACCENT_STORAGE_KEY)},DEF=${JSON.stringify(DEFAULT_ACCENT_PREFERENCE)},a=null;try{a=localStorage.getItem(KEY);}catch(e){}if(a!=="ember"&&a!=="cobalt"&&a!=="jade"&&a!=="violet")a=DEF;document.documentElement.setAttribute("data-accent",a);})();`;
