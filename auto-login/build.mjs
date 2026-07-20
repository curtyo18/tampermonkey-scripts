import { build } from 'esbuild';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const meta = `// ==UserScript==
// @name         Auto Login
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      ${version}
// @description  One-click credential fill for login pages you configure through an injected UI. Dev/test accounts only.
// @author       Curt Radford
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/auto-login/auto-login.user.js
// @downloadURL  https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/auto-login/auto-login.user.js
// ==/UserScript==`;

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'auto-login.user.js',
  format: 'iife',
  banner: { js: meta },
  target: 'es2020',
  logLevel: 'info',
});
