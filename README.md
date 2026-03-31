# TypeScript LLM Agent Runtime

Production-style TypeScript agent runtime demonstrating skill selection, tool routing, planning/execution/reflection, approvals, resilience, persistence abstraction, and observability.

## Project Purpose

This project is a practical baseline for building an LLM agent runtime that can run in three modes:

- deterministic fake gateway for tests and local demos
- real OpenAI gateway for API-backed behavior via the official OpenAI Node SDK
- real Gemini gateway for API-backed behavior via the official Google GenAI SDK

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
│  └─ observability/
├─ data/
│  └─ skills/
└─ tests/
```

## Install

```bash
nvm use
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

All npm scripts are wrapped through [`scripts/with-project-node.sh`](/Users/dujung/Documents/Codex/scripts/with-project-node.sh), which sources `nvm` and uses the version from [.nvmrc](/Users/dujung/Documents/Codex/.nvmrc).
The project targets Node.js `22.15.1` or newer and is intended to remain compatible with later major versions.

Demo shows:

- normal completed run
- run suspended for approval
- resumed run after approval

## Fake vs Real Gateways

Default is fake gateway.

To use OpenAI:

1. copy `.env.example` to `.env`
2. set `OPENAI_API_KEY`
3. optionally set `OPENAI_MODEL`
4. set `USE_REAL_OPENAI=true`
5. optionally set `OPENAI_STRUCTURED_PROXY_URL` to route structured parsing through an external HTTP proxy

Runtime selects gateway in [`src/index.ts`](./src/index.ts).
The OpenAI gateway is implemented against the SDK `responses.parse` structured-output flow and expects `openai@^6.27.0`.
When `OPENAI_STRUCTURED_PROXY_URL` is set, the gateway serializes the active schema and delegates the structured parse call over HTTP.

To use Gemini:

1. copy `.env.example` to `.env`
2. set `GEMINI_API_KEY` or `GOOGLE_API_KEY`
3. optionally set `GEMINI_MODEL`
4. set `LLM_PROVIDER=gemini` or `USE_REAL_GEMINI=true`

The Gemini gateway is implemented against `@google/genai@^1.28.0` and uses `responseMimeType=application/json` with `responseJsonSchema`.
The Gemini SDK requires Node.js 20 or newer for real API execution, and this project standardizes on Node.js 22+.

## Environment Variables

- `OPENAI_API_KEY`: API key for real gateway
- `OPENAI_MODEL`: model name (default: `gpt-4.1-mini`)
- `OPENAI_STRUCTURED_PROXY_URL`: optional HTTP endpoint for proxied structured parsing
- `GEMINI_API_KEY`: API key for Gemini API
- `GOOGLE_API_KEY`: alternative Gemini API key env var
- `GEMINI_MODEL`: model name (default: `gemini-2.0-flash`)
- `LLM_PROVIDER`: `fake`, `openai`, or `gemini`
- `USE_REAL_GEMINI`: `true` or `false`
- `USE_REAL_OPENAI`: `true` or `false`

## Future Extensions

- Add Postgres implementation of `RunStateStore`
- Expose runtime through an HTTP API
- Attach a web UI for approvals and trace inspection
- Add distributed tracing / metrics sink
- Expand skill packs and external tool adapters
