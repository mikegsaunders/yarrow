---
name: personal-wiki
description: The user's personal wiki at ~/wiki - their standing preferences, tech stack defaults (Bun + Hono + Oat), project conventions, and notes they have saved there. Use it only when the user names the wiki or their own notes ("check my wiki", "add this to my notes", "what did I decide about X"), asks what their preferences or defaults are, or is about to scaffold a new project those defaults would shape. Do not use it for general questions, for looking up documentation, or for anything answerable without their personal notes - a question that merely starts with "remind me" is usually just a question.
---

# Personal Wiki

## Overview

This skill maintains a personal wiki at `~/wiki` — an LLM-maintained, git-tracked markdown knowledge base inspired by Karpathy's llm-wiki pattern. It is *not* loaded into the system prompt by default. It stays slim in the background and is consulted/updated only when explicitly requested.

The wiki is just markdown files in `~/wiki` (a git repo). It is browsable in any markdown viewer (e.g. Obsidian, vim, GitHub web UI).

## Wiki Structure

```
~/wiki/
├── README.md          # What this wiki is about
├── WIKI.md            # Schema & conventions (rules for the LLM)
├── index.md           # Catalog of all pages with summaries + categories
├── log.md             # Timeline of ingests, updates, major queries
├── preferences.md      # Standing preferences, defaults, rules of thumb
└── ...                # Topic pages, summaries, syntheses
```

## When to Use This Skill

- The user names the wiki or their notes: "update my wiki", "check the wiki", "add this to my notes"
- The user asks about their own preferences or defaults: "my stack", "how I like apps built"
- The user wants a document, article, idea, or decision ingested into the knowledge base
- The user asks about a decision they recorded: "what did I decide about X?"
- Before scaffolding a new project, to pick up `preferences.md` defaults

## When Not To Use It

The wiki answers questions about *the user*, not questions in general. Skip it for:

- Factual or technical questions with an answer that does not depend on their notes
  ("remind me of the command for checking nginx" is a question about nginx)
- Documentation lookups for a library, tool, or API
- Anything in the current repository, which the working directory already answers

## On-Demand Loading Model

**The wiki is NOT in context automatically.** This keeps the system prompt slim. When this skill matches (per the description above), follow this workflow:

1. Read `~/wiki/index.md` first to see what topics exist.
2. Read relevant pages (e.g. `preferences.md`
3. Answer/query/ingest based on what you find.
4. Update affected wiki pages and `index.md` if you changed anything.
5. Append a summary entry to `log.md`.

## Key Pages

| Page | Purpose |
|------|---------|
| `~/wiki/WIKI.md` | The schema. Read this first if you're unsure how to structure an update. |
| `~/wiki/preferences.md` | Standing preferences (tech stack, style, tools). Always check before building. |
| `~/wiki/index.md` | The catalog. Read this to find what exists before querying/ingesting. |
| `~/wiki/log.md` | The timeline. Append a short entry after any update. |

## Rules for Updating the Wiki

1. **Append log entries.** After any change, add to `log.md`: `## [YYYY-MM-DD] <action> | <brief description>`.
2. **Keep index current.** Update `~/wiki/index.md` when adding/removing/renaming pages.
3. **Cross-reference.** Link between pages with `[[Page Name]]` (or `[Page Name](page.md)`).
4. **Single concern per page.** One topic per file. Prefer updating existing pages over creating orphans.
5. **Write for future you.** Summaries should be dense and self-contained. Don't assume context.
6. **Git commit.** The user handles commits, but always write clean markdown so diffs are readable.

## Ingest Workflow

When user says "ingest this" or you need to add a new source:

1. Read the source (user provides markdown/link, or you fetch it).
2. Discuss key takeaways with the user.
3. Write a summary page if warranted.
4. Update relevant existing topic/entity pages.
5. Update `index.md`, append to `log.md`.

## Query Workflow

When user asks something that might be in the wiki:

1. Read `~/wiki/index.md`.
2. Read the relevant page(s).
3. Synthesize an answer with citations.
4. If the answer is novel and valuable, consider writing a new wiki page for it.
