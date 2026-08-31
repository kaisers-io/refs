import type { ResolveData, ResolveOptions } from './resolve-run.ts';
import { cliOptsOf, emit, wrapAction } from '../output.ts';
import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { packageLines } from './resolve-package.ts';
import { runResolve } from './resolve-run.ts';
import { statusLines } from './ref-status.ts';
// `refs resolve <query>` — the agent-routing command, and the first call an agent makes for any
// question about a dependency's source. Turns a git url, an exact npm package name, an import path,
// or a unique ref-key suffix into the one ref (and, where applicable, the one package within it)
// the query denotes. The routing precedence itself lives in `resolve-route.ts`; this file is the
// command: what it reports, and how it renders.

// Key/value lines mirroring show.ts's showHuman. The two paths get distinct keys — `path` for
// the ref checkout, `package path` for the package inside it — so neither depends on position to
// be understood; the ordering only helps the eye.
const resolveHuman = (data: ResolveData, now: number): string[] => {
  const lines = [
    `ref: ${data.key}`,
    `path: ${data.local_path}`,
    ...statusLines({
      lastFetchedAt: data.last_fetched_at,
      missing: data.missing,
      now,
      stale: data.stale,
    }),
    // `managed` stays silent: the ordinary case reads exactly as it did before this check existed.
    // Anything else changes what the path MEANS, and a reader who cannot see that difference is the
    // failure the check was added to prevent.
    ...(data.checkout.status === 'managed' || data.checkout.status === 'missing'
      ? []
      : [
          `checkout: ${data.checkout.status}${data.checkout.reason === undefined ? '' : ` (${data.checkout.reason})`}`,
        ]),
  ];
  if (data.package !== null) {
    lines.push(...packageLines(data.package));
  }
  if (data.sync !== undefined) {
    lines.push(`sync: ${data.sync.status}`);
  }
  if (data.installed !== undefined) {
    lines.push(
      `installed: ${data.installed.version ?? `(${data.installed.status})`}`,
      ...(data.installed.name === undefined ? [] : [`installed name: ${data.installed.name}`]),
      ...(data.installed.reason === undefined
        ? []
        : [`installed reason: ${data.installed.reason}`]),
    );
  }
  return lines;
};

// `exactOptionalPropertyTypes` forbids assigning a possibly-`undefined` value onto an optional
// property — mirrors `tag.ts`'s `buildTagOptions`.
const buildResolveOptions = (
  query: string,
  now: number,
  localOpts: { project?: string; ref?: string; syncIfStale?: boolean },
): ResolveOptions => ({
  now,
  ...(localOpts.project === undefined ? {} : { project: localOpts.project }),
  query,
  ...(localOpts.ref === undefined ? {} : { ref: localOpts.ref }),
  ...(localOpts.syncIfStale === true ? { syncIfStale: true } : {}),
});

const registerResolve = (program: RefsCommand, ctx: CliContext): void => {
  program
    .command('resolve')
    .description(
      'Resolve a git url, npm package name, import path, or ref-key suffix to its ref/package.',
    )
    .argument('<query>', 'git url, npm package name, import path, or unique ref-key suffix')
    .option(
      '--ref <ref>',
      'resolve the query as a package within this ref (full key or unique suffix)',
    )
    .option(
      '--project <dir>',
      "report the version this project has installed of the query's package",
    )
    .option(
      '--sync-if-stale',
      'fetch or clone first when the ref is stale or its checkout is absent',
    )
    .action((query, localOpts, command) => {
      const opts = cliOptsOf(command);
      return wrapAction(ctx, opts, async () => {
        const now = Date.now();
        const data = await runResolve(ctx, buildResolveOptions(query, now, localOpts));
        emit(ctx, opts, resolveHuman(data, now), data);
      })();
    });
};

export { registerResolve, resolveHuman };
