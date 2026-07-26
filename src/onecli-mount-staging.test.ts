import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { planGatewayMountStaging, stageGatewayMounts } from './onecli-mount-staging.js';

const TMP = '/var/folders/xx/yy/T';
const TMP_REAL = '/private/var/folders/xx/yy/T';
const PREFIXES = [TMP, TMP_REAL];
const STAGE = '/repo/data/onecli-mounts';

describe('planGatewayMountStaging', () => {
  it('rewrites CA cert mounts sourced from tmpdir, preserving dest and :ro', () => {
    const args = ['-v', `${TMP}/onecli-combined-ca.pem:/tmp/onecli-combined-ca.pem:ro`];
    const plans = planGatewayMountStaging(args, 0, PREFIXES, STAGE);
    expect(plans).toHaveLength(1);
    expect(plans[0].argIndex).toBe(1);
    expect(plans[0].rewritten).toBe(`${STAGE}/onecli-combined-ca.pem:/tmp/onecli-combined-ca.pem:ro`);
  });

  it('rewrites credential stub mounts (no .pem suffix)', () => {
    const args = ['-v', `${TMP}/onecli-stubs/onecli-stub-credentials.json:/home/node/.config/x/credentials.json:ro`];
    const plans = planGatewayMountStaging(args, 0, PREFIXES, STAGE);
    expect(plans).toHaveLength(1);
    expect(plans[0].rewritten).toBe(`${STAGE}/onecli-stub-credentials.json:/home/node/.config/x/credentials.json:ro`);
  });

  it('matches the realpath form of tmpdir (/private/var on macOS)', () => {
    const args = ['-v', `${TMP_REAL}/onecli-proxy-ca.pem:/tmp/onecli-gateway-ca.pem:ro`];
    expect(planGatewayMountStaging(args, 0, PREFIXES, STAGE)).toHaveLength(1);
  });

  it('leaves non-tmpdir mounts untouched', () => {
    const args = ['-v', '/Users/me/nanoclaw/data/sessions/s1:/workspace'];
    expect(planGatewayMountStaging(args, 0, PREFIXES, STAGE)).toHaveLength(0);
  });

  it('does not match sibling paths that merely share the tmpdir string prefix', () => {
    const args = ['-v', `${TMP}-other/file.pem:/tmp/file.pem:ro`];
    expect(planGatewayMountStaging(args, 0, PREFIXES, STAGE)).toHaveLength(0);
  });

  it('ignores args before scanFrom', () => {
    const args = [
      '-v',
      `${TMP}/pre-existing.pem:/tmp/pre.pem:ro`,
      '-v',
      `${TMP}/onecli-proxy-ca.pem:/tmp/onecli-gateway-ca.pem:ro`,
    ];
    const plans = planGatewayMountStaging(args, 2, PREFIXES, STAGE);
    expect(plans).toHaveLength(1);
    expect(plans[0].argIndex).toBe(3);
  });

  it('ignores non-mount args like -e KEY=value pairs', () => {
    const args = ['-e', `SSL_CERT_FILE=${TMP}/onecli-combined-ca.pem`, '-v', '/ok:/ok'];
    expect(planGatewayMountStaging(args, 0, PREFIXES, STAGE)).toHaveLength(0);
  });
});

describe('stageGatewayMounts', () => {
  it('copies sources into stageDir, preserves mode, and rewrites args in place', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-stage-test-'));
    const srcDir = path.join(dir, 'src');
    const stageDir = path.join(dir, 'staged');
    fs.mkdirSync(srcDir, { recursive: true });
    const src = path.join(srcDir, 'onecli-stub-cred.json');
    fs.writeFileSync(src, '{"stub":true}', { mode: 0o600 });

    // Point the scan at the real tmpdir of this test by passing args whose
    // source is under os.tmpdir() (mkdtemp guarantees that).
    const args = ['-v', `${src}:/home/node/cred.json:ro`];
    const count = stageGatewayMounts(args, 0, stageDir);

    expect(count).toBe(1);
    const staged = path.join(stageDir, 'onecli-stub-cred.json');
    expect(args[1]).toBe(`${staged}:/home/node/cred.json:ro`);
    expect(fs.readFileSync(staged, 'utf-8')).toBe('{"stub":true}');
    expect(fs.statSync(staged).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(`${staged}.tmp`)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when a planned source is missing instead of spawning with a broken mount', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-stage-test-'));
    const args = ['-v', `${path.join(dir, 'missing.pem')}:/tmp/x.pem:ro`];
    expect(() => stageGatewayMounts(args, 0, path.join(dir, 'staged'))).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
