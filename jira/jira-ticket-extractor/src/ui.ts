const STYLE_ID = 'tm-jte-styles';
const TRIGGER_ID = 'tm-jte-trigger';
const PANEL_ID = 'tm-jte-panel';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
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

export interface TriggerHandle {
  show(): void;
  hide(): void;
}

function toast(msg: string): void {
  const el = document.createElement('div');
  el.id = 'tm-jte-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function showPanel(markdown: string, source: 'api' | 'dom'): void {
  document.getElementById(PANEL_ID)?.remove();
  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  const header = document.createElement('header');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = `source: ${source}`;
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Markdown';
  copyBtn.onclick = async () => {
    const ok = await copyText(markdown);
    toast(ok ? 'Copied to clipboard' : 'Copy failed — select manually');
  };
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => panel.remove();

  header.append(badge, spacer, copyBtn, closeBtn);

  const pre = document.createElement('pre');
  pre.textContent = markdown;

  panel.append(header, pre);
  document.body.appendChild(panel);
}

export function createTrigger(onClick: () => void): TriggerHandle {
  injectStyles();
  let btn = document.getElementById(TRIGGER_ID) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = TRIGGER_ID;
    btn.textContent = 'Extract ticket';
    btn.onclick = onClick;
    document.body.appendChild(btn);
  }
  return {
    show: () => { btn!.style.display = 'block'; },
    hide: () => { btn!.style.display = 'none'; document.getElementById(PANEL_ID)?.remove(); },
  };
}
