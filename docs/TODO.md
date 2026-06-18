# TODO Guide

This document is the working backlog for the project. It is organized by topic, and every item should clearly show whether it is planned, in progress, blocked, or done.

## Purpose

- Keep upcoming work in one predictable place.
- Group tasks by topic instead of by date or author.
- Make progress visible without reading commit history or issue threads.
- Leave enough context that future updates stay easy and consistent.

## How To Use This File

- Add work under the most relevant topic section.
- Write tasks as small, actionable items.
- Update status in place instead of duplicating the same task in multiple sections.
- When scope changes, rewrite the task so the current text still matches reality.
- If a task is no longer needed, mark it as done with a short note or remove it only if it was never real work.

## Status Format

Use the following checkboxes consistently:

- `[ ]` not started
- `[~]` in progress
- `[!]` blocked or waiting on something external
- `[x]` completed

Recommended task format:

```md
- [ ] Short action-oriented task
  Context: optional one-line note if the task needs extra explanation.
```

If a task is blocked, add the reason on the next line:

```md
- [!] Finalize runtime manifest migration plan
  Blocked by: decision on backward compatibility policy.
```

## Section Structure

Create sections by topic, not by priority. Good examples:

- Runtime
- Resources
- Flow Design
- Node Config
- Prompt Lab
- Testing
- Docs

Suggested section template:

```md
## Topic Name

- [ ] First task
- [~] Task currently being worked on
- [!] Task waiting on input
- [x] Finished task
```

## Writing Guidelines

- Start each task with a verb.
- Keep one task focused on one outcome.
- Prefer concrete wording like `Add schema error type for resource loading`.
- Avoid vague items like `Improve system` or `Fix bugs`.
- Put design notes, decisions, and long discussion in separate docs, then link them from the task if needed.

## Maintenance Rules

- Move completed items to the bottom of each section or keep them in a short `Done` subsection if a topic grows large.
- Split oversized tasks into smaller items before starting implementation.
- Review this file regularly so it stays current and trustworthy.
- If a topic becomes large enough to need planning detail, create a dedicated doc and link it from the relevant task here.

## Initial Template

Use this structure when adding real content later:

```md
# TODO

## Runtime

- [ ] Example task

## Resources

- [ ] Example task

## Docs

- [ ] Example task
```
