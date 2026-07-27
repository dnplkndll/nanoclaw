import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function ok(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function err(text: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
}
