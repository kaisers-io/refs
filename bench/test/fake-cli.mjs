// Scripted subprocess seam for unit tests — mirrors the main repo's `proc` pattern.
// Records every call and returns a fixed { code, stderr, stdout } script.
export class FakeCli {
  constructor(script) {
    this.script = script;
    this.calls = [];
  }

  exec(cmd, args, opts) {
    this.calls.push({ args, cmd, opts });
    return Promise.resolve(this.script);
  }
}
