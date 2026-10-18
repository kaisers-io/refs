import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

// refs clones and reads; it never runs a reference. The CLI enforces that for its own git
// (SECURITY.md); for the agent it is an instruction, and these cases keep the instruction in every
// place an agent or a worker reads before touching a checkout.

const SKILL = new URL('../../../skills/refs/', import.meta.url);
const read = (name: string): Promise<string> => readFile(new URL(name, SKILL), 'utf8');

/** The text of `## <heading>` up to the next `## `. */
const section = (text: string, heading: string): string => {
  const start = text.indexOf(`\n## ${heading}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end);
};

describe('the skill on running reference code', () => {
  it('forbids it in the read-only invariant, with the refusal rule beside it', async () => {
    expect.hasAssertions();
    const invariant = section(await read('SKILL.md'), '3. Read-only invariant');
    expect(invariant).toContain('**Never run reference code.**');
    expect(invariant).toMatch(/install\s+its dependencies/u);
    expect(invariant).toContain('**A refs safety refusal is final for that operation.**');
    expect(invariant).toMatch(/Do not\s+retry with raw git/u);
  });

  it('makes it a hard rule of an investigation', async () => {
    expect.hasAssertions();
    const rules = section(await read('INVESTIGATE.md'), 'Hard rules (always)');
    expect(rules).toMatch(/1\. \*\*Never mutate or run a reference checkout\.\*\*/u);
    expect(rules).toMatch(/never install its dependencies or run its code/u);
  });

  it('puts it in the brief every description worker gets', async () => {
    expect.hasAssertions();
    const add = await read('ADD.md');
    expect(add).toMatch(/Hand every worker the trust boundary[^]*?no running the repo's code/u);
  });
});
