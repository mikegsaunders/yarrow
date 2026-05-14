---
name: personal-wiki
description: Access and update my personal knowledge wiki at ~/wiki. Contains my standing preferences, tech stack defaults (Bun + Hono + Oat), project conventions, and accumulated knowledge. Use when the user mentions wiki, docs, preferences, my stack, how I build apps, or when starting any new web app, project, or coding task where defaults should apply. Also use for ingesting notes, updating knowledge, or long-term memory storage.
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

- User says "update my wiki", "update my docs", "check the wiki", "reference my docs"
- User mentions project preferences ("my stack", "how I like apps built")
- User wants to ingest a document, article, idea, or decision into the knowledge base
- User asks something that requires long-term memory ("what did I decide about X?")
- Before starting a new project, check `preferences.md` for relevant defaults

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
