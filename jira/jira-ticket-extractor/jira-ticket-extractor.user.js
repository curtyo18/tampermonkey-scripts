// ==UserScript==
// @name         Jira Ticket Extractor
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      0.1.0
// @description  Extracts a Jira issue (key, summary, description, acceptance criteria, metadata) as LLM-ready Markdown via the REST API with DOM fallback
// @match        *://*/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/jira/jira-ticket-extractor/jira-ticket-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/jira/jira-ticket-extractor/jira-ticket-extractor.user.js
// ==/UserScript==
"use strict";
(() => {
  // src/detect.ts
  var KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
  function getBaseUrl() {
    return `${location.protocol}//${location.host}`;
  }
  function detectFlavor() {
    if (location.host.endsWith(".atlassian.net")) return "cloud";
    if (document.querySelector("#jira-frontend")) return "cloud";
    return "server";
  }
  function getIssueKey() {
    const browse = location.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
    if (browse) return browse[1];
    const params = new URLSearchParams(location.search);
    for (const p of ["selectedIssue", "issueKey"]) {
      const v = params.get(p);
      if (v && KEY_RE.test(v)) return v.match(KEY_RE)[1];
    }
    const attr = document.querySelector("[data-issue-key]");
    const key = attr?.getAttribute("data-issue-key");
    if (key && KEY_RE.test(key)) return key.match(KEY_RE)[1];
    return null;
  }
  function isJira() {
    if (location.host.endsWith(".atlassian.net")) return true;
    const appName = document.querySelector('meta[name="application-name"]')?.getAttribute("content");
    if (appName && /jira/i.test(appName)) return true;
    if (document.querySelector('meta[name^="ajs-"]')) return true;
    if (document.querySelector("#jira, #jira-frontend")) return true;
    return false;
  }

  // src/api.ts
  async function fetchIssue(key, flavor) {
    const version = flavor === "cloud" ? "3" : "2";
    const url = `/rest/api/${version}/issue/${encodeURIComponent(key)}?expand=${encodeURIComponent("names,renderedFields")}`;
    const resp = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  }
  function discoverAcFieldId(names) {
    for (const [id, label] of Object.entries(names)) {
      if (/acceptance\s*criteria/i.test(label)) return id;
    }
    return null;
  }

  // src/adf.ts
  function applyMarks(text2, marks) {
    if (!marks) return text2;
    let out = text2;
    for (const m of marks) {
      switch (m.type) {
        case "strong":
          out = `**${out}**`;
          break;
        case "em":
          out = `*${out}*`;
          break;
        case "code":
          out = `\`${out}\``;
          break;
        case "strike":
          out = `~~${out}~~`;
          break;
        case "link": {
          const href = m.attrs?.href ?? "";
          out = `[${out}](${href})`;
          break;
        }
        default:
          break;
      }
    }
    return out;
  }
  function renderInline(nodes) {
    if (!nodes) return "";
    return nodes.map(renderNode).join("");
  }
  function renderList(node, ordered) {
    const items = node.content ?? [];
    return items.map((li, i) => {
      const marker = ordered ? `${i + 1}. ` : "- ";
      const body = (li.content ?? []).map(renderNode).join("\n").trim();
      const indented = body.replace(/\n/g, `
${" ".repeat(marker.length)}`);
      return `${marker}${indented}`;
    }).join("\n");
  }
  function renderNode(node) {
    switch (node.type) {
      case "doc":
        return (node.content ?? []).map(renderNode).join("\n\n").trim();
      case "paragraph":
        return renderInline(node.content);
      case "text":
        return applyMarks(node.text ?? "", node.marks);
      case "hardBreak":
        return "\n";
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
        return `${"#".repeat(level)} ${renderInline(node.content)}`;
      }
      case "bulletList":
        return renderList(node, false);
      case "orderedList":
        return renderList(node, true);
      case "listItem":
        return (node.content ?? []).map(renderNode).join("\n");
      case "blockquote":
        return renderInline(node.content).split("\n").map((l) => `> ${l}`).join("\n");
      case "codeBlock": {
        const lang = node.attrs?.language ?? "";
        const code = (node.content ?? []).map((c) => c.text ?? "").join("");
        return `\`\`\`${lang}
${code}
\`\`\``;
      }
      case "rule":
        return "---";
      case "panel":
        return renderInline(node.content);
      case "mention":
        return `@${node.attrs?.text ?? ""}`.replace(/^@@/, "@");
      case "inlineCard":
        return node.attrs?.url ?? "";
      case "table":
        return renderTable(node);
      default:
        return node.content ? node.content.map(renderNode).join("") : node.text ?? "";
    }
  }
  function renderTable(node) {
    const rows = (node.content ?? []).map(
      (row) => (row.content ?? []).map((cell) => renderInline(cell.content).replace(/\n/g, " ").trim())
    );
    if (rows.length === 0) return "";
    const header = rows[0];
    const sep = header.map(() => "---");
    const lines = [header, sep, ...rows.slice(1)].map((cells) => `| ${cells.join(" | ")} |`);
    return lines.join("\n");
  }
  function adfToMarkdown(node) {
    return renderNode(node).trim();
  }

  // src/extract.ts
  function fieldToMarkdown(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "object" && value.type === "doc") {
      return adfToMarkdown(value);
    }
    return "";
  }
  function splitAcceptanceCriteria(md) {
    const lines = md.split("\n");
    const startIdx = lines.findIndex((l) => /^#{1,6}\s*acceptance\s*criteria\b/i.test(l));
    if (startIdx === -1) return { description: md.trim(), acceptanceCriteria: null };
    const headingLevel = lines[startIdx].match(/^#+/)?.[0].length ?? 1;
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s/);
      if (m && m[1].length <= headingLevel) {
        endIdx = i;
        break;
      }
    }
    const acceptanceCriteria = lines.slice(startIdx + 1, endIdx).join("\n").trim();
    const description = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { description, acceptanceCriteria: acceptanceCriteria || null };
  }
  function mapLinks(raw) {
    const out = [];
    for (const l of raw.fields.issuelinks ?? []) {
      if (l.outwardIssue) {
        out.push({
          type: l.type?.outward ?? "relates to",
          key: l.outwardIssue.key ?? "",
          summary: l.outwardIssue.fields?.summary ?? ""
        });
      }
      if (l.inwardIssue) {
        out.push({
          type: l.type?.inward ?? "relates to",
          key: l.inwardIssue.key ?? "",
          summary: l.inwardIssue.fields?.summary ?? ""
        });
      }
    }
    if (raw.fields.parent?.key) {
      out.push({
        type: "parent",
        key: raw.fields.parent.key,
        summary: raw.fields.parent.fields?.summary ?? ""
      });
    }
    for (const st of raw.fields.subtasks ?? []) {
      if (st.key) out.push({ type: "subtask", key: st.key, summary: st.fields?.summary ?? "" });
    }
    return out;
  }
  function fromApi(raw, _flavor, baseUrl) {
    const f = raw.fields;
    const rawDescription = fieldToMarkdown(f.description);
    let description = rawDescription;
    let acceptanceCriteria = null;
    const acFieldId = raw.names ? discoverAcFieldId(raw.names) : null;
    if (acFieldId && f[acFieldId] != null) {
      const acMd = fieldToMarkdown(f[acFieldId]);
      if (acMd) acceptanceCriteria = acMd;
    }
    if (!acceptanceCriteria) {
      const split = splitAcceptanceCriteria(rawDescription);
      description = split.description;
      acceptanceCriteria = split.acceptanceCriteria;
    }
    return {
      key: raw.key,
      url: `${baseUrl}/browse/${raw.key}`,
      summary: f.summary ?? "",
      type: f.issuetype?.name ?? "",
      status: f.status?.name ?? "",
      priority: f.priority?.name ?? null,
      assignee: f.assignee?.displayName ?? null,
      reporter: f.reporter?.displayName ?? null,
      labels: f.labels ?? [],
      components: (f.components ?? []).map((c) => c.name ?? "").filter(Boolean),
      description,
      acceptanceCriteria,
      links: mapLinks(raw),
      attachments: (f.attachment ?? []).map((a) => a.filename ?? "").filter(Boolean),
      source: "api"
    };
  }

  // src/scrape.ts
  function text(sel) {
    return document.querySelector(sel)?.textContent?.trim() ?? "";
  }
  function domToMarkdown(root) {
    if (!root) return "";
    const out = [];
    root.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const s = node.textContent?.trim();
        if (s) out.push(s);
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName.toLowerCase();
      const content = node.textContent?.trim() ?? "";
      if (!content) return;
      if (/^h[1-6]$/.test(tag)) {
        out.push(`${"#".repeat(Number(tag[1]))} ${content}`);
      } else if (tag === "ul" || tag === "ol") {
        node.querySelectorAll("li").forEach((li, i) => {
          const marker = tag === "ol" ? `${i + 1}.` : "-";
          out.push(`${marker} ${li.textContent?.trim() ?? ""}`);
        });
      } else if (tag === "pre") {
        out.push("```\n" + content + "\n```");
      } else {
        out.push(content);
      }
    });
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function fromDom() {
    const key = getIssueKey();
    if (!key) return null;
    const summary = text('[data-testid="issue.views.issue-base.foundation.summary.heading"]') || text("#summary-val") || text("h1");
    const descRoot = document.querySelector('[data-testid="issue.views.field.rich-text.description"]') || document.querySelector("#description-val .user-content-block") || document.querySelector("#descriptionmodule .mod-content");
    const rawDescription = domToMarkdown(descRoot);
    const { description, acceptanceCriteria } = splitAcceptanceCriteria(rawDescription);
    return {
      key,
      url: `${getBaseUrl()}/browse/${key}`,
      summary,
      type: text("#type-val") || text('[data-testid$="issue-type.name"]'),
      status: text('[data-testid$="status-field.status-view"]') || text("#status-val"),
      priority: text("#priority-val") || null,
      assignee: text('[data-testid$="assignee.assignee"]') || text("#assignee-val") || null,
      reporter: text("#reporter-val") || null,
      labels: Array.from(document.querySelectorAll('#labels-val .lozenge, [data-testid$="labels.label"]')).map((el) => el.textContent?.trim() ?? "").filter(Boolean),
      components: Array.from(document.querySelectorAll("#components-val .item")).map((el) => el.textContent?.trim() ?? "").filter(Boolean),
      description,
      acceptanceCriteria,
      links: [],
      attachments: [],
      source: "dom"
    };
  }

  // src/format.ts
  var VERSION = "0.1.0";
  function metaLine(pairs) {
    return pairs.filter(([, v]) => v && v.length > 0).map(([k, v]) => `**${k}:** ${v}`).join("   ");
  }
  function toMarkdown(t) {
    const parts = [];
    parts.push(`# [${t.key}] ${t.summary}`.trim());
    const line1 = metaLine([
      ["Type", t.type],
      ["Status", t.status],
      ["Priority", t.priority]
    ]);
    const line2 = metaLine([
      ["Labels", t.labels.length ? t.labels.join(", ") : null],
      ["Components", t.components.length ? t.components.join(", ") : null]
    ]);
    const metaBlock = [line1, line2, `**URL:** ${t.url}`].filter(Boolean).map((l) => `- ${l}`).join("\n");
    parts.push(metaBlock);
    if (t.description) parts.push(`## Description
${t.description}`);
    if (t.acceptanceCriteria) parts.push(`## Acceptance Criteria
${t.acceptanceCriteria}`);
    if (t.links.length) {
      const links = t.links.map((l) => `- ${l.type} ${l.key} \u2014 ${l.summary}`.trim()).join("\n");
      parts.push(`## Links
${links}`);
    }
    if (t.attachments.length) {
      parts.push(`## Attachments
${t.attachments.map((a) => `- ${a}`).join("\n")}`);
    }
    parts.push(`<!-- extracted via ${t.source} by jira-ticket-extractor v${VERSION} -->`);
    return parts.join("\n\n");
  }

  // src/ui.ts
  var STYLE_ID = "tm-jte-styles";
  var TRIGGER_ID = "tm-jte-trigger";
  var PANEL_ID = "tm-jte-panel";
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    #${TRIGGER_ID} { position: fixed; bottom: 16px; right: 16px; z-index: 2147483000;
      background: #0052cc; color: #fff; border: none; border-radius: 6px;
      padding: 8px 12px; font: 500 13px/1 sans-serif; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
    #${TRIGGER_ID}:hover { background: #0747a6; }
    #${PANEL_ID} { position: fixed; bottom: 60px; right: 16px; z-index: 2147483000;
      width: min(520px, 90vw); max-height: 70vh; overflow: auto; background: #1d2125; color: #c7d1db;
      border: 1px solid #333; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.5); font: 13px/1.5 sans-serif; }
    #${PANEL_ID} header { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid #333; position: sticky; top: 0; background: #1d2125; }
    #${PANEL_ID} header .badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #333; }
    #${PANEL_ID} header .spacer { flex: 1; }
    #${PANEL_ID} button { background: #0052cc; color: #fff; border: none; border-radius: 4px;
      padding: 5px 10px; cursor: pointer; font-size: 12px; }
    #${PANEL_ID} button.close { background: transparent; color: #8993a4; font-size: 16px; padding: 0 4px; }
    #${PANEL_ID} pre { margin: 0; padding: 12px; white-space: pre-wrap; word-break: break-word; }
    #tm-jte-toast { position: fixed; bottom: 60px; right: 16px; z-index: 2147483001;
      background: #216e4e; color: #fff; padding: 8px 12px; border-radius: 6px; font: 13px sans-serif; }
  `;
    document.head.appendChild(style);
  }
  function toast(msg) {
    const el = document.createElement("div");
    el.id = "tm-jte-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2e3);
  }
  async function copyText(text2) {
    try {
      await navigator.clipboard.writeText(text2);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text2;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }
  function showPanel(markdown, source) {
    document.getElementById(PANEL_ID)?.remove();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    const header = document.createElement("header");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `source: ${source}`;
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy Markdown";
    copyBtn.onclick = async () => {
      const ok = await copyText(markdown);
      toast(ok ? "Copied to clipboard" : "Copy failed \u2014 select manually");
    };
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.textContent = "\xD7";
    closeBtn.onclick = () => panel.remove();
    header.append(badge, spacer, copyBtn, closeBtn);
    const pre = document.createElement("pre");
    pre.textContent = markdown;
    panel.append(header, pre);
    document.body.appendChild(panel);
  }
  function createTrigger(onClick) {
    injectStyles();
    let btn = document.getElementById(TRIGGER_ID);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = TRIGGER_ID;
      btn.textContent = "Extract ticket";
      btn.onclick = onClick;
      document.body.appendChild(btn);
    }
    return {
      show: () => {
        btn.style.display = "block";
      },
      hide: () => {
        btn.style.display = "none";
        document.getElementById(PANEL_ID)?.remove();
      }
    };
  }

  // src/main.ts
  if (isJira()) {
    let sync = function() {
      if (getIssueKey()) trigger.show();
      else trigger.hide();
    }, onNav = function() {
      clearTimeout(debounce);
      debounce = setTimeout(sync, 300);
    };
    sync2 = sync, onNav2 = onNav;
    const trigger = createTrigger(onExtract);
    async function onExtract() {
      const key = getIssueKey();
      if (!key) return;
      const flavor = detectFlavor();
      const base = getBaseUrl();
      try {
        const raw = await fetchIssue(key, flavor);
        const ticket = fromApi(raw, flavor, base);
        showPanel(toMarkdown(ticket), "api");
      } catch (err) {
        console.warn("[jira-extractor] API fetch failed, falling back to DOM:", err);
        const ticket = fromDom();
        if (!ticket || !ticket.summary) {
          showPanel("Couldn't read this ticket (API blocked and DOM scrape empty).", "dom");
          return;
        }
        showPanel(toMarkdown(ticket), "dom");
      }
    }
    (function patchHistory(h) {
      const fire = () => {
        window.dispatchEvent(new Event("jte-nav"));
      };
      const ps = h.pushState.bind(h);
      const rs = h.replaceState.bind(h);
      h.pushState = function(...a) {
        const r = ps(...a);
        fire();
        return r;
      };
      h.replaceState = function(...a) {
        const r = rs(...a);
        fire();
        return r;
      };
      window.addEventListener("popstate", fire);
    })(window.history);
    let debounce;
    window.addEventListener("jte-nav", onNav);
    sync();
  }
  var sync2;
  var onNav2;
})();
