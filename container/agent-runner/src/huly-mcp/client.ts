/**
 * Minimal Huly REST client for the bundled Huly MCP.
 *
 * Ports the conventions verified in the `huly` skill (SKILL.md) against our
 * instance: reads go through `find-all`, writes through `tx`
 * (TxCreateDoc / TxUpdateDoc), rich bodies (issue description, doc content)
 * go through the collaborator service — never a plain `tx` string.
 *
 * Config comes from the environment the container is spawned with:
 *   HULY_URL        e.g. https://huly.hz.ledoweb.com
 *   HULY_TOKEN      a scoped-grant JWT for the bot account
 *   HULY_WORKSPACE  workspace UUID
 */

const HULY_URL = (process.env.HULY_URL ?? '').replace(/\/+$/, '');
const HULY_TOKEN = process.env.HULY_TOKEN ?? '';
const HULY_WORKSPACE = process.env.HULY_WORKSPACE ?? '';

const TX_BASE = `${HULY_URL}/_transactor/api/v1`;

export function hulyConfigured(): boolean {
  return HULY_URL !== '' && HULY_TOKEN !== '' && HULY_WORKSPACE !== '';
}

export class HulyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HulyError';
  }
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${HULY_TOKEN}`, 'Content-Type': 'application/json' };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new HulyError(`Huly ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

/** find-all: `.value` is sometimes present, sometimes the array is bare. */
export async function findAll<T = Record<string, unknown>>(
  _class: string,
  query: Record<string, unknown> = {},
  options: Record<string, unknown> = { limit: 50 },
): Promise<T[]> {
  const res = await fetch(`${TX_BASE}/find-all/${HULY_WORKSPACE}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ _class, query, options }),
  });
  const body = (await readBody(res)) as { value?: T[] } | T[] | null;
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.value)) return body.value;
  return [];
}

export async function findOne<T = Record<string, unknown>>(
  _class: string,
  query: Record<string, unknown>,
): Promise<T | null> {
  const rows = await findAll<T>(_class, query, { limit: 1 });
  return rows[0] ?? null;
}

export async function tx(doc: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${TX_BASE}/tx/${HULY_WORKSPACE}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(doc),
  });
  return readBody(res);
}

let cachedSocialId: string | undefined;

/** The bot's primary social id — used for every modifiedBy / createdBy field. */
export async function primarySocialId(): Promise<string> {
  if (cachedSocialId) return cachedSocialId;
  const res = await fetch(`${TX_BASE}/account/${HULY_WORKSPACE}`, { headers: authHeaders() });
  const acct = (await readBody(res)) as { primarySocialId?: string };
  if (!acct?.primarySocialId) throw new HulyError('account has no primarySocialId');
  cachedSocialId = acct.primarySocialId;
  return cachedSocialId;
}

let cachedEmployeeRef: string | undefined;

/**
 * The bot's own Employee ref (a workspace-local Person id), resolved from its
 * primary social id. This is what ToDo.user / Issue.assignee expect — distinct
 * from the social id used in modifiedBy.
 */
export async function botEmployeeRef(): Promise<string | undefined> {
  if (cachedEmployeeRef !== undefined) return cachedEmployeeRef || undefined;
  const socialId = await primarySocialId();
  const identity = await findOne<{ attachedTo?: string }>('contact:class:SocialIdentity', { _id: socialId });
  cachedEmployeeRef = identity?.attachedTo ?? '';
  return cachedEmployeeRef || undefined;
}

export function genId(): string {
  // 24-hex object id, matching Huly's Ref format.
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function now(): number {
  return Date.now();
}

export const workspace = HULY_WORKSPACE;

// ── Collaborator service (rich text bodies) ──────────────────────────────────
let cachedCollaborator: string | undefined;

async function collaboratorUrl(): Promise<string> {
  if (cachedCollaborator) return cachedCollaborator;
  const res = await fetch(`${HULY_URL}/config.json`);
  const cfg = (await readBody(res)) as { COLLABORATOR_URL?: string };
  const raw = cfg?.COLLABORATOR_URL ?? `${HULY_URL}/_collaborator`;
  cachedCollaborator = raw.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return cachedCollaborator;
}

async function collaboratorRpc(
  objectId: string,
  objectClass: string,
  objectAttr: string,
  method: 'createContent' | 'updateContent',
  payload: unknown,
): Promise<{ content?: Record<string, string> }> {
  const base = await collaboratorUrl();
  const docId = `${HULY_WORKSPACE}|${objectClass}|${objectId}|${objectAttr}`;
  const res = await fetch(`${base}/rpc/${encodeURIComponent(docId)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ method, payload }),
  });
  return (await readBody(res)) as { content?: Record<string, string> };
}

/**
 * Write a rich body (issue description, doc content) via the collaborator
 * service, then point the doc's attribute at the returned MarkupBlobRef.
 * `markdownDoc` is a ProseMirror doc object (see markup.ts).
 */
export async function setBody(
  objectId: string,
  objectClass: string,
  objectSpace: string,
  objectAttr: string,
  proseMirrorDoc: unknown,
): Promise<string | undefined> {
  const markup = JSON.stringify(proseMirrorDoc);
  const payload = { content: { [objectAttr]: markup } };
  let ref: string | undefined;
  try {
    const r = await collaboratorRpc(objectId, objectClass, objectAttr, 'createContent', payload);
    ref = r.content?.[objectAttr];
  } catch {
    // createContent rejects when content already exists (the exact status
    // varies), so fall back to updating in place on any create error and keep
    // the existing ref.
    await collaboratorRpc(objectId, objectClass, objectAttr, 'updateContent', payload);
    const existing = await findOne<Record<string, string>>(objectClass, { _id: objectId });
    ref = existing?.[objectAttr];
  }
  if (ref) {
    await tx({
      _class: 'core:class:TxUpdateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId,
      objectClass,
      objectSpace,
      operations: { [objectAttr]: ref },
      modifiedBy: await primarySocialId(),
      modifiedOn: now(),
    });
  }
  return ref;
}
