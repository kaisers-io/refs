#!/usr/bin/env node
// Replay postflight for a kept workspace. This never starts a model or executes answer text.
import { hasBehavior, verifyBehavior } from './behavior.mjs';
import { parseArgs } from 'node:util';

const JSON_INDENT = 2;
const { values } = parseArgs({ options: { case: { type: 'string' }, cwd: { type: 'string' } } });
if (!hasBehavior(values.case) || !values.cwd) {
  throw new Error(
    'usage: node scripts/skill-evals/verify-behavior.mjs --case <behavior-case> --cwd <kept-workspace>',
  );
}
const results = await verifyBehavior(values.case, values.cwd);
console.log(
  JSON.stringify(
    { case: values.case, checks: results, passed: results.every(({ passed }) => passed) },
    undefined,
    JSON_INDENT,
  ),
);
process.exitCode = results.every(({ passed }) => passed) ? 0 : 1;
