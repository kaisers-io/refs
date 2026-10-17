import type { RunResult } from './runner.ts';

// Git parses the syntax; this parser only decodes its lossless, NUL-delimited record framing.
// Values may contain newlines. Config subsection names may contain '=' and non-ASCII text.
type ConfigEntry = { key: string; value: string | undefined; origin: string };
type GitConfigRun = (args: readonly string[]) => Promise<RunResult>;

const MAX_CONFIG_BYTES = 1_048_576;
const ORIGIN_RECORD_WIDTH = 2;
const NO_SEPARATOR = -1;
const CONFIG_FAILURE = 'Git configuration cannot be safely inventoried';

const configFailure = (): Error => new Error(CONFIG_FAILURE);

const checkedConfigOutput = (result: RunResult): string => {
  if (
    result.exitCode !== 0 ||
    result.stdoutTruncated === true ||
    result.timedOut === true ||
    result.stdout.includes('\uFFFD') ||
    Buffer.byteLength(result.stdout) > MAX_CONFIG_BYTES
  ) {
    throw configFailure();
  }
  return result.stdout;
};

const decodeEntry = (origin: string, record: string): ConfigEntry => {
  const separator = record.indexOf('\n');
  const key = separator === NO_SEPARATOR ? record : record.slice(0, separator);
  if (!key.includes('.') || (!origin.startsWith('file:') && origin !== 'command line:')) {
    throw configFailure();
  }
  return {
    key,
    origin,
    value: separator === NO_SEPARATOR ? undefined : record.slice(separator + 1),
  };
};

const decodeFields = (fields: readonly string[]): ConfigEntry[] => {
  const entries: ConfigEntry[] = [];
  for (let index = 0; index < fields.length; index += ORIGIN_RECORD_WIDTH) {
    const origin = fields[index];
    const record = fields[index + 1];
    if (origin === undefined || record === undefined) {
      throw configFailure();
    }
    entries.push(decodeEntry(origin, record));
  }
  return entries;
};

const parseConfigRecords = (result: RunResult): ConfigEntry[] => {
  const output = checkedConfigOutput(result);
  if (output === '') {
    return [];
  }
  const fields = output.split('\0');
  if (fields.pop() !== '' || fields.length % ORIGIN_RECORD_WIDTH !== 0) {
    throw configFailure();
  }
  return decodeFields(fields);
};

export { checkedConfigOutput, configFailure, parseConfigRecords };
export type { ConfigEntry, GitConfigRun };
