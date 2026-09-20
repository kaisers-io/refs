# Investigations

Worked examples of questions `refs` answers, and what each answer leaves open.

That last part matters. An agent reading a checkout can tell you what the code does at a revision. It cannot tell you what runs in production, why a decision was made outside the commit history, or whether a test passes without running it. Each example below says which is which.

Everything here is phrased as something you say to your agent. The CLI equivalents are shown where they help, because the agent runs those same commands and you may prefer to type one yourself.

## Upgrading a dependency

```
/refs I want to upgrade effect. what changed since the version we use, and what do I have to adjust
```

Four steps, and the agent does them in order.

**Find the version in use.** It reads your project's own manifest or lockfile. That is your repository, not a checkout.

**Find the repository.** `npm:effect` resolves to `github.com/Effect-TS/effect`. So does `https://github.com/Effect-TS/effect`, and so does `git@github.com:Effect-TS/effect.git`.

**Resolve both releases and read the range.** Effect is a monorepo whose packages tag separately, so the package's own convention has to be recorded once. Tell the agent, or run it yourself:

```bash
refs edit github.com/Effect-TS/effect tag_format 'effect@{version}' --package effect
refs tag github.com/Effect-TS/effect 3.19.2 --package effect   # effect@3.19.2
refs tag github.com/Effect-TS/effect 3.22.2 --package effect   # effect@3.22.2
```

From there the agent reads commits and diffs between the two tags, scoped to the package's own directory, and quotes what it finds.

**Come back to your own code.** A diff of the library is only half an answer to "what do I have to adjust". The agent takes the names that changed and looks for them where you use them, so what comes back is the places in your project the upgrade reaches rather than everything the release touched.

**What stays open.** That last step is a search, not a proof. A call that reaches the changed code through a re-export, a wrapper of your own, or a name you aliased on import will not turn up. Ask it to name the revisions it compared, because a checkout is the default branch at the last fetch and not necessarily the version you have installed.

## Who has to change when I change something

```
/refs I changed how our orders API paginates. check billing-worker and the admin dashboard: do they call it, and what has to change
```

This starts in your own repository and runs outwards. The agent reads what you changed, then goes through the consumers you named looking for the call sites: the import, the endpoint, the field you renamed. What comes back is the file and line in each of them, and what has to change there.

The value is in what it saves. Without it you ask around, or you find out when something breaks in a service you do not own.

**Name the consumers.** `refs` routes a question to a repository. It does not work out which of your refs depend on which, so saying which ones to check is your half of the question. Call them however your team does; where that is not enough to tell which repository you mean, the agent asks, and `refs list --json` shows what you track.

**What stays open.** A search finds the call sites that are there to find. Code that reaches your API through a variable, a generated client, or a configuration value will not turn up. The answer is a list of places to look, not a proof that the rest is safe.

## A flow that crosses several repositories

```
/refs we are adding retries to checkout-api. follow a payment request through the gateway, checkout-api, the shared client and billing-worker. where could the same request be handled twice, and which tests cover that
```

Add every repository that takes part, not only the two at the ends. The agent reads each checkout in turn, quotes the handler on each hop, the idempotency key if there is one, and the tests that pin the behaviour.

This is the case with no alternative. There is no documentation that spans four private repositories and stays current, and no model has seen any of them.

**What stays open.** Reading tests tells you what behaviour is pinned, not that the suite passes today. The checkouts are default branches, not what is deployed. If the question is about a release, resolve it to a tag first and say which one.

## Where something changed, and why

```
/refs when did this function stop taking a callback, and what was the reason
```

`git log` and `git blame` in the checkout answer the first half exactly. The commit that changed the line is a fact, and so is its message.

**What stays open.** The reason is only as good as the commit message. Discussion in a pull request, a ticket, or a conversation is not in the repository. When the message says nothing useful, the honest answer is that the change is visible and the reasoning is not.

## Reading a branch that is not checked out

A checkout materialises the default branch. Other branches the clone fetched are still readable through `origin/<branch>`, without changing what is checked out:

```bash
git -C <checkout> log --oneline 'origin/main..origin/feature/x'
git -C <checkout> diff --name-status --no-renames 'origin/main...origin/feature/x'
git -C <checkout> show 'origin/feature/x:path/to/file.ts'
```

`refs sync` fetches every branch, so a new commit on that branch arrives with the next sync even though the checkout itself does not move.

**What stays open.** Citations have to name the revision. A file path alone points at the checked-out branch, which is not where that content lives. Pin the branch tip to a commit and quote that.

Pointing a checkout at a branch other than the default is not supported. `refs sync` reads the remote's own `HEAD` and writes that branch back into the configuration.

## Asking about your own code

Nothing above requires a published package. A repository you name by URL works the same way, and a model that has never seen your code reads it the same way it reads a library. The difference is that for your own repositories there is no documentation to fall back on, and no training data either.
