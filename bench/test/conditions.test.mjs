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
    expect(full.slice(discipline.length)).toContain('refs search');
  });
});
