/**
 * Huly todo tools: list, create, complete.
 *
 * A ToDo (`time:class:ToDo`) is an AttachedDoc owned by a user (Ref<Employee>)
 * and optionally attached to another doc (commonly an issue). It lives in the
 * shared `time:space:ToDos` space.
 */
import { findAll, findOne, genId, now, primarySocialId, tx } from '../client.js';
import { registerTools } from '../server.js';
import type { McpToolDefinition } from '../types.js';
import { err, ok } from '../util.js';

const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2, nopriority: 3, urgent: 4 };

export const listTodos: McpToolDefinition = {
  tool: {
    name: 'huly_list_todos',
    description: "List a user's Huly todos. Pass the user (Employee ref); omit to list open todos you can see.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        user: { type: 'string', description: 'Employee ref (optional)' },
        includeDone: { type: 'boolean', description: 'Include completed todos (default false)' },
        limit: { type: 'number' },
      },
    },
  },
  async handler(args) {
    const query: Record<string, unknown> = {};
    if (args.user) query.user = String(args.user);
    if (!args.includeDone) query.doneOn = null;
    const todos = await findAll<Record<string, unknown>>('time:class:ToDo', query, {
      limit: Number(args.limit ?? 50),
      sort: { rank: 1 },
    });
    const rows = todos.map((t) => ({
      _id: t._id,
      title: t.title,
      done: t.doneOn != null,
      priority: t.priority,
      attachedTo: t.attachedTo,
    }));
    return ok(JSON.stringify(rows, null, 2));
  },
};

export const createTodo: McpToolDefinition = {
  tool: {
    name: 'huly_create_todo',
    description: 'Create a Huly todo for a user, optionally attached to an issue.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        user: { type: 'string', description: 'Employee ref the todo belongs to' },
        attachedTo: { type: 'string', description: 'Issue _id to attach to (optional)' },
        attachedToClass: { type: 'string', description: 'Defaults to tracker:class:Issue when attachedTo is set' },
        priority: { type: 'string', description: 'high|medium|low|nopriority|urgent (default nopriority)' },
      },
      required: ['title', 'user'],
    },
  },
  async handler(args) {
    const title = String(args.title ?? '').trim();
    const user = String(args.user ?? '').trim();
    if (!title) return err('title is required');
    if (!user) return err('user (Employee ref) is required');
    const attachedTo = args.attachedTo ? String(args.attachedTo) : 'time:ids:NoAttached';
    const attachedToClass = args.attachedTo ? String(args.attachedToClass ?? 'tracker:class:Issue') : 'time:class:ToDo';
    const priority = PRIORITY[String(args.priority ?? 'nopriority').toLowerCase()] ?? PRIORITY.nopriority;
    const todoId = genId();
    await tx({
      _class: 'core:class:TxCreateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: todoId,
      objectClass: 'time:class:ToDo',
      objectSpace: 'time:space:ToDos',
      attributes: {
        attachedTo,
        attachedToClass,
        collection: 'todos',
        title,
        description: '',
        user,
        workslots: 0,
        priority,
        visibility: 'public',
        doneOn: null,
        dueDate: null,
        rank: '0|i00000:',
      },
      modifiedBy: await primarySocialId(),
      modifiedOn: now(),
    });
    return ok(`Created todo "${title}" (${todoId})`);
  },
};

export const completeTodo: McpToolDefinition = {
  tool: {
    name: 'huly_complete_todo',
    description: 'Mark a Huly todo done by its _id.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'ToDo _id' } },
      required: ['id'],
    },
  },
  async handler(args) {
    const id = String(args.id ?? '');
    const todo = await findOne<{ _id: string }>('time:class:ToDo', { _id: id });
    if (!todo) return err(`todo not found: ${id}`);
    await tx({
      _class: 'core:class:TxUpdateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: id,
      objectClass: 'time:class:ToDo',
      objectSpace: 'time:space:ToDos',
      operations: { doneOn: now() },
      modifiedBy: await primarySocialId(),
      modifiedOn: now(),
    });
    return ok(`Completed todo ${id}`);
  },
};

registerTools([listTodos, createTodo, completeTodo]);
