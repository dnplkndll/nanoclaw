/**
 * Huly member/identity tools: whoami and list_members.
 *
 * Issue assignees and todo owners are Employee refs (workspace-local Person
 * ids). These tools let an agent discover valid refs and its own identity.
 */
import { botEmployeeRef, findAll, primarySocialId } from '../client.js';
import { registerTools } from '../server.js';
import type { McpToolDefinition } from '../types.js';
import { ok } from '../util.js';

export const whoami: McpToolDefinition = {
  tool: {
    name: 'huly_whoami',
    description: "Return the bot's own Huly identity: its Employee ref (for assignee/todo user) and social id.",
    inputSchema: { type: 'object' as const, properties: {} },
  },
  async handler() {
    return ok(
      JSON.stringify({ employeeRef: (await botEmployeeRef()) ?? null, socialId: await primarySocialId() }, null, 2),
    );
  },
};

export const listMembers: McpToolDefinition = {
  tool: {
    name: 'huly_list_members',
    description: 'List workspace members (Employees). Returns name and ref for use as an assignee or todo user.',
    inputSchema: { type: 'object' as const, properties: { limit: { type: 'number' } } },
  },
  async handler(args) {
    const people = await findAll<{ _id: string; name?: string }>(
      'contact:mixin:Employee',
      {},
      { limit: Number((args as { limit?: number }).limit ?? 200) },
    );
    return ok(
      JSON.stringify(
        people.map((p) => ({ ref: p._id, name: p.name })),
        null,
        2,
      ),
    );
  },
};

registerTools([whoami, listMembers]);
