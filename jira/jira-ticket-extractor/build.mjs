import { build } from 'esbuild';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const meta = `// ==UserScript==
// @name         Jira Ticket Extractor
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      ${version}
// @description  Extracts a Jira issue (key, summary, description, acceptance criteria, metadata) as LLM-ready Markdown via the REST API with DOM fallback
// @match        *://*/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/jira/jira-ticket-extractor/jira-ticket-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/jira/jira-ticket-extractor/jira-ticket-extractor.user.js
// ==/UserScript==`;

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'jira-ticket-extractor.user.js',
  format: 'iife',
  banner: { js: meta },
  target: 'es2020',
  logLevel: 'info',
});
