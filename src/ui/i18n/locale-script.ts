/**
 * Pre-hydration inline locale detection script (`src/ui/i18n/locale-script.ts`).
 *
 * Injected into `<head>` in `src/app/layout.tsx` (§6.4) so `document.documentElement.lang`
 * and `data-locale` are resolved synchronously before first paint with zero flash:
 * 1. `localStorage["cal.locale"]` if supported (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`).
 * 2. First match in `navigator.languages`:
 *    - `zh-TW`, `zh-HK`, `zh-MO`, or `zh-Hant*` -> `zh-TW`
 *    - other `zh*` -> `zh-CN`
 *    - `ja*` -> `ja`
 *    - `ko*` -> `ko`
 *    - `en*` -> `en`
 * 3. Else `en`.
 */

import { LOCALE_STORAGE_KEY } from '@/core/i18n';

export const LOCALE_INIT_SCRIPT = `(function(){var KEY=${JSON.stringify(LOCALE_STORAGE_KEY)},SUP={en:1,"zh-CN":1,"zh-TW":1,ja:1,ko:1},loc="";try{var s=localStorage.getItem(KEY);if(s&&SUP[s])loc=s;}catch(e){}if(!loc){var langs=typeof navigator!=="undefined"&&(navigator.languages&&navigator.languages.length?navigator.languages:navigator.language?[navigator.language]:[])||[];for(var i=0;i<langs.length;i++){var raw=langs[i];if(typeof raw!=="string")continue;var parts=raw.trim().replace(/_/g,"-").toLowerCase().split("-").filter(Boolean);var p=parts[0];if(!p)continue;if(p==="zh"){if(parts.indexOf("hans")!==-1){loc="zh-CN";break;}if(parts.indexOf("hant")!==-1||parts.indexOf("tw")!==-1||parts.indexOf("hk")!==-1||parts.indexOf("mo")!==-1){loc="zh-TW";break;}loc="zh-CN";break;}if(p==="ja"){loc="ja";break;}if(p==="ko"){loc="ko";break;}if(p==="en"){loc="en";break;}}}if(!loc)loc="en";var el=typeof document!=="undefined"?document.documentElement:null;if(el){el.lang=loc;el.setAttribute("data-locale",loc);}})();`;
