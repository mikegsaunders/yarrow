# yarrow/permissions

Every tool call is judged before it runs. There are no permission modes to choose
between and nothing to cycle through: one behaviour, four tiers.

| Tier | What lands here | What happens |
|------|-----------------|--------------|
| **deny** | Catastrophic commands, any tool touching a `secretPath`, writes to a `protectedPath` | Never runs. Free, offline, no appeal — not even under `--bypass-permissions` |
| **ask** | `dangerousPatterns`, `shellTrickPatterns`, bash mentioning a `protectedPath` | Only a human approves it |
| **allow** | Reads and other non-mutating tools, `autoApprovedCommands`, edits inside the working directory | Runs immediately, no model call |
| **classify** | Everything else: other shell commands, edits outside the working directory | A small fast model allows it or blocks it with a reason |

The deterministic tiers come first on purpose. They cost nothing, work with no
network, and cannot be talked out of their answer by a model — including by a model
reading hostile content in your repo.

## The classifier

Anything that reaches the classifier is sent to a small model with three things: the
proposed call, what you actually asked for, and the trust boundary (working directory
plus the git remotes configured when the session started). It answers allow or block.

**A block is not a prompt.** The reason goes back to the agent, which is expected to
find another approach — that is what lets a long task keep moving without you. Only
when the agent is blocked `blocksBeforeAsking` times in a row does the question reach
you, so it cannot get stuck in a loop against a wall.

If the classifier can't be reached or returns something unparseable, the call falls
back to asking you. It never falls back to allowing.

Roughly what it blocks: escalation beyond your request, acting on instructions the
agent read rather than ones you gave, irreversible destruction, reaching outside your
environment (deploys, publishes, foreign endpoints), moving secrets, downloading and
executing code, and changing infrastructure other people depend on.

Configure it in your rules file:

```json
{
  "classifier": {
    "provider": "openrouter",
    "model": "@preset/flash",
    "blocksBeforeAsking": 2
  }
}
```

Expect roughly 3 seconds per classified call on a fast model, and nothing at all for
the allow tier — which is most of a session. Identical calls are cached for the rest
of the session, so a retried command is judged once.

Run `bun run eval:classifier` after changing the rubric or the model. It scores the
classifier against a set of calls that must be allowed and calls that must be blocked.

## Non-interactive runs

`yo <question>`, `pi -p`, and RPC sessions have nobody to ask, so the **ask** tier and
any classifier fallback become blocks. The **classify** tier still works normally: a
one-shot can do what the classifier approves.

## `--bypass-permissions`

Skips the ask and classify tiers. The deny tier still applies. For containers and
throwaway VMs.

## Rules

Packaged defaults live in `rules.json` next to this file. Your overrides live in
`~/.pi/agent/yarrow/permissions.json`. Any top-level key you set there replaces that
key entirely; keys you omit inherit the packaged defaults, so updates to categories
you have not customised still reach you. `/permissions reload` re-reads both.

| Key | Effect |
|-----|--------|
| `catastrophicPatterns` | Denied, always |
| `dangerousPatterns` | Human approval required |
| `shellTrickPatterns` | Commands that hide their real content. Human approval required |
| `protectedPaths` | Writes/edits denied; a bash command touching one asks |
| `secretPaths` | Every tool — including `read` — is denied |
| `autoApprovedCommands` | Command heads that skip the classifier entirely |
| `classifier` | Provider, model, and how many blocks before you get asked |

The `protectedPaths` / `secretPaths` split exists because the two failure modes
differ: you want to stop the agent *rewriting* your `.zshrc`, but you want to stop it
*reading* your SSH keys at all.

### Pattern matching

Patterns are matched against the command with whitespace normalised, so
`sudo  rm  -rf  /` matches the rule written `sudo rm -rf /`.

A pattern matches on **token boundaries** where its edges are word characters: `dd`
matches `dd if=/dev/zero` but not `git add .`; `source` matches `source ./env.sh` but
not `resource.ts`. Patterns whose edges are punctuation, like `| sh`, match as written.

For more precision, set `"match": "regex"`. The packaged root-delete rule uses this so
`rm -rf /` is caught while `rm -rf /tmp/build` is not. A malformed pattern is skipped
rather than taking the whole rule set down.

### Paths

Path rules are resolved, not string-matched: `~/.ssh/id_rsa`, `$HOME/.ssh/id_rsa` and
`/home/you/.ssh/id_rsa` are the same place, and a path matches only when it is the
entry itself or sits underneath it. For bash, path-looking tokens are pulled out of
the command and resolved individually, so a command that merely mentions the text is
not caught.

## Commands

| Command | Description |
|---------|-------------|
| `/permissions` | What is enforced: classifier model, session counts, rules source |
| `/permissions reload` | Re-read rules from disk |

## Limitations

This is not a sandbox. The deterministic tiers read command text without executing it,
and the classifier is a model that can be wrong in both directions. Treat the pair as
a seatbelt against mistakes and a speed bump against hostile content, not as a
boundary you can rely on. Pi's
[security model](https://github.com/earendil-works/pi/blob/main/docs/security.md)
applies underneath.
