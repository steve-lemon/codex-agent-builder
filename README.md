# TypeScript LLM Agent Runtime

Production-style TypeScript agent runtime demonstrating skill selection, tool routing, planning/execution/reflection, approvals, resilience, persistence abstraction, and observability.

## Project Purpose

This project is a practical baseline for building an LLM agent runtime that can run in two modes:

- deterministic fake gateway for tests and local demos
- real OpenAI gateway for API-backed behavior

## Architecture Overview

Core flow:

1. `SkillSelector` chooses one skill from user input.
2. Skill instructions are loaded from `SKILL.md`.
3. `MultiSkillRouter` limits visible tools to those allowed by the chosen skill.
4. `Planner` creates structured steps (`parallel-tools`, `single-tool`, `reasoning`, `finalize`) validated by zod.
5. `StepExecutor` executes each step with policy and resilience controls.
6. If a tool requires confirmation, runtime suspends with `waiting_for_approval`.
7. `resume()` continues after `approve`, `reject`, or `edit-and-approve`.
8. `Reflector` checks completion and `Finalizer` returns structured output.
9. `AgentTracer` captures structured run events.

## File Structure

```text
.
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ .env.example
├─ README.md
├─ src/
│  ├─ index.ts
│  ├─ demo.ts
│  ├─ agent/
│  ├─ llm/
│  ├─ tools/
│  ├─ policy/
│  ├─ resilience/
│  ├─ state/
│  ├─ observability/
│  └─ skills/
└─ tests/
```

## Install

```bash
npm install
```

## Run Tests

```bash
npm test
```

## Run Demo

```bash
npm run demo
```

Demo shows:

- normal completed run
- run suspended for approval
- resumed run after approval

## Fake vs OpenAI Gateway

Default is fake gateway.

To use OpenAI:

1. copy `.env.example` to `.env`
2. set `OPENAI_API_KEY`
3. optionally set `OPENAI_MODEL`
4. set `USE_REAL_OPENAI=true`

Runtime selects gateway in [`src/index.ts`](./src/index.ts).

## Environment Variables

- `OPENAI_API_KEY`: API key for real gateway
- `OPENAI_MODEL`: model name (default: `gpt-4.1-mini`)
- `USE_REAL_OPENAI`: `true` or `false`

## Future Extensions

- Add Postgres implementation of `RunStateStore`
- Expose runtime through an HTTP API
- Attach a web UI for approvals and trace inspection
- Add distributed tracing / metrics sink
- Expand skill packs and external tool adapters
