/**
 * Huly MCP barrel — imports each tool module for its side-effect
 * `registerTools([...])` call, then starts the stdio server.
 *
 * Refuses to start without Huly config so a misconfigured install fails
 * loudly here rather than on the first tool call.
 */
import './tools/issues.js';
import './tools/todos.js';
import './tools/docs.js';
import { hulyConfigured } from './client.js';
import { startHulyMcpServer } from './server.js';

function log(msg: string): void {
  console.error(`[huly-mcp] ${msg}`);
}

if (!hulyConfigured()) {
  log('HULY_URL / HULY_TOKEN / HULY_WORKSPACE not set — refusing to start');
  process.exit(1);
}

startHulyMcpServer().catch((err) => {
  log(`server error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
