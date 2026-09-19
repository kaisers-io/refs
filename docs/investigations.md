# Investigations

Worked examples of questions `refs` answers, and what each answer leaves open.

The last part matters. An agent that reads a checkout can tell you what the code does at a
revision. It cannot tell you what runs in production, why a decision was made outside the commit
history, or whether a test passes without running it. Each example below says which is which.

## Upgrading a dependency

> I want to upgrade effect. What changed since the version we use, and what do I have to adjust?

Three steps, and the agent does them in order.

**Find the version in use.** It reads your project's own manifest or lockfile. That is your
repository, not a checkout.

**Find the repository.** `npm:effect` resolves to `github.com/Effect-TS/effect`. So does
`https://github.com/Effect-TS/effect`, and so does `git@github.com:Effect-TS/effect.git`.

**Resolve both releases and read the range.** Effect is a monorepo whose packages tag separately,
so the package's own convention has to be recorded once:

```bash
refs edit github.com/Effect-TS/effect tag_format 'effect@{version}' --package effect
refs tag github.com/Effect-TS/effect 3.19.2 --package effect   # effect@3.19.2
refs tag github.com/Effect-TS/effect 3.22.2 --package effect   # effect@3.22.2
```

From there the agent reads commits and diffs between the two tags, scoped to the package's own
directory, and quotes what it finds.

**What stays open.** A diff tells you what changed in the library. It does not tell you what your
code does with it. The agent can look for the changed names in your project, and that is a search,
not a proof. Ask it to name the revisions it compared, because a checkout is the default branch at
the last fetch and not necessarily the version you have installed.

## A contract between two services

> We are adding retries to the checkout service. How does the billing worker handle duplicate
> requests, which tests describe that behaviour, and what could break?

Both repositories are private, and the agent reads both checkouts. It quotes the handler, the idempotency
key if there is one, and the tests that pin the behaviour.

**What stays open.** Reading tests tells you what behaviour is pinned, not that the suite passes
today. And the two checkouts are the default branches, not what is deployed. If the question is
about a release, resolve it to a tag first and say which one.

## Where something changed, and why

> When did this function stop taking a callback, and what was the reason?

`git log` and `git blame` in the checkout answer the first half exactly. The commit that changed the
line is a fact, and so is its message.

**What stays open.** The reason is only as good as the commit message. Discussion in a pull request,
a ticket, or a conversation is not in the repository. When the message says nothing useful, the
honest answer is that the change is visible and the reasoning is not.

## Reading a branch that is not checked out

A checkout materialises the default branch. Other branches the clone fetched are still readable
through `origin/<branch>`, without changing what is checked out:

```bash
git -C <checkout> log --oneline 'origin/main..origin/feature/x'
git -C <checkout> diff --name-status --no-renames 'origin/main...origin/feature/x'
git -C <checkout> show 'origin/feature/x:path/to/file.ts'
```

`refs sync` fetches every branch, so a new commit on that branch arrives with the next sync even
though the checkout itself does not move.

**What stays open.** Citations have to name the revision. A file path alone points at the checked-out
branch, which is not where that content lives. Pin the branch tip to a commit and quote that.

Pointing a checkout at a branch other than the default is not supported. `refs sync` reads the
remote's own `HEAD` and writes that branch back into the configuration.

## Asking about your own code

Nothing above requires a published package. A repository you name by URL works the same way, and a
model that has never seen your code reads it the same way it reads a library. The difference is that
for your own repositories there is no documentation to fall back on, and no training data either.
