/**
 * Huly channel — reach an agent from a Huly chat channel.
 *
 * Huly's REST API has no push/webhook, so this adapter POLLS the chunter
 * channels the bot account is a member of. New messages (not authored by the
 * bot) are routed inbound; agent replies are posted back as chunter
 * ChatMessages. Our instance uses legacy chunter chat (channels are
 * `chunter:class:Channel`, messages `chunter:class:ChatMessage`), which is
 * fully read/writable over plain `find-all` + `tx` — no blob fetch needed.
 *
 * Config (from `.env`, read WITHOUT loading into process.env):
 *   HULY_URL, HULY_TOKEN, HULY_WORKSPACE
 *
 * A high-water mark per channel is persisted under DATA_DIR so a restart
 * neither replays history nor drops messages sent while down.
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, InboundMessage, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';

const POLL_INTERVAL_MS = 12_000;

/**
 * Group chat: engage only when the bot is @-mentioned. DMs (rare in Huly, but
 * possible) engage on everything. Mentions are platform-signalled.
 */
const HULY_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  group: { engageMode: 'mention', threads: false, unknownSenderPolicy: 'request_approval' },
  mentions: 'platform',
};

interface HulyConfig {
  url: string;
  token: string;
  workspace: string;
}

function readConfig(): HulyConfig | null {
  const env = readEnvFile(['HULY_URL', 'HULY_TOKEN', 'HULY_WORKSPACE']);
  if (!env.HULY_URL || !env.HULY_TOKEN || !env.HULY_WORKSPACE) return null;
  return { url: env.HULY_URL.replace(/\/+$/, ''), token: env.HULY_TOKEN, workspace: env.HULY_WORKSPACE };
}

interface ChatMessage {
  _id: string;
  space: string;
  message: string; // JSON-encoded ProseMirror
  createdOn?: number;
  modifiedOn?: number;
  createdBy?: string;
  modifiedBy?: string;
}

function highWaterPath(): string {
  return path.join(DATA_DIR, 'huly-highwater.json');
}

function loadHighWater(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(highWaterPath(), 'utf-8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveHighWater(hw: Record<string, number>): void {
  try {
    fs.writeFileSync(highWaterPath(), JSON.stringify(hw));
  } catch (err) {
    log.warn('Failed to persist Huly high-water mark', { err });
  }
}

export function plainText(prosemirror: string): string {
  // Best-effort flatten of a ProseMirror doc to text for the agent.
  try {
    const doc = JSON.parse(prosemirror);
    const parts: string[] = [];
    const walk = (n: unknown): void => {
      if (n == null || typeof n !== 'object') return;
      const node = n as Record<string, unknown>;
      if (typeof node.text === 'string') parts.push(node.text);
      if (node.type === 'reference' && node.attrs && typeof node.attrs === 'object') {
        const label = (node.attrs as Record<string, unknown>).label;
        if (typeof label === 'string') parts.push(`@${label}`);
      }
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(doc);
    return parts.join('').trim();
  } catch {
    return prosemirror;
  }
}

interface PollMessage {
  _id: string;
  createdOn?: number;
  createdBy?: string;
  modifiedBy?: string;
}

/**
 * Pure selection of messages to route inbound: newer than the mark and not
 * authored by the bot, oldest first. Extracted so the echo-loop guard is
 * unit-testable without a live server.
 */
export function selectFresh<T extends PollMessage>(msgs: T[], mark: number, botSocialId: string): T[] {
  return msgs
    .filter((m) => (m.createdOn ?? 0) > mark)
    .filter((m) => (m.createdBy ?? m.modifiedBy) !== botSocialId)
    .sort((a, b) => (a.createdOn ?? 0) - (b.createdOn ?? 0));
}

/**
 * True when the message's ProseMirror markup @-mentions the bot. Huly mentions
 * are `reference` nodes whose `id` attr is the mentioned Person's _id, so we
 * match against the bot's Person ref (NOT its account uuid, which never
 * appears in the markup).
 */
export function mentionsBot(messageJson: string, botPersonRef: string): boolean {
  if (!botPersonRef) return false;
  try {
    let hit = false;
    const walk = (n: unknown): void => {
      if (hit || n == null || typeof n !== 'object') return;
      const node = n as Record<string, unknown>;
      if (node.type === 'reference' && node.attrs && typeof node.attrs === 'object') {
        if ((node.attrs as Record<string, unknown>).id === botPersonRef) hit = true;
      }
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(JSON.parse(messageJson));
    return hit;
  } catch {
    return false;
  }
}

function createAdapter(cfg: HulyConfig): ChannelAdapter {
  const txBase = `${cfg.url}/_transactor/api/v1`;
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let botPersonRef = '';
  let botSocialId = '';
  const highWater = loadHighWater();

  async function post(endpoint: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${txBase}/${endpoint}/${cfg.workspace}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Huly ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  async function get(endpoint: string): Promise<unknown> {
    const res = await fetch(`${txBase}/${endpoint}/${cfg.workspace}`, { headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`Huly ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  async function findAll<T>(
    _class: string,
    query: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<T[]> {
    const body = (await post('find-all', { _class, query, options })) as { value?: T[] } | T[] | null;
    if (Array.isArray(body)) return body;
    if (body && Array.isArray((body as { value?: T[] }).value)) return (body as { value: T[] }).value;
    return [];
  }

  function genId(): string {
    let s = '';
    for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  async function pollOnce(config: ChannelSetup): Promise<void> {
    // Reentrancy guard: a slow poll must not overlap the next interval tick,
    // or both would emit the same messages and race the high-water map.
    if (polling) return;
    polling = true;
    try {
      const channels = await findAll<{ _id: string; name?: string }>('chunter:class:Channel', {}, { limit: 100 });
      for (const ch of channels) {
        const msgs = await findAll<ChatMessage>(
          'chunter:class:ChatMessage',
          { space: ch._id },
          { limit: 20, sort: { createdOn: -1 } },
        );
        // Seed the mark on first sight so we don't replay history.
        if (highWater[ch._id] === undefined) {
          highWater[ch._id] = msgs.reduce((max, m) => Math.max(max, m.createdOn ?? 0), 0);
          if (ch.name) config.onMetadata(`huly:${ch._id}`, ch.name, true);
          continue;
        }
        for (const m of selectFresh(msgs, highWater[ch._id], botSocialId)) {
          const inbound: InboundMessage = {
            id: m._id,
            kind: 'chat',
            content: { text: plainText(m.message), from: m.createdBy ?? m.modifiedBy, channel: ch.name ?? ch._id },
            timestamp: new Date(m.createdOn ?? Date.now()).toISOString(),
            isMention: mentionsBot(m.message, botPersonRef),
            isGroup: true,
          };
          await config.onInbound(`huly:${ch._id}`, null, inbound);
          highWater[ch._id] = Math.max(highWater[ch._id], m.createdOn ?? 0);
        }
      }
      saveHighWater(highWater);
    } finally {
      polling = false;
    }
  }

  const adapter: ChannelAdapter = {
    name: 'huly',
    channelType: 'huly',
    supportsThreads: false,
    defaults: HULY_DEFAULTS,

    async setup(config: ChannelSetup): Promise<void> {
      const acct = (await get('account')) as { uuid?: string; primarySocialId?: string };
      botSocialId = acct?.primarySocialId ?? '';
      // Fail hard rather than default to '': an empty social id would make the
      // echo filter admit the bot's own replies, causing an infinite loop.
      if (!botSocialId) throw new Error('Huly account has no primarySocialId; refusing to start channel');
      // Resolve the bot's Person ref (mentions reference the Person _id).
      const identity = (
        await findAll<{ attachedTo?: string }>('contact:class:SocialIdentity', { _id: botSocialId }, { limit: 1 })
      )[0];
      botPersonRef = identity?.attachedTo ?? '';
      log.info('Huly channel connected', { workspace: cfg.workspace, botPersonRef });
      // Prime high-water marks without emitting, then poll on an interval.
      await pollOnce(config).catch((err) => log.warn('Huly initial poll failed', { err }));
      timer = setInterval(() => {
        pollOnce(config).catch((err) => log.warn('Huly poll failed', { err }));
      }, POLL_INTERVAL_MS);
    },

    async teardown(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = null;
      saveHighWater(highWater);
    },

    isConnected(): boolean {
      return timer !== null;
    },

    async deliver(platformId, _threadId, message: OutboundMessage): Promise<string | undefined> {
      if (!platformId.startsWith('huly:')) return undefined;
      const channelId = platformId.slice('huly:'.length);
      const text = extractText(message);
      if (!text) return undefined;
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
      const msgId = genId();
      await post('tx', {
        _class: 'core:class:TxCreateDoc',
        _id: genId(),
        space: 'core:space:Tx',
        objectId: msgId,
        objectClass: 'chunter:class:ChatMessage',
        objectSpace: channelId,
        attributes: {
          attachedTo: channelId,
          attachedToClass: 'chunter:class:Channel',
          collection: 'messages',
          message: JSON.stringify(doc),
          attachments: 0,
        },
        modifiedBy: botSocialId,
        modifiedOn: Date.now(),
      });
      // The bot's own reply is excluded from the next poll by the author filter
      // (createdBy === botSocialId) in selectFresh — no high-water bump needed,
      // which also avoids dropping a user message posted in the same window.
      return msgId;
    },
  };

  return adapter;
}

function extractText(message: OutboundMessage): string | null {
  const content = message.content as Record<string, unknown> | string | undefined;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    if (typeof content.markdown === 'string') return content.markdown;
    if (typeof content.text === 'string') return content.text;
  }
  return null;
}

registerChannelAdapter('huly', {
  factory: () => {
    const cfg = readConfig();
    if (!cfg) return null; // credentials missing → skipped by initChannelAdapters
    return createAdapter(cfg);
  },
  defaults: HULY_DEFAULTS,
});
