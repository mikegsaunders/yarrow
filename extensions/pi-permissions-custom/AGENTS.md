# pi-permissions-custom

A Claude Code-style permission system for the Pi coding agent. Provides 4 permission modes with sensible defaults, plus tweakable global rules.

## How to modify rules

The rules file lives at:

```
~/.pi/agent/extensions/pi-permissions-custom/rules.json
```

You can edit it directly, or ask the agent to modify it for you. After editing, run `/permissions reload` to pick up changes without restarting pi.

### Rules file structure

```json
{
  "mode": "default",
  "catastrophicPatterns": [...],
  "dangerousPatterns": [...],
  "protectedPaths": [...],
  "shellTrickPatterns": [...]
}
```

| Field | Description |
|-------|-------------|
| `mode` | Default mode on startup: `default`, `acceptEdits`, `fullAuto`, `bypassPermissions` |
| `catastrophicPatterns` | Substring patterns **always blocked** in every mode. Cannot be overridden. |
| `dangerousPatterns` | Substring patterns requiring confirmation in `fullAuto` mode. Auto-allowed in `bypassPermissions`. |
| `protectedPaths` | Paths where writes/edits are **always blocked**. Checked against `~/.ssh`, `~/.bashrc`, etc. |
| `shellTrickPatterns` | Substring patterns that always require **individual per-command confirmation**. Cannot be session-approved. Auto-allowed only in `bypassPermissions`. |

### Pattern rule format

Each pattern is an object with:
- `pattern`: Substring to match against the command string or path
- `description`: Human-readable description shown in approval prompts

Example:

```json
{ "pattern": "rm -rf", "description": "recursive force delete" }
```

### Adding new patterns

To add a new blocked command, add an entry to the appropriate array:

```json
{
  "pattern": "docker system prune",
  "description": "docker cleanup"
}
```

To add a new protected path:

```json
"~/.my_secrets"
```

Paths starting with `~/` are automatically expanded to the user's home directory.

## Permission modes

| Mode | Writes/Edits | Safe Bash | Dangerous Bash | Shell Tricks | Catastrophic |
|------|-------------|-----------|----------------|--------------|--------------|
| `default` | Ask | Ask | Ask | Ask | Block |
| `acceptEdits` | Auto | Ask | Ask | Ask | Block |
| `fullAuto` | Auto | Auto | Ask | Ask | Block |
| `bypassPermissions` | Auto | Auto | Auto | Auto | Block |

## Commands

| Command | Description |
|---------|-------------|
| `/permissions` | Interactive mode selector |
| `/permissions <mode>` | Set mode directly |
| `/permissions status` | Show current mode and approvals |
| `/permissions reload` | Reload rules.json |

## Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Cycle through modes |

## CLI flags

Start pi with a specific mode:

```bash
pi --default
pi --accept-edits
pi --full-auto
pi --bypass-permissions
```

## Session approvals

When prompted for confirmation, you can:
- **Allow once** — approve this specific call
- **Allow for session** — auto-approve this tool for the rest of the session
- **Deny** — block the operation

## Limitations

Pattern matching uses simple substring matching. Extra whitespace may bypass patterns (`sudo  rm  -rf  /` won't match `sudo rm -rf /`). For stronger protection, consider combining with an AST-based guardrail extension.
