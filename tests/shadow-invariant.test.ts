import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('shadow update invariant', () => {
  it('only render/renderer.ts touches shadowMap.needsUpdate / autoUpdate', () => {
    const hits = walk(join(ROOT, 'src'))
      .filter((f) => /shadowMap\.(needsUpdate|autoUpdate)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual(['src/render/renderer.ts']);
  });

  it('markShadowsDirty is called only for init and piece moves', () => {
    const calls = walk(join(ROOT, 'src')).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/markShadowsDirty\(([^)]*)\)/g)].map((m) => m[1]!).filter((a) => !a.includes(':')), // skip the type signature
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) expect(["'init'", "'piece-move'", 'reason']).toContain(arg);
  });
});
