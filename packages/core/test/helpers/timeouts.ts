// Timeout for the tests that shell out to real `git` or spawn real child processes: building a
// fixture repository, cloning it, syncing it. Their wall-clock tracks how busy the machine is
// rather than how much work they do — the slowest measures ~4s run serially, ~11s under its own
// suite's parallelism, and up to 29s under the full suite on a ten-core box. That last figure was
// 982ms short of the 30s each of these files used to declare for itself, and it had already
// produced an intermittent failure.
//
// Sixty seconds is generous on purpose: what it guards against is a false red on a healthy suite,
// and the cost of it being high is only that a genuinely hung test takes longer to report. It is
// applied test by test, exactly where the old per-file constants were, so nothing that does not do
// this kind of I/O gives up the short global timeout from `vitest.shared.ts`.
//
// Duplicated across the two packages rather than shared over the package boundary, matching how
// the other test helpers here stay self-contained.
const SLOW_IO_TIMEOUT_MS = 60_000;

export { SLOW_IO_TIMEOUT_MS };
