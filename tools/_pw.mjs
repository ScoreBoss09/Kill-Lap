// Shared Playwright loader for the dev tools: uses a local install if present, else the global one.
let mod; try { mod = await import('playwright'); } catch { mod = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
export const chromium = mod.chromium;
