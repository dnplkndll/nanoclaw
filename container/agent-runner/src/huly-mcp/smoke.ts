/**
 * Live smoke test of the Huly MCP tool handlers against the real instance.
 * Runs the ACTUAL handlers (not a reimplementation) so it exercises client.ts,
 * markup.ts, and the tx/find-all/collaborator shapes end to end.
 *
 * Not part of the test suite — run manually with a token in env:
 *   HULY_URL=... HULY_TOKEN=... HULY_WORKSPACE=... HULY_SMOKE_PROJECT=GAME \
 *     bun run src/huly-mcp/smoke.ts
 */
import { createIssue, listIssues, updateIssue, commentIssue } from './tools/issues.js';
import type { McpToolDefinition } from './types.js';

const project = process.env.HULY_SMOKE_PROJECT ?? 'GAME';

async function call(def: McpToolDefinition, args: Record<string, unknown>, label: string): Promise<string> {
  const res = await def.handler(args);
  const text = res.content.map((c) => ('text' in c ? c.text : '')).join('');
  console.log(`${res.isError ? 'FAIL' : 'ok  '} ${label}: ${text.slice(0, 120)}`);
  if (res.isError) throw new Error(`${label} failed`);
  return text;
}

const created = await call(
  createIssue,
  {
    project,
    title: 'NanoClaw MCP smoke test',
    description: '# Smoke\n\nCreated by the **Huly MCP** smoke test.\n\n- one\n- two',
    priority: 'low',
  },
  'create_issue',
);
const identifier = created.match(/Created (\S+)/)?.[1] ?? '';
await call(listIssues, { project, limit: 5 }, 'list_issues');
await call(
  commentIssue,
  { identifier, message: 'Smoke comment with `code` and a [link](https://huly.io).' },
  'comment_issue',
);
await call(updateIssue, { identifier, status: 'done' }, 'update_issue');
console.log(`\nSmoke passed. Created + closed ${identifier} in ${project}. Delete it in the Huly UI when done.`);
