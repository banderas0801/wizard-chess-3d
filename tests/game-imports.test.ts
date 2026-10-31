import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ESLint } from 'eslint';

const ROOT = join(import.meta.dirname, '..');
const GAME = join(ROOT, 'src', 'game');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : [];
  });
}

const IMPORT_THREE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]three(?:\/[^'"]*)?['"]/;

describe('src/game must not import three', () => {
  it('grep: no file in src/game references three', () => {
    const files = walk(GAME);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => IMPORT_THREE.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('eslint config actually rejects three imports under src/game', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const bad = [
      "import * as THREE from 'three';\nexport const x = THREE;\n",
      "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\nexport const y = OrbitControls;\n",
    ];
    for (const code of bad) {
      const [res] = await eslint.lintText(code, { filePath: join(GAME, '__probe__.ts') });
      expect(res!.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
    }
    // Same import outside src/game is allowed.
    const [ok] = await eslint.lintText(bad[0]!, { filePath: join(ROOT, 'src', 'render', '__probe__.ts') });
    expect(ok!.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
});
