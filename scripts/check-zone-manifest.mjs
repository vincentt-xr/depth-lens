#!/usr/bin/env node
// Validates .vincentt-template.json against the f17 §5 validation table and the
// §5.1 floor.
//
// This is a DELIBERATE SECOND IMPLEMENTATION of the floor. @vincentt-xr/cli ships
// its own copy in platform/zonePath.ts, consulted at fetch and at write; this one
// runs in CI at the branch and at the tag. Two copies is the design's intent: a
// check that does not run at the tag does not protect the artifact, and the CLI
// cannot check a tree it has not fetched yet.
//
// EVERY failure refuses the WHOLE manifest. There is no per-entry skip — that is
// how one hostile entry rides in behind twenty good ones.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const MANIFEST = '.vincentt-template.json';

// Rule 2. Checked BEFORE the zone lookup, so a manifest listing src/Scene.tsx
// under platform is refused rather than obeyed.
const DENY_NAMES = new Set([
  'src/Scene.tsx',
  'AGENTS.md',
  'GROUNDING.md',
  'CLAUDE.md',
]);

// Rule 6. Single-segment paths must be in this allowlist. pnpm-lock.yaml and
// .github/workflows/release.yml are refused by absence rather than by a rule
// enumerating every hazard.
const ROOT_ALLOWLIST = new Set([
  'index.html',
  'package.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vitest.config.ts',
  'esbuild.config.mjs',
]);

const ALLOWED_FIRST_SEGMENTS = new Set(['src', 'public']);

// Rule 7. Longest-match, so .d.ts wins over .ts.
const ALLOWED_EXTENSIONS = ['.d.ts', '.tsx', '.ts', '.css', '.mjs', '.json', '.html'];

const MAX_DEPTH = 4;
const MAX_BYTES = 256;

function extensionOf(path) {
  for (const ext of ALLOWED_EXTENSIONS) {
    if (path.endsWith(ext)) return ext;
  }
  return null;
}

// Rules 1-8, for one entry. Returns an array of reasons; empty means it passes.
//
// `zone` matters for rule 2 only. The deny-by-name set exists so a manifest
// listing src/Scene.tsx under `platform` is refused rather than obeyed — it
// bounds what may become a WRITE TARGET. §6 gives `creator@TO` and the
// deny-by-name set the same outcome ("never read, never written"), so naming
// src/Scene.tsx under `creator` asks for the protection the deny set already
// grants and is permitted; naming it under `platform` is refused.
export function checkEntry(raw, zone = 'platform') {
  const reasons = [];

  if (typeof raw !== 'string') {
    return [`entry is ${typeof raw}, not a string`];
  }

  // Rule 1. NFC-normalize, then reject any non-ASCII byte. An RTL override, a
  // Cyrillic homoglyph and a division slash all render as ordinary paths in a
  // manifest diff while being a different file, defeating the human review that
  // is the only control left once the mechanical ones are gone.
  const path = raw.normalize('NFC');
  if (path !== raw) {
    reasons.push('is not NFC-normalized');
  }
  for (let i = 0; i < path.length; i += 1) {
    const code = path.codePointAt(i);
    if (code > 0x7f) {
      reasons.push(`contains non-ASCII U+${code.toString(16).toUpperCase().padStart(4, '0')} at index ${i}`);
      break;
    }
  }

  // Rule 2. Before the zone lookup.
  if (DENY_NAMES.has(path) && zone !== 'creator') {
    reasons.push(`is denied by name and may never be a platform write target (rule 2)`);
  }

  // Rule 3.
  if (path.includes('\\')) reasons.push('contains a backslash');
  if (path.startsWith('/')) reasons.push('has a leading slash');
  if (/^[A-Za-z]:/.test(path)) reasons.push('has a drive letter');
  if (path.includes('%')) reasons.push('contains %');
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      reasons.push(`contains a control byte at index ${i}`);
      break;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      const isHighSurrogate = code <= 0xdbff;
      const next = path.charCodeAt(i + 1);
      const paired = isHighSurrogate && next >= 0xdc00 && next <= 0xdfff;
      if (!paired) {
        reasons.push(`contains a lone surrogate at index ${i}`);
        break;
      }
      i += 1;
    }
  }

  const segments = path.split('/');

  // Rule 4. The dotfile rule. .env, .npmrc, .gitignore, .github/... all die here.
  for (const segment of segments) {
    if (segment === '') {
      reasons.push('has an empty segment');
    } else if (segment === '.' || segment === '..') {
      reasons.push(`has a "${segment}" segment`);
    } else if (segment.startsWith('.')) {
      reasons.push(`has a segment beginning with "." ("${segment}")`);
    }
  }

  // Rule 5. Not redundant with 4 — node_modules/.bin/esbuild is a binary the
  // next build executes.
  if (segments[0] === 'node_modules') {
    reasons.push('has node_modules as its first segment');
  }

  // Rule 6. The top-level allowlist.
  if (segments.length === 1) {
    if (!ROOT_ALLOWLIST.has(path)) {
      reasons.push('is a root file not in the root-file allowlist');
    }
  } else if (!ALLOWED_FIRST_SEGMENTS.has(segments[0])) {
    reasons.push(`first segment "${segments[0]}" is neither src nor public`);
  }

  // Rule 7.
  if (extensionOf(path) === null) {
    reasons.push('extension is not in the allowlist');
  }

  // Rule 8.
  if (segments.length > MAX_DEPTH) {
    reasons.push(`is ${segments.length} segments deep (max ${MAX_DEPTH})`);
  }
  if (Buffer.byteLength(path, 'utf8') > MAX_BYTES) {
    reasons.push(`is ${Buffer.byteLength(path, 'utf8')} bytes (max ${MAX_BYTES})`);
  }

  return reasons;
}

// Rule 9 plus the §5 table's completeness and existence rows. `tree` is the set
// of tracked paths to validate against; `srcFiles` the tracked src/* files that
// must each be classified exactly once.
//
// TWO MODES, because this script ships into every creator's repository
// (vincentt-xr/v2-template#116). The manifest is the TEMPLATE's statement of
// what an upgrade may overwrite; a creator's own files are not in it and never
// will be, so a rule that refuses an unclassified src/* file is right in the
// template repo and wrong everywhere else — it failed a creator's CI on the
// first file they added, which is the normal case.
//
//   strict  (the template repo, and the release tag): every src/* file is
//           classified exactly once and every entry exists.
//   lenient (a creator's repo): the floor (rules 1-8) and the set rules still
//           apply to every entry — they bound what an upgrade may WRITE, which
//           protects the creator — but an unclassified src/* file is theirs by
//           definition, and a creator-zone entry they deleted is not a failure.
//           A platform entry missing from the tree still is: an upgrade would
//           rewrite it, which the creator should know before the tag moves.
export function validateManifest(manifest, tree, srcFiles, { strict = true } = {}) {
  const failures = [];

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest is not a JSON object'];
  }
  if (manifest.schema !== 1) {
    failures.push(`schema is ${JSON.stringify(manifest.schema)}, expected 1`);
  }
  for (const zone of ['platform', 'creator']) {
    if (!Array.isArray(manifest[zone])) {
      failures.push(`"${zone}" is missing or not an array`);
    }
  }
  const extraKeys = Object.keys(manifest).filter(
    (k) => !['schema', 'platform', 'creator'].includes(k),
  );
  if (extraKeys.length > 0) {
    failures.push(`unexpected keys: ${extraKeys.join(', ')}`);
  }
  if (failures.length > 0) return failures;

  const platform = manifest.platform;
  const creator = manifest.creator;
  const all = [...platform, ...creator];
  const zoned = [
    ...platform.map((e) => ['platform', e]),
    ...creator.map((e) => ['creator', e]),
  ];

  // Rule 9 — every entry passes 1-8.
  for (const [zone, entry] of zoned) {
    const reasons = checkEntry(entry, zone);
    for (const reason of reasons) {
      failures.push(`floor: ${zone} "${entry}" ${reason}`);
    }
  }

  // Rule 9 — no duplicate, no case-duplicate, arrays disjoint.
  const seen = new Map();
  for (const entry of all) {
    if (typeof entry !== 'string') continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      failures.push(
        seen.get(key) === entry
          ? `duplicate entry "${entry}"`
          : `case-duplicate entries "${seen.get(key)}" and "${entry}"`,
      );
    } else {
      seen.set(key, entry);
    }
  }
  const platformSet = new Set(platform.filter((e) => typeof e === 'string'));
  for (const entry of creator) {
    if (platformSet.has(entry)) {
      failures.push(`"${entry}" appears in both platform and creator`);
    }
  }

  // §5 table row 2 — every entry exists in the tagged tree. Lenient: a creator
  // may delete a file the template handed them (creator zone); a missing
  // platform entry is still reported.
  if (tree) {
    for (const [zone, entry] of zoned) {
      if (typeof entry !== 'string' || tree.has(entry)) continue;
      if (!strict && zone === 'creator') continue;
      failures.push(
        `"${entry}" is in the manifest but not in the tree` +
          (strict ? '' : ' — restore it, or expect the next template upgrade to rewrite it'),
      );
    }
  }

  // §5 table row 1 — every src/* in exactly one list; none unclassified.
  // Lenient: an unclassified src/* file is the creator's own.
  if (srcFiles && strict) {
    const classified = new Set(all.filter((e) => typeof e === 'string'));
    for (const file of srcFiles) {
      if (!classified.has(file)) {
        failures.push(`"${file}" is in src/ but classified in neither list`);
      }
    }
  }

  return failures;
}

/** The tracked src/* files the manifest does not name — in a creator's repo, theirs. */
export function unclassifiedSrcFiles(manifest, srcFiles) {
  const classified = new Set(
    [...(manifest.platform ?? []), ...(manifest.creator ?? [])].filter((e) => typeof e === 'string'),
  );
  return srcFiles.filter((f) => !classified.has(f));
}

function trackedFiles(cwd) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
  return out.split('\0').filter((f) => f.length > 0);
}

// §5 table row 4. release.yml accepts workflow_dispatch with an arbitrary ref and
// force-moves `latest`, so `latest` is a single-actor lever over the manifest
// every upgrade trusts. The manifest diff must never be buried in a content
// change: the human review of that diff is what the unicode and deny-name rules
// exist to protect.
//
// THE RULE IS "NOT BURIED IN A CONTENT CHANGE", NOT "ALONE IN A COMMIT", and the
// distinction is forced by how this repo merges. It is SQUASH-ONLY (merge commits
// and rebase are both disabled), so a branch that carefully puts the manifest in
// its own commit arrives on `main` as ONE commit containing everything. An
// own-commit rule is therefore unsatisfiable here by construction: it refused
// f17's own release, and it would refuse every future manifest edit the same way
// — which is worse than no rule, because a check that cannot pass gets deleted
// rather than fixed.
//
// What actually protects the review is narrower still, and the first attempt at
// this got it wrong in an instructive way. "The manifest must not move alongside
// any file it classifies" is ALSO unsatisfiable: adding a source file requires
// classifying it in the same change, or the completeness check above refuses the
// manifest for leaving it unlisted. Two rules that contradict each other on the
// ordinary case are worse than the single rule they replaced.
//
// The hazard is not a file being ADDED and classified — that is transparent, and
// the completeness check forces it. The hazard is an EXISTING file being MOVED
// BETWEEN ZONES in the same change that edits it: the zone flip is what decides
// whether an upgrade may overwrite a creator's file, and burying it under a
// content diff is how it escapes review. So the check compares the manifest
// against its own previous version and refuses only a REASSIGNMENT that rides
// along with an edit to the reassigned file.
function checkOwnCommit(cwd) {
  let sha;
  try {
    sha = execFileSync('git', ['log', '-1', '--format=%H', '--', MANIFEST], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    return [`could not read git history for ${MANIFEST}`];
  }
  if (!sha) return [`${MANIFEST} has no commit touching it`];

  const files = execFileSync(
    'git',
    ['show', '--name-only', '--format=', sha],
    { cwd, encoding: 'utf8' },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Read the manifest as it was BEFORE this commit. A first commit has no parent
  // version, so there is no reassignment to find and nothing to refuse.
  let previous;
  try {
    previous = JSON.parse(
      execFileSync('git', ['show', `${sha}~1:${MANIFEST}`], {
        cwd,
        encoding: 'utf8',
        // The FIRST commit introducing the manifest has no previous version, which
        // is the normal case rather than an error. Keep git's complaint off stderr
        // so a passing run says only that it passed.
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return [];
  }

  const zoneOf = (m, f) => {
    if ((m.platform ?? []).includes(f)) return 'platform';
    if ((m.creator ?? []).includes(f)) return 'creator';
    return undefined;
  };

  let current;
  try {
    current = JSON.parse(readFileSync(join(cwd, MANIFEST), 'utf8'));
  } catch {
    return [];
  }

  const touched = new Set(files);
  const buried = [];
  for (const f of new Set([...(previous.platform ?? []), ...(previous.creator ?? [])])) {
    const was = zoneOf(previous, f);
    const now = zoneOf(current, f);
    // A REASSIGNMENT (platform <-> creator) whose own file is edited in the same
    // commit. A removal is not a reassignment: `now` is undefined, and the
    // completeness check owns whether that is legal.
    if (was && now && was !== now && touched.has(f)) buried.push(`${f} (${was} -> ${now})`);
  }

  if (buried.length > 0) {
    return [
      `the commit that last touched ${MANIFEST} (${sha.slice(0, 8)}) MOVES ${buried.length} ` +
        `file(s) between zones while also editing them: ${buried.join(', ')}. A zone flip ` +
        `decides whether an upgrade may overwrite that file, so it is the one diff a human ` +
        `must review on its own. Land the reassignment separately from the content change.`,
    ];
  }
  return [];
}

// `--strict` (or ZONE_MANIFEST_STRICT=1) selects the template-repo mode. The
// workflows pass it only when `github.repository` is the template, so the same
// workflow file is strict at home and lenient in every creator's repo without
// the creator editing anything. The default is lenient: a bare run in an
// unknown checkout must not refuse the creator's own files.
function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict') || process.env.ZONE_MANIFEST_STRICT === '1';
  const cwdArg = args.find((a) => !a.startsWith('--'));
  const cwd = cwdArg ? resolve(cwdArg) : process.cwd();
  const manifestPath = join(cwd, MANIFEST);
  const skipCommitCheck = process.env.ZONE_MANIFEST_SKIP_COMMIT_CHECK === '1';

  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    console.error(`::error::${MANIFEST} is missing — the zone checks would pass with nothing checked.`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`::error file=${MANIFEST}::is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  let tree = null;
  let srcFiles = null;
  try {
    const files = trackedFiles(cwd);
    tree = new Set(files);
    srcFiles = files.filter((f) => f.startsWith('src/'));
  } catch (err) {
    console.error(`::error::could not list tracked files: ${err.message}`);
    process.exit(1);
  }

  const failures = validateManifest(manifest, tree, srcFiles, { strict });
  if (!skipCommitCheck) {
    failures.push(...checkOwnCommit(cwd));
  }

  if (failures.length > 0) {
    console.error(
      `::error file=${MANIFEST}::REFUSED — ${failures.length} failure(s). The whole manifest is refused; no entry is trusted.`,
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  const counts = `${manifest.platform.length} platform, ${manifest.creator.length} creator`;
  if (strict) {
    console.log(`${MANIFEST} OK — ${counts}; ${srcFiles.length} src/* files all classified exactly once.`);
  } else {
    const own = unclassifiedSrcFiles(manifest, srcFiles).length;
    console.log(
      `${MANIFEST} OK (lenient) — ${counts}; ${own} unlisted src/* file(s) treated as creator-owned. ` +
        `(In the template repo run with --strict.)`,
    );
  }
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).endsWith('check-zone-manifest.mjs');
if (invokedDirectly) {
  main();
}
