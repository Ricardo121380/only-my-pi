import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createSnapshot,
  inspectSnapshot,
  listSnapshots,
  planRestore,
  restoreSnapshot,
} from './index.mjs';

async function tempRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'only-my-pi-checkpoint-'));
  const git = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['config', 'user.email', 'checkpoint-test@example.invalid']);
  git(['config', 'user.name', 'checkpoint-test']);
  await fs.writeFile(path.join(root, 'tracked.txt'), 'before\n');
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'code.js'), 'export const value = 1;\n');
  git(['add', 'tracked.txt', 'src/code.js']);
  git(['commit', '-qm', 'initial']);
  return { root, git };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

async function testSnapshotIncludesTrackedAndUntracked() {
  const { root } = await tempRepo();
  try {
    await fs.writeFile(path.join(root, 'notes.txt'), 'untracked\n');
    const snapshot = await createSnapshot(root, { id: 'baseline' });
    assert.equal(snapshot.id, 'baseline');
    assert.equal(snapshot.entryCount, 3);
    const inspected = await inspectSnapshot(root, 'baseline');
    assert.deepEqual(inspected.entries.map((entry) => entry.path), ['notes.txt', 'src/code.js', 'tracked.txt']);
    const listing = await listSnapshots(root);
    assert.deepEqual(listing.snapshots.map((entry) => entry.id), ['baseline']);
  } finally {
    await cleanup(root);
  }
}

async function testDryRunAndExplicitRestore() {
  const { root } = await tempRepo();
  try {
    const snapshot = await createSnapshot(root, { id: 'restore-me' });
    await fs.writeFile(path.join(root, 'tracked.txt'), 'after\n');
    await fs.writeFile(path.join(root, 'new.txt'), 'created after checkpoint\n');

    const plan = await planRestore(root, snapshot.id);
    assert.equal(plan.workspaceChanged, true);
    assert.ok(plan.writes.some((entry) => entry.path === 'tracked.txt'));
    assert.ok(plan.deletes.some((entry) => entry.path === 'new.txt'));
    const dryRun = await restoreSnapshot(root, snapshot.id);
    assert.equal(dryRun.applied, false);
    assert.equal(await fs.readFile(path.join(root, 'tracked.txt'), 'utf8'), 'after\n');

    await assert.rejects(
      restoreSnapshot(root, snapshot.id, { run: true }),
      /workspace changed/,
    );

    const applied = await restoreSnapshot(root, snapshot.id, { run: true, force: true, allowDelete: true });
    assert.equal(applied.applied, true);
    assert.equal(await fs.readFile(path.join(root, 'tracked.txt'), 'utf8'), 'before\n');
    await assert.rejects(fs.lstat(path.join(root, 'new.txt')), { code: 'ENOENT' });
  } finally {
    await cleanup(root);
  }
}

async function testSymlinkAndManifestPathSafety() {
  const { root } = await tempRepo();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'only-my-pi-outside-'));
  try {
    await fs.symlink(outside, path.join(root, 'escape'));
    await assert.rejects(createSnapshot(root, { id: 'unsafe-link' }), /absolute symlink target|symlink escapes workspace/);
    await fs.unlink(path.join(root, 'escape'));
    const snapshot = await createSnapshot(root, { id: 'safe-manifest' });
    const manifestFile = path.join(snapshot.directory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.entries.push({ path: '../outside.txt', type: 'file', mode: 0o600, sha256: '0'.repeat(64), size: 0 });
    await fs.writeFile(manifestFile, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(planRestore(root, snapshot.id), /unsafe relative path|path traversal/);
  } finally {
    await cleanup(root);
    await cleanup(outside);
  }
}

async function testSnapshotIdAndExistingStoreSafety() {
  const { root } = await tempRepo();
  try {
    await assert.rejects(createSnapshot(root, { id: '../escape' }), /invalid snapshot id/);
    const first = await createSnapshot(root, { id: 'fixed' });
    await assert.rejects(createSnapshot(root, { id: 'fixed' }), /already exists|EEXIST/);
    assert.equal((await inspectSnapshot(root, first.id)).id, 'fixed');
  } finally {
    await cleanup(root);
  }
}

await testSnapshotIncludesTrackedAndUntracked();
await testDryRunAndExplicitRestore();
await testSymlinkAndManifestPathSafety();
await testSnapshotIdAndExistingStoreSafety();
console.log('workspace-checkpoint smoke ok');
