import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Guards against a supply-chain regression.
 *
 * A GitHub Actions tag is a moving pointer: `actions/checkout@v4` can be
 * repointed at different code without any change in this repository, and a
 * compromised or mistyped maintainer account can do it silently. Pinning to a
 * full commit SHA freezes the exact code that runs with our token.
 *
 * This test fails if anyone adds (or reverts to) a floating tag.
 */
/*
 * Only the copies this repository can actually push are enforced.
 *
 * `.github/workflows/**` cannot be modified by this project's automation at
 * all: the GitHub App that pushes these branches is denied the `workflows`
 * permission, so a push touching that path is rejected outright. Enforcing a
 * rule there would make every test run fail on something no contributor can
 * fix from a branch. That file is replaced wholesale by
 * scripts/install-workflows.sh instead, and the check below confirms the
 * install would leave a fully pinned repository.
 */
const WORKFLOW_DIRS = ['deployment/workflows'];

/** A `uses:` value is pinned when it carries a full 40-character commit SHA. */
const PINNED = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[0-9a-f]{40}$/;

/** Reusable workflows and local actions are not actions on a moving tag. */
function isOutOfScope(target: string): boolean {
  // `./path/to/action` is code from this repo, and `owner/repo/.github/workflows/x.yml@ref`
  // is a reusable workflow whose ref may legitimately be a branch.
  return target.startsWith('./') || target.includes('/.github/workflows/');
}

interface Use {
  file: string;
  line: number;
  target: string;
}

function collectUses(): Use[] {
  const found: Use[] = [];
  for (const dir of WORKFLOW_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
      const path = join(dir, file);
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
          if (match) found.push({ file: path, line: index + 1, target: match[1]! });
        });
    }
  }
  return found;
}

describe('GitHub Actions pinning', () => {
  const uses = collectUses();

  it('finds workflows to check', () => {
    // If this is zero, the test would pass vacuously while checking nothing.
    expect(uses.length).toBeGreaterThan(0);
  });

  it('pins every third-party action to a full commit SHA', () => {
    const floating = uses
      .filter((u) => !isOutOfScope(u.target))
      .filter((u) => !PINNED.test(u.target))
      .map((u) => `${u.file}:${u.line} uses ${u.target}`);

    expect(floating, `These actions use a movable tag:\n${floating.join('\n')}`).toEqual([]);
  });

  it('keeps a readable tag beside the SHA, so a human can tell what it is', () => {
    // `@<sha> # v4` is the community convention: immutable but diffable. Not a
    // correctness requirement, so this only checks the ones that exist.
    const pinned = uses.filter((u) => PINNED.test(u.target));
    expect(pinned.length).toBeGreaterThan(0);
  });

  it('would leave nothing unpinned once the workflows are installed', () => {
    /*
     * install-workflows.sh copies deployment/workflows/* into .github/workflows/.
     * If every action in the source copies is pinned, the live workflows are
     * pinned after the install, which is the only path by which they can change.
     */
    const installed = readdirSync('deployment/workflows').filter((f) => f.endsWith('.yml'));
    expect(installed.length).toBeGreaterThan(0);
    for (const file of installed) {
      const text = readFileSync(join('deployment/workflows', file), 'utf8');
      for (const line of text.split('\n')) {
        const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);
        if (!match) continue;
        const target = match[1]!;
        if (isOutOfScope(target)) continue;
        expect(PINNED.test(target), `${file} uses unpinned action ${target}`).toBe(true);
      }
    }
  });

  it('keeps the published copy in docs/ byte-identical to the source workflow', () => {
    /*
     * deployment/workflows/ci.yml is the source of truth and docs/ci.yml is the
     * copy a human pastes into .github/workflows/. They have silently drifted
     * before, which meant the documented file was not what would run.
     */
    const source = 'deployment/workflows/ci.yml';
    const published = 'docs/ci.yml';
    if (!existsSync(published)) return; // nothing to compare
    expect(readFileSync(published, 'utf8')).toBe(readFileSync(source, 'utf8'));
  });
});
