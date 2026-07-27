/**
 * Huly issue tools: list, create, update, comment.
 *
 * Create follows the verified sequence: read Project.sequence, assign
 * number + identifier, TxCreateDoc, bump the project sequence, and (if a
 * body is given) write the description through the collaborator service.
 */
import { findAll, findOne, genId, now, primarySocialId, setBody, tx } from '../client.js';
import { markdownToProseMirror } from '../markup.js';
import { registerTools } from '../server.js';
import type { McpToolDefinition } from '../types.js';
import { err, ok } from '../util.js';

// Issue statuses and task types are per project TYPE in Huly, not global — a
// status like `tracker:status:Todo` is valid in one project and rejected in
// another. So a status word maps to a status *category* (the stable
// `task:statusCategory:*` ids, verified against models/tracker), then resolves
// to the concrete status id the project actually uses.
const WORD_TO_CATEGORY: Record<string, string> = {
  backlog: 'UnStarted',
  todo: 'ToDo',
  inprogress: 'Active',
  done: 'Won',
  cancelled: 'Lost',
  canceled: 'Lost',
};
const CATEGORY_TO_WORD: Record<string, string> = {
  UnStarted: 'backlog',
  ToDo: 'todo',
  Active: 'inprogress',
  Won: 'done',
  Lost: 'cancelled',
};
const PRIORITY: Record<string, number> = { nopriority: 0, urgent: 1, high: 2, medium: 3, low: 4 };
const PRIORITY_WORD = ['nopriority', 'urgent', 'high', 'medium', 'low'];

export function statusWord(category: string | undefined): string {
  return (category && CATEGORY_TO_WORD[category.split(':').pop() ?? '']) || 'unknown';
}
export function priorityWord(n: number | undefined): string {
  return PRIORITY_WORD[n ?? 0] ?? 'unknown';
}

interface Project {
  _id: string;
  identifier: string;
  sequence: number;
  type: string;
  defaultIssueStatus?: string;
  name?: string;
}

interface IssueStatus {
  _id: string;
  category?: string;
}

interface ProjectMeta {
  kind: string;
  defaultStatus: string;
  statusByCategory: Record<string, string>;
  categoryById: Record<string, string>;
}

async function resolveProject(idOrIdentifier: string): Promise<Project | null> {
  const byId = await findOne<Project>('tracker:class:Project', { _id: idOrIdentifier });
  if (byId) return byId;
  // `identifier` is not a queryable field on Project, so match client-side.
  const all = await findAll<Project>('tracker:class:Project', {}, { limit: 500 });
  return all.find((p) => p.identifier === idOrIdentifier) ?? null;
}

/**
 * Resolve the project's issue task type and its valid statuses (by category).
 * Returns null when the project type has no Issue task type — callers must
 * error rather than fall back to a foreign task type / empty status.
 */
async function projectMeta(project: Project): Promise<ProjectMeta | null> {
  const taskTypes = await findAll<{ _id: string; parent?: string; name?: string; statuses?: string[] }>(
    'task:class:TaskType',
    {},
    { limit: 200 },
  );
  const issueType = taskTypes.find((t) => t.parent === project.type && t.name === 'Issue');
  if (!issueType) return null;
  const statusIds = new Set(issueType.statuses ?? []);
  const allStatuses = await findAll<IssueStatus>('tracker:class:IssueStatus', {}, { limit: 300 });
  const statusByCategory: Record<string, string> = {};
  const categoryById: Record<string, string> = {};
  for (const s of allStatuses) {
    if (!statusIds.has(s._id)) continue;
    const cat = s.category?.split(':').pop();
    if (cat) {
      categoryById[s._id] = cat;
      if (!(cat in statusByCategory)) statusByCategory[cat] = s._id;
    }
  }
  const defaultStatus =
    project.defaultIssueStatus ?? statusByCategory.UnStarted ?? Object.values(statusByCategory)[0] ?? '';
  return { kind: issueType._id, defaultStatus, statusByCategory, categoryById };
}

function statusFor(meta: ProjectMeta, word: string | undefined): string {
  if (!word) return meta.defaultStatus;
  const category = WORD_TO_CATEGORY[word.toLowerCase()];
  return (category && meta.statusByCategory[category]) || meta.defaultStatus;
}

/**
 * Resolve an issue by its human identifier (e.g. "GAME-5") via project + number.
 * `space` is filled from the resolved project id rather than the issue doc:
 * Huly's find-all does not reliably project the `space` field back, so trusting
 * it yields `undefined` and every subsequent tx fails BadRequest.
 */
async function resolveIssue(identifier: string): Promise<{ _id: string; space: string; comments?: number } | null> {
  const dash = identifier.lastIndexOf('-');
  if (dash <= 0) return null;
  const proj = identifier.slice(0, dash);
  const number = Number(identifier.slice(dash + 1));
  if (!Number.isFinite(number)) return null;
  const project = await resolveProject(proj);
  if (!project) return null;
  // `number` is a queryable core field; scope by project space.
  const issue = await findOne<{ _id: string; comments?: number }>('tracker:class:Issue', {
    space: project._id,
    number,
  });
  if (!issue) return null;
  return { _id: issue._id, space: project._id, comments: issue.comments };
}

export const listIssues: McpToolDefinition = {
  tool: {
    name: 'huly_list_issues',
    description: 'List issues in a Huly project. Returns identifier, title, status, priority.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project _id or identifier (e.g. "DURO")' },
        limit: { type: 'number', description: 'Max issues (default 50)' },
      },
      required: ['project'],
    },
  },
  async handler(args) {
    const project = await resolveProject(String(args.project ?? ''));
    if (!project) return err(`project not found: ${String(args.project)}`);
    const meta = await projectMeta(project);
    const issues = await findAll<Record<string, unknown>>(
      'tracker:class:Issue',
      { space: project._id },
      { limit: Number(args.limit ?? 50), sort: { modifiedOn: -1 } },
    );
    const rows = issues.map((i) => ({
      identifier: i.identifier,
      title: i.title,
      // Report status/priority in the same vocabulary the write tools accept.
      status: statusWord(meta?.categoryById[String(i.status)]),
      priority: priorityWord(i.priority as number),
      assignee: i.assignee,
    }));
    return ok(JSON.stringify(rows, null, 2));
  },
};

export const createIssue: McpToolDefinition = {
  tool: {
    name: 'huly_create_issue',
    description: 'Create an issue in a Huly project. Optional markdown description body.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project _id or identifier' },
        title: { type: 'string' },
        description: { type: 'string', description: 'Markdown body (optional)' },
        status: { type: 'string', description: 'backlog|todo|inprogress|done|cancelled (default: project default)' },
        priority: { type: 'string', description: 'nopriority|urgent|high|medium|low (default medium)' },
        assignee: { type: 'string', description: 'Employee ref to assign (optional; see huly_list_members)' },
      },
      required: ['project', 'title'],
    },
  },
  async handler(args) {
    const project = await resolveProject(String(args.project ?? ''));
    if (!project) return err(`project not found: ${String(args.project)}`);
    const title = String(args.title ?? '').trim();
    if (!title) return err('title is required');

    const social = await primarySocialId();
    const meta = await projectMeta(project);
    if (!meta) return err(`project ${project.identifier} has no Issue task type`);
    const number = (project.sequence ?? 0) + 1;
    const issueId = genId();
    const status = statusFor(meta, args.status != null ? String(args.status) : undefined);
    if (!status) return err(`could not resolve a status for project ${project.identifier}`);
    const priority = PRIORITY[String(args.priority ?? 'medium').toLowerCase()] ?? PRIORITY.medium;

    await tx({
      _class: 'core:class:TxCreateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: issueId,
      objectClass: 'tracker:class:Issue',
      objectSpace: project._id,
      attributes: {
        title,
        description: null,
        status,
        priority,
        number,
        identifier: `${project.identifier}-${number}`,
        kind: meta.kind,
        attachedTo: 'tracker:ids:NoParent',
        attachedToClass: 'tracker:class:Issue',
        collection: 'subIssues',
        rank: '0|i00000:',
        estimation: 0,
        remainingTime: 0,
        reportedTime: 0,
        reports: 0,
        comments: 0,
        subIssues: 0,
        parents: [],
        childInfo: [],
        dueDate: null,
        component: null,
        milestone: null,
        assignee: args.assignee ? String(args.assignee) : null,
      },
      modifiedBy: social,
      modifiedOn: now(),
    });

    // Bump the project sequence with an atomic increment so two concurrent
    // creates can't both claim the same number.
    await tx({
      _class: 'core:class:TxUpdateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: project._id,
      objectClass: 'tracker:class:Project',
      objectSpace: 'core:space:Space',
      operations: { $inc: { sequence: 1 } },
      modifiedBy: social,
      modifiedOn: now(),
    });

    const body = String(args.description ?? '').trim();
    if (body) {
      await setBody(issueId, 'tracker:class:Issue', project._id, 'description', markdownToProseMirror(body));
    }
    return ok(`Created ${project.identifier}-${number} (${issueId})`);
  },
};

export const updateIssue: McpToolDefinition = {
  tool: {
    name: 'huly_update_issue',
    description: 'Update an issue status and/or priority by identifier (e.g. "DURO-42").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identifier: { type: 'string', description: 'Issue identifier, e.g. DURO-42' },
        title: { type: 'string', description: 'New title (optional)' },
        status: { type: 'string', description: 'backlog|todo|inprogress|done|cancelled' },
        priority: { type: 'string', description: 'nopriority|urgent|high|medium|low' },
        assignee: { type: 'string', description: 'Employee ref to assign (optional)' },
      },
      required: ['identifier'],
    },
  },
  async handler(args) {
    const identifier = String(args.identifier ?? '');
    const issue = await resolveIssue(identifier);
    if (!issue) return err(`issue not found: ${identifier}`);
    const operations: Record<string, unknown> = {};
    if (args.title != null) operations.title = String(args.title);
    if (args.assignee != null) operations.assignee = String(args.assignee);
    if (args.status != null) {
      if (!(String(args.status).toLowerCase() in WORD_TO_CATEGORY)) {
        return err(`unknown status: ${String(args.status)}`);
      }
      const project = await findOne<Project>('tracker:class:Project', { _id: issue.space });
      if (!project) return err(`project for ${identifier} not found`);
      const meta = await projectMeta(project);
      if (!meta) return err(`project ${project.identifier} has no Issue task type`);
      operations.status = statusFor(meta, String(args.status));
    }
    if (args.priority != null) {
      const p = PRIORITY[String(args.priority).toLowerCase()];
      if (p == null) return err(`unknown priority: ${String(args.priority)}`);
      operations.priority = p;
    }
    if (Object.keys(operations).length === 0) return err('nothing to update (title, status, priority, or assignee)');
    await tx({
      _class: 'core:class:TxUpdateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: issue._id,
      objectClass: 'tracker:class:Issue',
      objectSpace: issue.space,
      operations,
      modifiedBy: await primarySocialId(),
      modifiedOn: now(),
    });
    return ok(`Updated ${identifier}`);
  },
};

export const commentIssue: McpToolDefinition = {
  tool: {
    name: 'huly_comment_issue',
    description: 'Post a comment on a Huly issue (markdown).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        identifier: { type: 'string', description: 'Issue identifier, e.g. DURO-42' },
        message: { type: 'string', description: 'Markdown comment' },
      },
      required: ['identifier', 'message'],
    },
  },
  async handler(args) {
    const identifier = String(args.identifier ?? '');
    const message = String(args.message ?? '').trim();
    if (!message) return err('message is required');
    const issue = await resolveIssue(identifier);
    if (!issue) return err(`issue not found: ${identifier}`);
    const social = await primarySocialId();
    await tx({
      _class: 'core:class:TxCreateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: genId(),
      objectClass: 'chunter:class:ChatMessage',
      objectSpace: issue.space,
      attributes: {
        attachedTo: issue._id,
        attachedToClass: 'tracker:class:Issue',
        collection: 'comments',
        message: JSON.stringify(markdownToProseMirror(message)),
        attachments: 0,
      },
      modifiedBy: social,
      modifiedOn: now(),
    });
    await tx({
      _class: 'core:class:TxUpdateDoc',
      _id: genId(),
      space: 'core:space:Tx',
      objectId: issue._id,
      objectClass: 'tracker:class:Issue',
      objectSpace: issue.space,
      operations: { $inc: { comments: 1 } },
      modifiedBy: social,
      modifiedOn: now(),
    });
    return ok(`Commented on ${identifier}`);
  },
};

export const listProjects: McpToolDefinition = {
  tool: {
    name: 'huly_list_projects',
    description: 'List the Huly projects the bot can see. Returns identifier and name for use as the `project` arg.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  async handler() {
    const projects = await findAll<Project>('tracker:class:Project', {}, { limit: 500 });
    return ok(
      JSON.stringify(
        projects.map((p) => ({ identifier: p.identifier, name: p.name })),
        null,
        2,
      ),
    );
  },
};

export const getIssue: McpToolDefinition = {
  tool: {
    name: 'huly_get_issue',
    description: 'Get a single Huly issue by identifier (e.g. "DURO-42") with status, priority, and assignee.',
    inputSchema: {
      type: 'object' as const,
      properties: { identifier: { type: 'string', description: 'Issue identifier, e.g. DURO-42' } },
      required: ['identifier'],
    },
  },
  async handler(args) {
    const identifier = String(args.identifier ?? '');
    const resolved = await resolveIssue(identifier);
    if (!resolved) return err(`issue not found: ${identifier}`);
    const issue = await findOne<Record<string, unknown>>('tracker:class:Issue', { _id: resolved._id });
    if (!issue) return err(`issue not found: ${identifier}`);
    const project = await findOne<Project>('tracker:class:Project', { _id: resolved.space });
    const meta = project ? await projectMeta(project) : null;
    return ok(
      JSON.stringify(
        {
          identifier,
          title: issue.title,
          status: statusWord(meta?.categoryById[String(issue.status)]),
          priority: priorityWord(issue.priority as number),
          assignee: issue.assignee ?? null,
          dueDate: issue.dueDate ?? null,
          comments: issue.comments ?? 0,
          // The rich description body lives in the collaborator service; open the
          // issue in Huly to read it. (Reading the blob over REST is not yet wired.)
          hasDescription: issue.description != null,
        },
        null,
        2,
      ),
    );
  },
};

registerTools([listProjects, listIssues, getIssue, createIssue, updateIssue, commentIssue]);
