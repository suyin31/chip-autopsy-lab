/**
 * Pre-hydration inline theme script (`src/ui/theme/theme-script.ts`, premium.md §3.1).
 *
 * Injected into `<head>` in `src/app/layout.tsx` next to the locale script, so
 * `data-theme`, `style.colorScheme`, and `<meta name="theme-color">` are set before
 * first paint (no light flash on a dark OS, no dark flash on a light preference).
 * Logic mirrors `readStoredThemePreference`, `resolveTheme`, and `applyResolvedTheme`.
 */

import {
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  THEME_COLOR_META,
  THEME_STORAGE_KEY,
} from './theme-preference';

export const THEME_INIT_SCRIPT = `(function(){var KEY=${JSON.stringify(THEME_STORAGE_KEY)},DEF=${JSON.stringify(DEFAULT_THEME_PREFERENCE)},C=${JSON.stringify(THEME_COLOR_META)},p=null;try{p=localStorage.getItem(KEY);}catch(e){}if(p!=="system"&&p!=="light"&&p!=="dark")p=DEF;var t=p;if(p==="system"){t="light";try{if(typeof window!=="undefined"&&window.matchMedia&&window.matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches)t="dark";}catch(e){}}var el=document.documentElement;el.setAttribute("data-theme",t);el.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");if(document.head)document.head.appendChild(m);}m.setAttribute("content",C[t]);})();`;
