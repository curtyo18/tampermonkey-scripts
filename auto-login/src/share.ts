import { isAccount } from './storage';
import { newId, type AccountConfig } from './types';

export const SHARE_PREFIX = 'AL1:';
/** Fallback for environments without CompressionStream. */
export const SHARE_PREFIX_RAW = 'AL1U:';

export type MergeAction = 'skip' | 'overwrite' | 'keep-both';
export type MergeStatus = 'new' | 'conflict-id' | 'conflict-name';

export interface MergePlanEntry {
  incoming: AccountConfig;
  status: MergeStatus;
  existing: AccountConfig | null;
  action: MergeAction;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Streams are built by hand rather than via `new Blob([bytes]).stream()`.
 * jsdom ships a Blob without `.stream()` while still exposing
 * CompressionStream, so the Blob route picks the compression path and then
 * dies on its own dependency. This depends on nothing but the streams API,
 * which both the browser and the test environment have.
 *
 * Yields BufferSource rather than Uint8Array because CompressionStream's
 * writable side is typed WritableStream<BufferSource>, and pipeThrough is
 * invariant in that position.
 */
function toStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return collect(toStream(bytes).pipeThrough(new CompressionStream('deflate-raw')));
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return collect(toStream(bytes).pipeThrough(new DecompressionStream('deflate-raw')));
}

/**
 * Encode the full config set as one pasteable line. This ALWAYS includes
 * credentials in recoverable form — base64 and deflate are encodings, not
 * encryption. See docs/adr/0003; callers must confirm before exposing this.
 */
export async function encodeShare(accounts: AccountConfig[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(accounts));
  if (typeof CompressionStream === 'undefined') {
    return SHARE_PREFIX_RAW + toBase64Url(json);
  }
  return SHARE_PREFIX + toBase64Url(await deflate(json));
}

export async function decodeShare(text: string): Promise<AccountConfig[]> {
  const trimmed = text.trim();
  const compressed = trimmed.startsWith(SHARE_PREFIX);
  const raw = trimmed.startsWith(SHARE_PREFIX_RAW);

  if (!compressed && !raw) {
    throw new Error('That is not an Auto Login share string.');
  }

  try {
    const body = trimmed.slice((raw ? SHARE_PREFIX_RAW : SHARE_PREFIX).length);
    const bytes = fromBase64Url(body);
    const json = new TextDecoder().decode(raw ? bytes : await inflate(bytes));
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error('not an array');

    // A share string comes from someone else's install — the one genuinely
    // untrusted input in the product. Hold it to the same structural bar as
    // anything read back from storage rather than casting and hoping.
    if (!parsed.every(isAccount)) throw new Error('malformed account');
    return parsed;
  } catch {
    throw new Error('That share string could not be decoded — it may be truncated or malformed.');
  }
}

/**
 * Classify each incoming account against what is already stored. Pure: builds
 * the plan the import preview renders, and writes nothing.
 */
export function buildMergePlan(
  incoming: AccountConfig[],
  existing: AccountConfig[],
): MergePlanEntry[] {
  return incoming.map((account) => {
    const byId = existing.find((e) => e.id === account.id);
    if (byId) return { incoming: account, status: 'conflict-id', existing: byId, action: 'keep-both' };

    const byName = existing.find((e) => e.name === account.name);
    if (byName) return { incoming: account, status: 'conflict-name', existing: byName, action: 'keep-both' };

    return { incoming: account, status: 'new', existing: null, action: 'overwrite' };
  });
}

export function applyMergePlan(
  plan: MergePlanEntry[],
  existing: AccountConfig[],
): AccountConfig[] {
  const result = [...existing];

  for (const entry of plan) {
    if (entry.action === 'skip') continue;

    if (entry.action === 'keep-both') {
      result.push({
        ...entry.incoming,
        id: newId(),
        name: `${entry.incoming.name} (imported)`,
        updatedAt: Date.now(),
      });
      continue;
    }

    const index = entry.existing ? result.findIndex((a) => a.id === entry.existing!.id) : -1;
    if (index >= 0) result[index] = { ...entry.incoming, updatedAt: Date.now() };
    else result.push(entry.incoming);
  }

  return result;
}
