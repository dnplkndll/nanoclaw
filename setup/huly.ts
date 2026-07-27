#!/usr/bin/env -S npx tsx
/**
 * Provision a NanoClaw bot in Huly and mint its scoped-grant token.
 *
 * Run with tsx (this file is TypeScript): `pnpm exec tsx setup/huly.ts ...`.
 *
 * This mints a JWT signed with the Huly server secret, so it is intended to
 * be run by an operator who holds that secret — not by an automated agent.
 * It:
 *   1. resolves (or reports) the bot account + its social id,
 *   2. mints a least-privilege JWT: PermissionsGrant { role: 'USER',
 *      spaces: [...] }, expiring in --days days,
 *   3. prints the HULY_URL / HULY_TOKEN / HULY_WORKSPACE lines to append to
 *      `.env`.
 *
 * It deliberately does NOT create accounts or add space memberships for you —
 * those are one-time clicks in the Huly UI (invite the bot user, add it to
 * the target project/channel), and keeping them manual avoids this script
 * needing broad admin rights. See docs/huly-integration.md.
 *
 * Usage:
 *   HULY_SERVER_SECRET=... node setup/huly.ts \
 *     --url https://huly.hz.ledoweb.com \
 *     --workspace <ws-uuid> \
 *     --account <bot-account-uuid> \
 *     --spaces <spaceId1,spaceId2,...> \
 *     [--days 90]
 */
import crypto from 'crypto';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function main(): void {
  const secret = process.env.HULY_SERVER_SECRET;
  if (!secret) {
    console.error('Set HULY_SERVER_SECRET (the Huly server secret) in the environment.');
    process.exit(1);
  }
  const url = arg('url').replace(/\/+$/, '');
  const workspace = arg('workspace');
  const account = arg('account');
  const spaces = arg('spaces')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const days = parseInt(arg('days', '90'), 10);
  if (!Number.isFinite(days) || days < 1) {
    console.error(`--days must be a positive integer (got "${arg('days', '90')}")`);
    process.exit(1);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = sign(
    {
      account,
      workspace,
      // Least-privilege: USER role, limited to the listed spaces.
      grant: { workspace, role: 'USER', spaces },
      nbf: nowSec - 60,
      exp: nowSec + days * 86400,
    },
    secret,
  );

  console.log('# Append these to your NanoClaw .env:');
  console.log(`HULY_URL=${url}`);
  console.log(`HULY_WORKSPACE=${workspace}`);
  console.log(`HULY_TOKEN=${token}`);
  console.log('');
  console.error(`Minted a ${days}-day USER-role token for ${account} scoped to ${spaces.length} space(s).`);
  console.error('Remember: the bot must be a MEMBER of each of those spaces in Huly, and the');
  console.error('OneCLI gateway must allow', new URL(url).host, 'for agent containers to reach it.');
}

main();
