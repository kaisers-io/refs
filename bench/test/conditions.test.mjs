import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../pilot/conditions/${name}`, import.meta.url), 'utf8');

describe('condition preambles', () => {
  it('all three exist and are non-empty', async () => {
    const texts = await Promise.all(
      ['naive.md', 'discipline.md', 'full.md'].map((name) => read(name)),
    );
    for (const text of texts) {
      expect(text.trim()).not.toBe('');
    }
  });

  it('full is discipline plus only the refs section (rung 2/3 equivalence)', async () => {
    const disciplineText = await read('discipline.md');
    const discipline = disciplineText.trim();
    const full = await read('full.md');
    expect(full.startsWith(discipline)).toBe(true);
    const appended = full.slice(discipline.length);
    expect(appended).toContain('refs search <ref>');
    expect(appended).toContain('refs range <ref>');
  });

  it('full is self-contained — no need to read external refs skill docs', async () => {
    const disciplineText = await read('discipline.md');
    const discipline = disciplineText.trim();
    const full = await read('full.md');
    const appended = full.slice(discipline.length);
    expect(appended).toContain('refs search github.com/colinhacks/zod "widget" --json');
    expect(appended).toContain('refs range github.com/colinhacks/zod 3.24.1 4.0.1 --json');
    expect(appended).not.toMatch(/investigate\.md|SKILL\.md|\.agents\/skills/u);
  });
});
