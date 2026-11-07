import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkEntry, unclassifiedSrcFiles, validateManifest } from './check-zone-manifest.mjs';

const ok = (path, zone) => checkEntry(path, zone).length === 0;

describe('floor rule 1 — NFC + ASCII-only', () => {
  it('accepts an ordinary ASCII path', () => {
    expect(ok('src/App.tsx')).toBe(true);
  });

  it('rejects a Cyrillic homoglyph that renders as src', () => {
    expect(ok('\u0455rc/App.tsx')).toBe(false);
  });

  it('rejects a division slash, which no segment rule would see', () => {
    expect(ok('src\u2215App.tsx')).toBe(false);
  });

  it('rejects an RTL override', () => {
    expect(ok('src/\u202eApp.tsx')).toBe(false);
  });

  it('rejects a trailing zero-width space', () => {
    expect(ok('src/App.tsx\u200b')).toBe(false);
  });

  it('rejects a non-breaking space', () => {
    expect(ok('src/App\u00a0.tsx')).toBe(false);
  });

  it('rejects a non-NFC form even when the composed form would be ASCII-clean', () => {
    expect(ok('src/Cafe\u0301.tsx')).toBe(false);
  });
});

describe('floor rule 2 — deny by name, before the zone lookup', () => {
  it('refuses src/Scene.tsx as a platform write target', () => {
    expect(ok('src/Scene.tsx', 'platform')).toBe(false);
  });

  it('permits src/Scene.tsx under creator, which asks for protection it already has', () => {
    expect(ok('src/Scene.tsx', 'creator')).toBe(true);
  });

  it.each(['AGENTS.md', 'GROUNDING.md', 'CLAUDE.md'])('refuses %s as platform', (name) => {
    expect(ok(name, 'platform')).toBe(false);
  });
});

describe('floor rule 3 — separators and bytes', () => {
  it.each([
    ['a backslash', 'src\\App.tsx'],
    ['a leading slash', '/src/App.tsx'],
    ['a drive letter', 'C:/src/App.tsx'],
    ['a percent', 'src/%2e%2e/App.tsx'],
    ['a control byte', 'src/App\u0001.tsx'],
    ['a lone high surrogate', 'src/App\ud800.tsx'],
    ['a lone low surrogate', 'src/App\udc00.tsx'],
  ])('rejects %s', (_label, path) => {
    expect(ok(path)).toBe(false);
  });
});

describe('floor rule 4 — segments', () => {
  it.each([
    ['an empty segment', 'src//App.tsx'],
    ['a dot segment', 'src/./App.tsx'],
    ['a dotdot segment', 'src/../App.tsx'],
  ])('rejects %s', (_label, path) => {
    expect(ok(path)).toBe(false);
  });

  it.each(['.env', '.npmrc', '.gitignore', '.eslintrc.json'])(
    'rejects the dotfile %s',
    (path) => {
      expect(ok(path)).toBe(false);
    },
  );

  it('rejects a dot-directory such as .github/workflows/release.yml', () => {
    expect(ok('.github/workflows/release.yml')).toBe(false);
  });
});

describe('floor rule 5 — node_modules', () => {
  it('rejects node_modules/.bin/esbuild, the binary the next build executes', () => {
    expect(ok('node_modules/.bin/esbuild')).toBe(false);
  });

  it('rejects node_modules even with a permitted extension', () => {
    expect(ok('node_modules/three/index.mjs')).toBe(false);
  });
});

describe('floor rule 6 — the top-level allowlist', () => {
  it.each(['index.html', 'package.json', 'vitest.config.ts', 'esbuild.config.mjs'])(
    'accepts the allowlisted root file %s',
    (path) => {
      expect(ok(path)).toBe(true);
    },
  );

  it('rejects pnpm-lock.yaml by absence from the allowlist', () => {
    expect(ok('pnpm-lock.yaml')).toBe(false);
  });

  it('rejects an unlisted root file with a permitted extension', () => {
    expect(ok('PLAN.md')).toBe(false);
    expect(ok('postcss.config.mjs')).toBe(false);
  });

  it('accepts src and public as first segments', () => {
    expect(ok('src/App.tsx')).toBe(true);
    expect(ok('public/fonts/Poppins_Regular.json')).toBe(true);
  });

  it('rejects scripts/, which executes on the creator machine', () => {
    expect(ok('scripts/build.mjs')).toBe(false);
  });
});

describe('floor rule 7 — extensions', () => {
  it('accepts .d.ts via longest-match rather than treating it as .ts', () => {
    expect(ok('src/vite-env.d.ts')).toBe(true);
  });

  it.each([
    'src/config.yaml',
    'src/config.yml',
    'src/postinstall.sh',
    'src/Makefile',
  ])('rejects %s', (path) => {
    expect(ok(path)).toBe(false);
  });
});

describe('floor rule 8 — bounds', () => {
  it('accepts depth 4', () => {
    expect(ok('src/a/b/c.tsx')).toBe(true);
  });

  it('rejects depth 5', () => {
    expect(ok('src/a/b/c/d.tsx')).toBe(false);
  });

  it('rejects a path over 256 bytes', () => {
    expect(ok(`src/${'a'.repeat(260)}.tsx`)).toBe(false);
  });
});

describe('rule 9 — set level, and one failure refuses the whole manifest', () => {
  const tree = new Set(['src/App.tsx', 'src/Scene.tsx', 'src/main.tsx', 'index.html']);
  const srcFiles = ['src/App.tsx', 'src/Scene.tsx', 'src/main.tsx'];
  const base = {
    schema: 1,
    platform: ['src/App.tsx', 'src/main.tsx'],
    creator: ['src/Scene.tsx'],
  };

  it('accepts a complete, floor-clean manifest', () => {
    expect(validateManifest(base, tree, srcFiles)).toEqual([]);
  });

  it('rejects a duplicate', () => {
    const m = { ...base, platform: [...base.platform, 'src/App.tsx'] };
    expect(validateManifest(m, tree, srcFiles)).toContainEqual(
      expect.stringContaining('duplicate entry'),
    );
  });

  it('rejects a case-duplicate', () => {
    const m = { ...base, platform: [...base.platform, 'src/app.tsx'] };
    expect(validateManifest(m, tree, srcFiles)).toContainEqual(
      expect.stringContaining('case-duplicate'),
    );
  });

  it('rejects arrays that are not disjoint', () => {
    const m = { ...base, creator: [...base.creator, 'src/App.tsx'] };
    expect(validateManifest(m, tree, srcFiles)).toContainEqual(
      expect.stringContaining('appears in both platform and creator'),
    );
  });

  it('rejects an entry absent from the tree', () => {
    const m = { ...base, platform: [...base.platform, 'src/ghost.tsx'] };
    expect(validateManifest(m, tree, srcFiles)).toContainEqual(
      expect.stringContaining('not in the tree'),
    );
  });

  it('rejects an unclassified src file', () => {
    const m = { ...base, platform: ['src/App.tsx'] };
    expect(validateManifest(m, tree, srcFiles)).toContainEqual(
      expect.stringContaining('classified in neither list'),
    );
  });

  it('refuses the WHOLE manifest for one hostile entry behind twenty good ones', () => {
    const twentyGood = Array.from({ length: 20 }, (_, i) => `src/good${i}.tsx`);
    const bigTree = new Set([...twentyGood, 'src/Scene.tsx']);
    const m = {
      schema: 1,
      platform: [...twentyGood, 'src/../../../etc/passwd'],
      creator: ['src/Scene.tsx'],
    };
    const failures = validateManifest(m, bigTree, [...twentyGood, 'src/Scene.tsx']);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((f) => !f.includes('src/good'))).toBe(true);
  });

  it('rejects an unknown schema', () => {
    expect(validateManifest({ ...base, schema: 2 }, tree, srcFiles)).toContainEqual(
      expect.stringContaining('schema is 2'),
    );
  });

  it('rejects a missing zone array', () => {
    expect(validateManifest({ schema: 1, platform: [] }, tree, srcFiles)).toContainEqual(
      expect.stringContaining('"creator" is missing'),
    );
  });

  it('rejects unexpected top-level keys, so a glob key cannot slip in', () => {
    const m = { ...base, platformGlobs: ['src/**'] };
    expect(validateManifest(m, tree, srcFiles)).toContainEqual(
      expect.stringContaining('unexpected keys'),
    );
  });

  it('rejects a non-string entry rather than coercing it', () => {
    const m = { ...base, platform: [...base.platform, 42] };
    expect(validateManifest(m, tree, srcFiles).length).toBeGreaterThan(0);
  });
});

describe("lenient mode — a creator's repository (#116)", () => {
  const tree = new Set(['src/App.tsx', 'src/Scene.tsx', 'src/main.tsx', 'src/magnetic/field.tsx']);
  const srcFiles = ['src/App.tsx', 'src/Scene.tsx', 'src/main.tsx', 'src/magnetic/field.tsx'];
  const base = {
    schema: 1,
    platform: ['src/App.tsx', 'src/main.tsx'],
    creator: ['src/Scene.tsx'],
  };
  const lenient = { strict: false };

  it('strict is the default, so an unclassified file is still refused by a bare call', () => {
    expect(validateManifest(base, tree, srcFiles)).toContainEqual(
      expect.stringContaining('classified in neither list'),
    );
  });

  it("accepts a creator's own unclassified src file", () => {
    expect(validateManifest(base, tree, srcFiles, lenient)).toEqual([]);
    expect(unclassifiedSrcFiles(base, srcFiles)).toEqual(['src/magnetic/field.tsx']);
  });

  it('accepts a creator-zone entry the creator deleted', () => {
    const pruned = new Set([...tree].filter((f) => f !== 'src/Scene.tsx'));
    expect(validateManifest(base, pruned, srcFiles, lenient)).toEqual([]);
    expect(validateManifest(base, pruned, srcFiles)).toContainEqual(
      expect.stringContaining('"src/Scene.tsx" is in the manifest but not in the tree'),
    );
  });

  it('still reports a platform entry missing from the tree', () => {
    const pruned = new Set([...tree].filter((f) => f !== 'src/main.tsx'));
    expect(validateManifest(base, pruned, srcFiles, lenient)).toContainEqual(
      expect.stringContaining('"src/main.tsx" is in the manifest but not in the tree'),
    );
  });

  it('still refuses the floor and the set rules — they bound what an upgrade may write', () => {
    const hostile = { ...base, platform: [...base.platform, 'src/../../etc/passwd'] };
    expect(validateManifest(hostile, tree, srcFiles, lenient).length).toBeGreaterThan(0);
    const dup = { ...base, creator: [...base.creator, 'src/App.tsx'] };
    expect(validateManifest(dup, tree, srcFiles, lenient)).toContainEqual(
      expect.stringContaining('appears in both platform and creator'),
    );
    const sceneAsPlatform = { ...base, platform: [...base.platform, 'src/Scene.tsx'], creator: [] };
    expect(validateManifest(sceneAsPlatform, tree, srcFiles, lenient)).toContainEqual(
      expect.stringContaining('denied by name'),
    );
  });
});

describe('the shipped manifest', () => {
  const loadManifest = () =>
    JSON.parse(readFileSync(join(process.cwd(), '.vincentt-template.json'), 'utf8'));

  it('classifies Scene.tsx as creator and never as platform', () => {
    const manifest = loadManifest();
    expect(manifest.creator).toContain('src/Scene.tsx');
    expect(manifest.platform).not.toContain('src/Scene.tsx');
  });

  it('lists the shipped test files as platform', () => {
    const manifest = loadManifest();
    for (const f of [
      'src/framed.test.ts',
      'src/mediaSourceBinder.test.tsx',
      'src/mediaSourceControl.test.tsx',
      'src/renderHold.test.tsx',
      'src/qa.f13-g11-g14.test.tsx',
      'src/qa.f13-g13-treeshake.test.ts',
      'src/qa_f13_g45_render_hold.test.tsx',
    ]) {
      expect(manifest.platform).toContain(f);
    }
  });

  it('contains no scripts/ entry — they are reported not-upgradable, not classified', () => {
    const manifest = loadManifest();
    const all = [...manifest.platform, ...manifest.creator];
    expect(all.filter((e) => e.startsWith('scripts/'))).toEqual([]);
  });
});
