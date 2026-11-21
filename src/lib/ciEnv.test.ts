import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Guards the CI workflow against silently disabling the Supabase configuration.
 *
 * The failure this exists for: `ci.yml` mapped the repository variables
 * straight onto the build environment.
 *
 *     env:
 *       VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
 *
 * With no repository variable set -- the default for a fresh clone -- that
 * expands to the empty string. Vite does not ignore an empty env var: it
 * treats it as set and inlines `""`, which overrides the real value in
 * .env.production. The resulting bundle has no Supabase URL, the following
 * "bundle must contain a real configuration" step correctly rejects it, and
 * the job fails on every run for everyone. A workflow that always fails is
 * worse than no workflow: nobody reads it after the first red build.
 *
 * The rule below is narrow on purpose. It does not require a particular fix,
 * it forbids the specific construct that cannot work: handing a possibly-empty
 * value to the build under a `VITE_` name. There is no expression form that
 * avoids this -- `${{ vars.X || '' }}` still defines the variable, and an
 * `&&`/`||` chain is only a fallback *to* empty -- so the only correct shape is
 * to leave the name undefined and let Vite read .env.production, optionally
 * exporting a real override from inside the run step.
 */

const WORKFLOWS = ['deployment/workflows/ci.yml', 'docs/ci.yml'].filter((p) => existsSync(p));

interface BuildEnv {
  file: string;
  name: string;
  value: string;
  line: number;
}

/** Finds `VITE_*` keys in any `env:` block that set a value from an expression. */
function viteKeysFromExpressions(): BuildEnv[] {
  const found: BuildEnv[] = [];
  for (const file of WORKFLOWS) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // `VITE_SOMETHING: ${{ ... }}` or `VITE_SOMETHING: ${{ ... }} ...`
      const match = /^\s+(VITE_[A-Z0-9_]+):\s*(.*\$\{\{.*)$/.exec(line);
      if (!match) return;
      found.push({ file, name: match[1]!, value: match[2]!.trim(), line: index + 1 });
    });
  }
  return found;
}

describe('CI build environment', () => {
  it('has workflows to inspect', () => {
    // Guards against the checks below passing vacuously.
    expect(WORKFLOWS.length).toBeGreaterThan(0);
  });

  it('never passes a possibly-empty repository variable to the build as VITE_*', () => {
    /*
     * `${{ vars.X }}` and `${{ vars.X && vars.X || '' }}` both produce a
     * defined-but-empty variable when unset, which Vite inlines over
     * .env.production. VITE_BASE_PATH is exempt because it is derived from the
     * repository name, which always exists -- it cannot be empty.
     */
    const offenders = viteKeysFromExpressions()
      .filter((entry) => entry.name !== 'VITE_BASE_PATH')
      .map((entry) => `${entry.file}:${entry.line} ${entry.name}: ${entry.value}`);

    expect(
      offenders,
      `These map a possibly-empty value onto a VITE_ variable. An unset repository\n` +
        `variable expands to "", Vite treats that as set and inlines it over\n` +
        `.env.production, and the bundle loses its Supabase configuration:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('still allows a deliberate override from the run step', () => {
    /*
     * The property above forbids the broken construct, not the feature. An
     * override that is only exported when non-empty is correct, and this test
     * fails if someone removes the capability while "fixing" the bug -- which
     * is a real risk, since deleting the mapping is the simplest way to make
     * the previous test pass.
     */
    const ci = readFileSync('deployment/workflows/ci.yml', 'utf8');
    expect(
      ci.includes('OVERRIDE_SUPABASE_URL'),
      'the override path disappeared; .env.production is now the only source, which may be intentional but changes documented behaviour',
    ).toBe(true);
    // The override must be conditional: exported only when the variable is set.
    expect(/if \[ -n "\$OVERRIDE_SUPABASE_URL" \]/.test(ci)).toBe(true);
  });

  it('lets .env.production be the source when no override is set', () => {
    const ci = readFileSync('deployment/workflows/ci.yml', 'utf8');
    const buildStep = ci.slice(ci.indexOf('Production build'), ci.indexOf('bundle must contain'));
    const envBlock = buildStep.slice(buildStep.indexOf('env:'), buildStep.indexOf('run:'));
    /*
     * Match on the KEY position, not a substring: `OVERRIDE_SUPABASE_URL` is a
     * legitimate mapping whose value happens to mention VITE_SUPABASE_URL in
     * the comment above it. What matters is that no `VITE_` name is *defined*
     * in the env mapping, because defining it is what overrides .env.production.
     */
    const definedViteKeys = [...envBlock.matchAll(/^\s+(VITE_[A-Z0-9_]+):/gm)].map((m) => m[1]!);
    expect(definedViteKeys).toEqual(['VITE_BASE_PATH']);
  });

  it('ships a .env.production for Vite to fall back to', () => {
    // If this file vanished, dropping the env mapping would leave no
    // configuration at all and the build would be broken in a new way.
    const env = readFileSync('.env.production', 'utf8');
    expect(env).toMatch(/^VITE_SUPABASE_URL=\S+/m);
    expect(env).toMatch(/^VITE_SUPABASE_PUBLISHABLE_KEY=\S+/m);
  });
});
