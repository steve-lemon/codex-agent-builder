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

## Working Backlog

## Runtime

- [ ] Add runtime-level tracing, cancellation, persistence, and structured execution results
- [ ] Move AI execution from mock hook to a provider abstraction usable by real integrations

## Resources

- [ ] Distinguish parse errors from schema-validation failures with a structured resource load error
- [ ] Add manifest version and migration metadata to resource definitions
- [ ] Add safer cache invalidation support for non-file text sources

## Flow Core

- [ ] Add richer packet metadata such as provenance, schema versioning, and diagnostics
- [ ] Add document versioning and migration contracts before long-term persistence
- [ ] Support external runtime and block registration without editing the core

## Flow Design

- [ ] Replace deterministic task-graph inference heuristics with a more block-aware decomposition model
- [ ] Emit structured task-graph diffs and cache repeated preflight results
- [ ] Persist pass-by-pass design details so UIs can visualize design evolution

## Node Config

- [ ] Allow multiple strategies to cooperate on one node
- [ ] Add ordering and priority metadata for strategies
- [ ] Preserve note provenance so UIs can explain where guidance came from

## Monitoring

- [ ] Add diff-based design-monitor payloads for large graphs
- [ ] Persist unified timeline streams
- [ ] Attach run-step correlation IDs through the unified timeline

## Docs

- [x] Add usage guidelines for this TODO document
- [ ] Keep topic sections aligned with active architectural areas
- [ ] Link larger planning items to dedicated design docs when needed
