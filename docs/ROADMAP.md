# Roadmap

This file groups the current in-code `TODO`s by architectural layer so follow-up work is easier to scope.

## Flow Core

Files:
- [`src/flow/types.ts`](../src/flow/types.ts)
- [`src/flow/document.ts`](../src/flow/document.ts)
- [`src/flow/serialization.ts`](../src/flow/serialization.ts)
- [`src/flow/graph.ts`](../src/flow/graph.ts)
- [`src/flow/runtime.ts`](../src/flow/runtime.ts)

Planned work:
- add richer packet metadata such as provenance, schema versioning, and diagnostics
- support multiple compatible strategy IDs and richer execution metadata on blocks
- add edge transform adapters and better downstream propagation batching
- make port coercion pluggable instead of fixed in the document layer
- add document versioning and migration contracts before long-term persistence
- add runtime-level tracing, cancellation, persistence, and structured execution results
- move AI execution from mock hook to a provider abstraction usable by real integrations
- support external runtime/block registration without editing the core
- add serializer versioning and large blob offloading for image payloads
- support flow-specific planning hints and optional port-level planning semantics

## Flow-Design and Flow-Agent

Files:
- [`src/flow-design/analysis.ts`](../src/flow-design/analysis.ts)
- [`src/tools/flow-tools.ts`](../src/tools/flow-tools.ts)
- [`src/tools/task-graph-tools.ts`](../src/tools/task-graph-tools.ts)
- [`src/llm/fake-plan-builders.ts`](../src/llm/fake-plan-builders.ts)
- [`src/agent/final-result-formatters.ts`](../src/agent/final-result-formatters.ts)

Planned work:
- replace deterministic task-graph inference heuristics with a more block-aware decomposition model
- track refinement provenance per task node across retries
- introduce a first-class capability taxonomy instead of plain strings
- replace heuristic issue-to-strategy routing with a more explicit model
- emit structured task-graph diffs and cache repeated preflight results
- replace keyword-based retry policy with an explicit planner-visible policy model
- allow deterministic multi-pass planning to short-circuit once reflection is satisfied
- persist pass-by-pass design details so UIs can visualize design evolution

## Node-Config Design

Files:
- [`src/node-config-design/core.ts`](../src/node-config-design/core.ts)
- [`src/node-config-agent/strategies/shared.ts`](../src/node-config-agent/strategies/shared.ts)

Planned work:
- allow multiple strategies to cooperate on one node
- add ordering/priority metadata for strategies
- preserve note provenance so UIs can explain whether a note came from block metadata, manifest guidance, or reflection

## Monitoring and Observability

Files:
- [`src/flow/design-monitor.ts`](../src/flow/design-monitor.ts)
- [`src/graph/renderer.ts`](../src/graph/renderer.ts)
- [`src/agent/runtime.ts`](../src/agent/runtime.ts)
- [`src/observability/unified-timeline.ts`](../src/observability/unified-timeline.ts)

Planned work:
- add diff-based design-monitor payloads for large graphs
- preserve stable layout hints across clear/retry cycles
- support richer routing/curved-path hints for visual clients
- add layout/group metadata for live graph rendering
- persist unified timeline streams
- add monitoring sink failure isolation and retry policies
- normalize a shared visual payload for mixed trace/design timelines
- add per-source backpressure policies
- attach run-step correlation IDs through the unified timeline

## Suggested Order

If we want to keep moving with the least friction, this is a sensible order:

1. flow-design retry policy + pass history persistence
2. node-config provenance and multi-strategy support
3. flow runtime provider abstraction for real AI execution
4. monitoring persistence and diff-based updates
5. long-term flow persistence/versioning
