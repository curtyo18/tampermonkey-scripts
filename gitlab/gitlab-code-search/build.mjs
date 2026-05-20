import { build } from 'esbuild';

const meta = `// ==UserScript==
// @name         GitLab Code Search+
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      1.0.0
// @description  Augments GitLab search with filter UI, full pagination, and export
// @match        *://*/-/search*
// @match        *://*/*/-/search*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/gitlab/gitlab-code-search/gitlab-code-search.user.js
// @downloadURL  https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/gitlab/gitlab-code-search/gitlab-code-search.user.js
// ==/UserScript==`;

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'gitlab-code-search.user.js',
  format: 'iife',
  banner: { js: meta },
  target: 'es2020',
  logLevel: 'info',
});
