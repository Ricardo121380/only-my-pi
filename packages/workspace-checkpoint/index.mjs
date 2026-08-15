import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CHECKPOINT_SCHEMA_VERSION = 1;
export const CHECKPOINT_DIR_NAME = 'only-my-pi/checkpoints';

function fail(message) {
  throw new Error(`workspace-checkpoint: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function normalizeRoot(root) {
  const resolved = path.resolve(root ?? process.cwd());
  assert(path.isAbsolute(resolved), 'workspace root must be absolute');
  return resolved;
}

function validateRelativePath(relativePath) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, 'empty relative path');
  assert(!relativePath.includes('\0'), 'path contains NUL');
  assert(!path.posix.isAbsolute(relativePath) && !path.win32.isAbsolute(relativePath), `absolute path is not allowed: ${relativePath}`);
  // Git emits slash-separated paths. Backslashes are rejected rather than
  // reinterpreted, so a manifest cannot exploit platform-specific separators.
  assert(!relativePath.includes('\\'), `backslash path is not allowed: ${relativePath}`);
  const normalized = path.posix.normalize(relativePath);
  assert(normalized === relativePath && normalized !== '.' && normalized !== '..', `unsafe relative path: ${relativePath}`);
  assert(!normalized.split('/').includes('..'), `path traversal is not allowed: ${relativePath}`);
  return normalized;
}

function safeJoin(root, relativePath) {
  const clean = validateRelativePath(relativePath);
  const target = path.resolve(root, ...clean.split('/'));
  const relative = path.relative(root, target);
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `path escapes workspace: ${relativePath}`);
  return target;
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function hashText(value) {
  return hashBytes(Buffer.from(value, 'utf8'));
}

function randomId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${crypto.randomBytes(5).toString('hex')}`;
}

function runGitSync(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    fail(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function gitRoot(root) {
  const discovered = runGitSync(root, ['rev-parse', '--show-toplevel']).trim();
  assert(discovered, 'workspace is not a Git repository');
  return path.resolve(discovered);
}

function gitHead(root) {
  try {
    return runGitSync(root, ['rev-parse', 'HEAD']).trim() || null;
  } catch {
    return null;
  }
}

function gitPath(root) {
  const value = runGitSync(root, ['rev-parse', '--git-path', CHECKPOINT_DIR_NAME]).trim();
  assert(value, 'Git did not return a checkpoint path');
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function parseNulList(value) {
  return value.split('\0').filter(Boolean).map(validateRelativePath);
}

function gitCandidatePaths(root) {
  const tracked = parseNulList(runGitSync(root, ['ls-files', '-z', '--cached']));
  const untracked = parseNulList(runGitSync(root, ['ls-files', '-z', '--others', '--exclude-standard']));
  return [...new Set([...tracked, ...untracked])].sort();
}

async function readEntry(root, relativePath) {
  const absolute = safeJoin(root, relativePath);
  await assertNoSymlinkParents(root, absolute);
  let stat;
  try {
    stat = await fsp.lstat(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { path: relativePath, type: 'missing', mode: 0 };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    const target = await fsp.readlink(absolute);
    assert(!path.isAbsolute(target), `absolute symlink target is not allowed: ${relativePath}`);
    const resolvedTarget = path.resolve(path.dirname(absolute), target);
    const relativeTarget = path.relative(root, resolvedTarget);
    assert(relativeTarget && relativeTarget !== '..' && !relativeTarget.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeTarget), `symlink escapes workspace: ${relativePath}`);
    return {
      path: relativePath,
      type: 'symlink',
      mode: stat.mode & 0o7777,
      target,
      targetSha256: hashText(target),
    };
  }

  if (stat.isFile()) {
    const bytes = await fsp.readFile(absolute);
    return {
      path: relativePath,
      type: 'file',
      mode: stat.mode & 0o7777,
      size: stat.size,
      sha256: hashBytes(bytes),
    };
  }

  fail(`unsupported workspace entry type: ${relativePath}`);
}

function digestEntries(entries) {
  const normalized = entries
    .map((entry) => {
      const copy = { ...entry };
      delete copy.size;
      return copy;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return hashText(JSON.stringify(normalized));
}

export async function inspectWorkspace(rootInput = process.cwd()) {
  const root = gitRoot(normalizeRoot(rootInput));
  const paths = gitCandidatePaths(root);
  const entries = [];
  for (const relativePath of paths) entries.push(await readEntry(root, relativePath));
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    root,
    head: gitHead(root),
    entries,
    digest: digestEntries(entries),
  };
}

async function ensurePrivateDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `checkpoint directory is not a real directory: ${directory}`);
  if ((stat.mode & 0o077) !== 0) {
    try {
      await fsp.chmod(directory, 0o700);
    } catch (error) {
      fail(`checkpoint directory is too permissive and cannot be tightened: ${error.message}`);
    }
  }
}

function manifestPath(snapshotDirectory) {
  return path.join(snapshotDirectory, 'manifest.json');
}

async function writeExclusive(file, data, mode = 0o600) {
  const handle = await fsp.open(file, 'wx', mode);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

async function ensureNoSymlinkParents(root, target) {
  const relative = path.relative(root, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `target escapes workspace: ${target}`);
  const parts = relative.split(path.sep);
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fsp.lstat(current);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), `symlink or non-directory parent: ${path.relative(root, current)}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fsp.mkdir(current, { mode: 0o700 });
        continue;
      }
      throw error;
    }
  }
}

async function assertNoSymlinkParents(root, target) {
  const relative = path.relative(root, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `target escapes workspace: ${target}`);
  const parts = relative.split(path.sep);
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fsp.lstat(current);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), `symlink or non-directory parent: ${path.relative(root, current)}`);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function copyEntryToSnapshot(root, payloadRoot, entry) {
  if (entry.type !== 'file') return;
  const source = safeJoin(root, entry.path);
  const destination = safeJoin(payloadRoot, entry.path);
  await ensureNoSymlinkParents(payloadRoot, destination);
  await writeExclusive(destination, await fsp.readFile(source));
  try {
    await fsp.chmod(destination, entry.mode & 0o7777);
  } catch {
    // Some filesystems reject chmod; the manifest remains authoritative.
  }
}

export async function defaultCheckpointStore(rootInput = process.cwd()) {
  const root = gitRoot(normalizeRoot(rootInput));
  const store = gitPath(root);
  await ensurePrivateDirectory(store);
  return store;
}

export async function createSnapshot(rootInput = process.cwd(), options = {}) {
  const root = gitRoot(normalizeRoot(rootInput));
  const store = path.resolve(options.store ?? await defaultCheckpointStore(root));
  await ensurePrivateDirectory(store);
  const id = options.id ? validateSnapshotId(options.id) : randomId();
  const snapshotDirectory = path.join(store, id);
  let created = false;
  try {
    await fsp.mkdir(snapshotDirectory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error.code === 'EEXIST') fail(`snapshot already exists: ${id}`);
    throw error;
  }
  try {
    const inspection = await inspectWorkspace(root);
    const payloadRoot = path.join(snapshotDirectory, 'payload');
    await ensurePrivateDirectory(payloadRoot);
    for (const entry of inspection.entries) await copyEntryToSnapshot(root, payloadRoot, entry);
    const manifest = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      id,
      createdAt: new Date().toISOString(),
      gitHead: inspection.head,
      entryCount: inspection.entries.length,
      digest: inspection.digest,
      entries: inspection.entries,
    };
    await writeExclusive(manifestPath(snapshotDirectory), `${JSON.stringify(manifest, null, 2)}\n`);
    return { ...manifest, root, store, directory: snapshotDirectory };
  } catch (error) {
    if (created) await fsp.rm(snapshotDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function validateSnapshotId(id) {
  assert(typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id), `invalid snapshot id: ${id}`);
  return id;
}

async function loadManifest(store, id) {
  const cleanId = validateSnapshotId(id);
  const directory = path.join(path.resolve(store), cleanId);
  const relative = path.relative(path.resolve(store), directory);
  assert(relative === cleanId && !relative.startsWith('..') && !path.isAbsolute(relative), 'snapshot path escapes store');
  const file = manifestPath(directory);
  const raw = await fsp.readFile(file, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    fail(`invalid manifest JSON: ${error.message}`);
  }
  assert(manifest && manifest.schemaVersion === CHECKPOINT_SCHEMA_VERSION, 'unsupported checkpoint schema');
  assert(manifest.id === cleanId && Array.isArray(manifest.entries), 'manifest identity or entries invalid');
  for (const entry of manifest.entries) {
    validateRelativePath(entry.path);
    assert(['file', 'symlink', 'missing'].includes(entry.type), `unsupported manifest entry type: ${entry.type}`);
    if (entry.type === 'symlink') {
      assert(typeof entry.target === 'string' && !path.isAbsolute(entry.target), `unsafe symlink target: ${entry.path}`);
      const target = path.resolve(path.dirname(safeJoin(path.resolve('/'), entry.path)), entry.target);
      // The actual root-independent check is repeated when a workspace is known.
      assert(target, 'invalid symlink target');
    }
  }
  return { ...manifest, directory, store: path.resolve(store) };
}

export async function listSnapshots(rootInput = process.cwd(), options = {}) {
  const root = gitRoot(normalizeRoot(rootInput));
  const store = path.resolve(options.store ?? await defaultCheckpointStore(root));
  let names = [];
  try {
    names = await fsp.readdir(store);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const snapshots = [];
  for (const name of names.sort()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) continue;
    try {
      const manifest = await loadManifest(store, name);
      snapshots.push({ id: manifest.id, createdAt: manifest.createdAt, gitHead: manifest.gitHead, entryCount: manifest.entryCount, digest: manifest.digest });
    } catch {
      // Ignore incomplete/corrupt directories in a listing; inspect reports them.
    }
  }
  return { root, store, snapshots };
}

export async function inspectSnapshot(rootInput = process.cwd(), id, options = {}) {
  const root = gitRoot(normalizeRoot(rootInput));
  const store = path.resolve(options.store ?? await defaultCheckpointStore(root));
  const manifest = await loadManifest(store, id);
  return { ...manifest, root };
}

function validateManifestAgainstRoot(manifest, root) {
  for (const entry of manifest.entries) {
    safeJoin(root, entry.path);
    if (entry.type === 'symlink') {
      const link = safeJoin(root, entry.path);
      const resolved = path.resolve(path.dirname(link), entry.target);
      const relative = path.relative(root, resolved);
      assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `manifest symlink escapes workspace: ${entry.path}`);
    }
  }
}

async function pathExists(root, relativePath) {
  try {
    await fsp.lstat(safeJoin(root, relativePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function entryKey(entry) {
  return JSON.stringify({ path: entry.path, type: entry.type, mode: entry.mode ?? 0, sha256: entry.sha256 ?? null, target: entry.target ?? null });
}

async function buildRestorePlan(root, manifest, options = {}) {
  validateManifestAgainstRoot(manifest, root);
  const current = await inspectWorkspace(root);
  const currentByPath = new Map(current.entries.map((entry) => [entry.path, entry]));
  const desiredByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const writes = [];
  const deletes = [];
  for (const entry of manifest.entries) {
    const currentEntry = currentByPath.get(entry.path);
    if (entry.type === 'missing') {
      if (currentEntry && currentEntry.type !== 'missing') deletes.push({ path: entry.path, reason: 'snapshot-missing' });
      continue;
    }
    if (!currentEntry || currentEntry.type === 'missing' || entryKey(currentEntry) !== entryKey(entry)) {
      writes.push({ path: entry.path, from: currentEntry?.type ?? 'missing', to: entry.type });
    }
  }
  for (const entry of current.entries) {
    if (!desiredByPath.has(entry.path) && entry.type !== 'missing') deletes.push({ path: entry.path, reason: 'not-in-snapshot' });
  }
  return {
    root,
    snapshotId: manifest.id,
    snapshotDigest: manifest.digest,
    currentDigest: current.digest,
    workspaceChanged: current.digest !== manifest.digest,
    writes,
    deletes,
    requiresForce: current.digest !== manifest.digest,
    requiresAllowDelete: deletes.length > 0,
    wouldChange: writes.length > 0 || deletes.length > 0,
    options: { allowDelete: Boolean(options.allowDelete), force: Boolean(options.force), run: Boolean(options.run) },
  };
}

export async function planRestore(rootInput = process.cwd(), id, options = {}) {
  const root = gitRoot(normalizeRoot(rootInput));
  const store = path.resolve(options.store ?? await defaultCheckpointStore(root));
  const manifest = await loadManifest(store, id);
  return buildRestorePlan(root, manifest, options);
}

async function removeFileOnly(root, relativePath) {
  const target = safeJoin(root, relativePath);
  const stat = await fsp.lstat(target);
  assert(!stat.isDirectory(), `refusing to remove directory: ${relativePath}`);
  await fsp.unlink(target);
}

async function replaceWithSnapshot(root, payloadRoot, entry) {
  const target = safeJoin(root, entry.path);
  await ensureNoSymlinkParents(root, target);
  let current;
  try {
    current = await fsp.lstat(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current) {
    assert(!current.isDirectory(), `refusing to replace directory: ${entry.path}`);
    await fsp.unlink(target);
  }
  if (entry.type === 'symlink') {
    const resolved = path.resolve(path.dirname(target), entry.target);
    const relative = path.relative(root, resolved);
    assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `symlink escapes workspace: ${entry.path}`);
    await fsp.symlink(entry.target, target);
    return;
  }
  assert(entry.type === 'file', `cannot restore entry type: ${entry.type}`);
  const source = safeJoin(payloadRoot, entry.path);
  const bytes = await fsp.readFile(source);
  assert(hashBytes(bytes) === entry.sha256, `snapshot payload hash mismatch: ${entry.path}`);
  const temporary = `${target}.only-my-pi-tmp-${crypto.randomBytes(6).toString('hex')}`;
  await writeExclusive(temporary, bytes);
  try {
    await fsp.chmod(temporary, entry.mode & 0o7777);
    await fsp.rename(temporary, target);
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function restoreSnapshot(rootInput = process.cwd(), id, options = {}) {
  const root = gitRoot(normalizeRoot(rootInput));
  const store = path.resolve(options.store ?? await defaultCheckpointStore(root));
  const manifest = await loadManifest(store, id);
  const plan = await buildRestorePlan(root, manifest, options);
  if (!options.run) return { ...plan, applied: false, dryRun: true };
  if (plan.requiresForce && !options.force) fail('workspace changed since checkpoint; use --force for an explicit restore');
  if (plan.requiresAllowDelete && !options.allowDelete) fail('restore needs deletion; use --allow-delete for an explicit restore');
  const payloadRoot = path.join(manifest.directory, 'payload');
  const entriesByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  for (const change of plan.writes) {
    const entry = entriesByPath.get(change.path);
    if (entry && entry.type !== 'missing') await replaceWithSnapshot(root, payloadRoot, entry);
  }
  if (options.allowDelete) {
    for (const deletion of plan.deletes) {
      if (await pathExists(root, deletion.path)) await removeFileOnly(root, deletion.path);
    }
  }
  const after = await inspectWorkspace(root);
  assert(after.digest === manifest.digest, 'restore completed but workspace digest differs from checkpoint');
  return { ...plan, applied: true, dryRun: false, afterDigest: after.digest };
}

export async function undoSnapshot(rootInput = process.cwd(), id, options = {}) {
  return restoreSnapshot(rootInput, id, options);
}

export function parseCheckpointArgs(argv) {
  const args = [...argv];
  const command = args.shift() ?? 'help';
  const options = { command, run: false, force: false, allowDelete: false };
  if (command === '--help' || command === '-h') {
    options.command = 'help';
    options.help = true;
    return options;
  }
  while (args.length) {
    const value = args.shift();
    if (value === '--run') options.run = true;
    else if (value === '--force') options.force = true;
    else if (value === '--allow-delete') options.allowDelete = true;
    else if (value === '--root') options.root = args.shift();
    else if (value === '--store') options.store = args.shift();
    else if (value === '--id') options.id = args.shift();
    else if (value === '--latest') options.latest = true;
    else if (value === '--json') options.json = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (!value.startsWith('-') && !options.id) options.id = value;
    else fail(`unknown or misplaced argument: ${value}`);
  }
  return options;
}

export function helpText() {
  return [
    'Usage: node packages/workspace-checkpoint/cli.mjs <command> [options]',
    '',
    'Commands:',
    '  snapshot                 capture tracked and non-ignored untracked files',
    '  list                     list valid snapshots',
    '  inspect <id>             inspect a snapshot manifest',
    '  restore <id>             print restore plan (add --run to apply)',
    '  undo <id>                alias for restore',
    '',
    'Options:',
    '  --root <path>            Git workspace root',
    '  --store <path>           checkpoint store (defaults inside Git dir)',
    '  --run                    apply restore; otherwise dry-run',
    '  --force                  allow restore over changed workspace',
    '  --allow-delete           allow deletion of files not in snapshot',
    '  --json                   emit JSON (default)',
  ].join('\n');
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCheckpointArgs(argv);
  if (options.help || options.command === 'help') return { help: helpText() };
  const root = options.root ?? process.cwd();
  if (options.command === 'snapshot') return createSnapshot(root, options);
  if (options.command === 'list') return listSnapshots(root, options);
  if (options.command === 'inspect') {
    assert(options.id, 'inspect requires a snapshot id');
    return inspectSnapshot(root, options.id, options);
  }
  if (options.command === 'restore' || options.command === 'undo') {
    let id = options.id;
    if (!id && options.latest) {
      const listing = await listSnapshots(root, options);
      id = listing.snapshots.at(-1)?.id;
    }
    assert(id, `${options.command} requires a snapshot id or --latest`);
    return restoreSnapshot(root, id, options);
  }
  fail(`unknown command: ${options.command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
    .then((result) => {
      if (result?.help) process.stdout.write(`${result.help}\n`);
      else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
