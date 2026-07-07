# Onboard — first-time setup and orientation

Use this flow when the user is new to refs ("onboard me", "set up refs", "what is
refs", "getting started"). Verify the setup end-to-end, show what refs can do with
copyable example prompts, and end with a concrete first ref to add.

## 1. Verify the CLI

Run the capability gate from `SKILL.md` §1, including its install flow if the CLI is
missing (ask before installing; verify with `refs --version` afterwards).

## 2. Health check

```bash
refs doctor --json
```

Report every non-`ok` check in plain terms (`references/maintain.md` explains each
check) and offer to fix what can be fixed. A failing `config` check on a fresh machine
is expected — that's what the next step is for.

## 3. Initialize

If doctor shows the config/home is missing, explain what `refs init` creates (the refs
home directory, `config.toml`, and the git hooks guard — nothing outside the refs
home), then propose running it. Never run it unprompted.

```bash
refs init --json
```

Re-run `refs doctor --json` afterwards and confirm the setup is green.

## 4. What refs can do

Explain the three jobs in a sentence or two each, then show these prompts verbatim as
fenced, copyable blocks:

- **Add** — start tracking a repo as a local, read-only checkout:

  ```
  Add zod as a ref
  ```

- **Investigate** — answer questions from the real docs and source:

  ```
  Look at zod's docs in my refs — how does the codec schema type work?
  ```

  ```
  How does zod implement z.codec() under the hood?
  ```

- **Compare versions** — read the actual history between releases:

  ```
  What changed between zod v4.0.0 and v4.1.0?
  ```

## 5. Propose a first ref

Look at the current project's dependency manifests (`package.json` or the ecosystem
equivalent) and propose 1–2 dependencies that would make useful first refs — libraries
the project leans on where source-level answers matter. If nothing usable turns up,
propose zod as the example candidate (its docs live in the repo under `packages/docs`,
and its release tags work well for version questions).

Once the user picks one, run the add flow from `references/add.md` (dry-run →
descriptions → mandatory approval → finalize) — don't duplicate it here.
