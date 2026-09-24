import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GUIDE_SECTIONS, INTRO_SLIDES, TOUR_STEPS } from '@/education/model';

/**
 * WHY THIS GUARD EXISTS.
 *
 * A guided tour's failure mode is cruel: it still opens, still says "1 of 10", and
 * points at nothing — or worse, at whatever happens to be at those coordinates. The
 * only durable defence is to make the *build* fail when a step's target stops
 * existing, which is what these cases do. They are deliberately text-level checks
 * against the real source: a `data-tour` anchor cannot be faked into existence by a
 * mock, and a step whose route no longer exists stops the build rather than waiting
 * for a human to find it on a phone.
 *
 * Both detectors below were verified non-vacuous by removing one anchor and one
 * route and watching the corresponding case fail.
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), 'utf8');

/**
 * Anchors that exist in the *consuming* source, in the three shapes the app uses:
 *
 *   data-tour="home:kpis"        on a real element the tour rings directly
 *   anchor="more:guide"          handed to `ListRow`, which renders it as `data-tour`
 *   anchor: "more:customers"     the same, on a row built from a data array
 *
 * `src/education/` is excluded on purpose: the model declares the anchors it wants,
 * so counting that file would make this case compare the model against itself — the
 * vacuous version of the check it is supposed to be.
 */
function literalAnchors(): Set<string> {
  const found = new Set<string>();
  const modelDir = path.resolve(ROOT, 'src/education');
  for (const file of walk(path.resolve(ROOT, 'src'))) {
    if (file.startsWith(modelDir)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/data-tour="([^"]+)"/g)) found.add(match[1]);
    for (const match of source.matchAll(/\banchor[=:]\s*"([^"]+)"/g)) found.add(match[1]);
  }
  return found;
}

/** The tab bar builds its anchors from the tab key, so they are checked structurally. */
const TAB_TEMPLATE = 'data-tour={`tab:${key}`}';

function tabKeyExists(anchor: string): boolean {
  const suffix = anchor.slice('tab:'.length);
  return ['src/components/layout/AdminLayout.tsx', 'src/components/layout/EmployeeLayout.tsx'].some((file) => {
    const source = read(file);
    if (!source.includes(TAB_TEMPLATE)) return false;
    return source.includes(`key: "${suffix}"`);
  });
}

describe('education — the tour points only at real UI', () => {
  it('every step anchor exists in the code, literal or template-built', () => {
    const literals = literalAnchors();
    const missing = TOUR_STEPS.filter((step) => {
      if (step.anchor.startsWith('tab:')) return !tabKeyExists(step.anchor);
      return !literals.has(step.anchor);
    }).map((step) => `${step.id} → data-tour="${step.anchor}"`);

    expect(
      missing,
      'a tour step whose element does not exist would point at nothing — add the data-tour attribute to the real element or drop the step',
    ).toEqual([]);
  });

  it('every step route is a route the shell actually serves', () => {
    const router = read('src/router/index.tsx');
    const missing = TOUR_STEPS.filter((step) => !router.includes(`path: "${step.route.replace(/^\//, '')}"`)).map(
      (step) => `${step.id} → ${step.route}`,
    );

    expect(missing, 'a step on a route that does not exist would navigate into a blank screen').toEqual([]);
  });

  it('every stem the education system renders is a dictionary key, not a sentence', () => {
    const keys = [
      ...TOUR_STEPS.flatMap((s) => [s.titleKey, s.bodyKey]),
      ...GUIDE_SECTIONS.flatMap((s) => [s.titleKey, s.bodyKey]),
      ...INTRO_SLIDES.flatMap((s) => [s.titleKey, s.bodyKey]),
    ];
    const notKeys = keys.filter((k) => !k.startsWith('edu.'));
    expect(notKeys, 'education copy must be addressed by edu.* dictionary keys so EN and UR both exist').toEqual([]);
  });

  it('no education component ships English of its own', () => {
    const files = walk(path.resolve(ROOT, 'src')).filter((f) => /education|onboarding|AppGuidePage/.test(f));
    const offenders: string[] = [];

    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      read(rel).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments explain; they do not render
        // A user-facing literal is text inside JSX or a string that is not a key,
        // a class, a route, an attribute value or an identifier.
        const jsxText = /<[A-Za-z][^>]*>\s*([A-Za-z][A-Za-z ,'!?-]{4,})\s*</.exec(line);
        if (jsxText) offenders.push(`${rel}:${i + 1} ${jsxText[1].slice(0, 60)}`);
      });
    }

    expect(offenders, 'every sentence a shop owner reads comes from the dictionary, in both languages').toEqual([]);
  });
});
