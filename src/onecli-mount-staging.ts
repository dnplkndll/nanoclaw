/**
 * Restage OneCLI gateway bind-mount sources out of os.tmpdir().
 *
 * The SDK sources its cert/stub `-v` mounts from os.tmpdir(), which
 * VM-based runtimes don't reliably share with the VM (Colima shares only
 * $HOME) — Docker then silently binds an empty directory and every
 * proxied HTTPS call fails while the spawn looks healthy. Staging under
 * data/ makes these sources exactly as mountable as the session-DB mounts
 * every container already depends on. Copy failures throw (fail closed,
 * matching the gateway-not-applied throw in container-runner.ts).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR } from './config.js';

export interface MountStaging {
  /** Index of the `-v` value arg ("src:dest[:opts]") to rewrite. */
  argIndex: number;
  /** Host source path under tmpdir. */
  src: string;
  /** Staged host path the arg is rewritten to. */
  staged: string;
  /** Replacement value for args[argIndex]. */
  rewritten: string;
}

/** os.tmpdir() plus its resolved form (macOS: /var → /private/var). */
function tmpdirPrefixes(): string[] {
  const raw = os.tmpdir();
  try {
    const real = fs.realpathSync(raw);
    return real === raw ? [raw] : [raw, real];
  } catch {
    return [raw];
  }
}

function isUnder(candidate: string, prefix: string): boolean {
  const p = prefix.endsWith(path.sep) ? prefix : prefix + path.sep;
  return candidate.startsWith(p);
}

/**
 * Scan `-v src:dest[:opts]` pairs appended at or after scanFrom and plan a
 * rewrite for every source that lives under one of tmpdirPrefixes. Pure —
 * unit-tested without a filesystem.
 */
export function planGatewayMountStaging(
  args: string[],
  scanFrom: number,
  prefixes: string[],
  stageDir: string,
): MountStaging[] {
  const plans: MountStaging[] = [];
  for (let i = scanFrom + 1; i < args.length; i++) {
    if (args[i - 1] !== '-v') continue;
    const spec = args[i];
    const sep = spec.indexOf(':');
    if (sep <= 0) continue;
    const src = spec.slice(0, sep);
    if (!prefixes.some((prefix) => isUnder(src, prefix))) continue;
    const staged = path.join(stageDir, path.basename(src));
    plans.push({ argIndex: i, src, staged, rewritten: `${staged}:${spec.slice(sep + 1)}` });
  }
  return plans;
}

/**
 * Execute the plan: copy sources into stageDir (atomic write-then-rename,
 * preserving mode — credential stubs are 0600) and rewrite args in place.
 * Returns the number of mounts restaged.
 */
export function stageGatewayMounts(
  args: string[],
  scanFrom: number,
  stageDir: string = path.join(DATA_DIR, 'onecli-mounts'),
): number {
  const plans = planGatewayMountStaging(args, scanFrom, tmpdirPrefixes(), stageDir);
  if (plans.length === 0) return 0;
  fs.mkdirSync(stageDir, { recursive: true });
  for (const plan of plans) {
    const mode = fs.statSync(plan.src).mode & 0o777;
    const tmp = `${plan.staged}.tmp`;
    fs.copyFileSync(plan.src, tmp);
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, plan.staged);
    args[plan.argIndex] = plan.rewritten;
  }
  return plans.length;
}
