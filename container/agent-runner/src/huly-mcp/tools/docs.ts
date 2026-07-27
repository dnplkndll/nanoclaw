/**
 * Huly document tools: list and create wiki documents.
 *
 * A `document:class:Document` lives in a Teamspace (`document:class:Teamspace`).
 * Its body (`content`) is a MarkupBlobRef written through the collaborator
 * service, exactly like an issue description.
 */
import { findAll, findOne, genId, now, primarySocialId, setBody, tx } from '../client.js';
import { markdownToProseMirror } from '../markup.js';
import { registerTools } from '../server.js';
import type { McpToolDefinition } from '../types.js';
import { err, ok } from '../util.js';

async function resolveTeamspace(idOrName: string): Promise<{ _id: string } | null> {
  const byId = await findOne<{ _id: string }>('document:class:Teamspace', { _id: idOrName });
  if (byId) return byId;
  return findOne<{ _id: string }>('document:class:Teamspace', { name: idOrName });
}

export const listDocuments: McpToolDefinition = {
  tool: {
    name: 'huly_list_documents',
    description: 'List documents in a Huly teamspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        teamspace: { type: 'string', description: 'Teamspace _id or name' },
        limit: { type: 'number' },
      },
      required: ['teamspace'],
    },
  },
  async handler(args) {
    const ts = await resolveTeamspace(String(args.teamspace ?? ''));
    if (!ts) return err(`teamspace not found: ${String(args.teamspace)}`);
    const docs = await findAll<Record<string, unknown>>(
      'document:class:Document',
      { space: ts._id },
      { limit: Number(args.limit ?? 100), sort: { rank: 1 } },
    );
    return ok(
      JSON.stringify(
        docs.map((d) => ({ _id: d._id, title: d.title })),
        null,
        2,
      ),
    );
  },
};

export const createDocument: McpToolDefinition = {
  tool: {
    name: 'huly_create_document',
    description: 'Create a Huly wiki document in a teamspace, with optional markdown body.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        teamspace: { type: 'string', description: 'Teamspace _id or name' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown body (optional)' },
      },
      required: ['teamspace', 'title'],
    },
  },
  async handler(args) {
    const ts = await resolveTeamspace(String(args.teamspace ?? ''));
    if (!ts) return err(`teamspace not found: ${String(args.teamspace)}`);
    const title = String(args.title ?? '').trim();
    if (!title) return err('title is required');
    const docId = genId();
    await tx({
      _class: 'core:class:TxCreateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: docId,
      objectClass: 'document:class:Document',
      objectSpace: ts._id,
      attributes: {
        title,
        content: null,
        parent: 'document:ids:NoParent',
        rank: '0|i00000:',
        snapshots: 0,
        attachments: 0,
        comments: 0,
        embeddings: 0,
        labels: 0,
        references: 0,
      },
      modifiedBy: await primarySocialId(),
      modifiedOn: now(),
    });
    const body = String(args.content ?? '').trim();
    if (body) {
      await setBody(docId, 'document:class:Document', ts._id, 'content', markdownToProseMirror(body));
    }
    return ok(`Created document "${title}" (${docId})`);
  },
};

registerTools([listDocuments, createDocument]);
