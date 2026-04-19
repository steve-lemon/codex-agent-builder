# Prompt Lab Context

## Current State

Prompt Lab now supports:

- interactive `run` mode and `advisor-eval` mode
- `--last` to reuse the most recent session config and requirement
- `--auto` to skip repetitive prompts and rely on auto policy rules
- resource-backed auto policy from `data/products/prompt-lab/PROMPT_LAB_AUTO_POLICY.yml`
- requirement history and last-run caching under `output/labs/`
- execution timing summaries with stage breakdown:
  - `agent-run`
  - `planner`
  - `tool-execution`
  - `reflector`
  - `finalizer`
  - `self-review`
  - `prompt-finalize`
- fallback designed-flow reconstruction when live design events are missing

## Current Known Gaps

### 1. Planner latency is still the main bottleneck

Recent runs consistently show planner time dominating total execution time.

Current impact:

- tool execution is often short
- planner can still consume the majority of total runtime
- result interpretation is now much clearer, but performance is still limited by planning

See also:

- [`src/agent/planner.ts`](/Users/dujung/Documents/Codex/src/agent/planner.ts)

### 2. Reconstructed designed-flow snapshots are useful but still approximate

When live design events are missing, Prompt Lab reconstructs a reasonable flow summary from result metadata.

Current limitation:

- the reconstructed graph may look more complete than the actual failed run
- it should eventually prefer a true persisted `finalFlow` or live design snapshot whenever available
- the CLI should explicitly mark reconstructed snapshots

See also:

- [`src/prompt-lab/cli.ts`](/Users/dujung/Documents/Codex/src/prompt-lab/cli.ts)

### 3. Classification / advisor path traceability can still improve

Some runs show generic task-graph fallback without clear advisor timing evidence.

That means we still need better visibility into:

- whether advisor-backed classification was actually used
- whether fallback happened before advisor timing instrumentation
- where planner-internal classification decisions were finalized

## Auto Policy Structure

Auto-run policy is intentionally externalized.

Resource:

- [`data/products/prompt-lab/PROMPT_LAB_AUTO_POLICY.yml`](/Users/dujung/Documents/Codex/data/products/prompt-lab/PROMPT_LAB_AUTO_POLICY.yml)

Current behavior:

- `stop`
  - failed runs
  - `not-fulfilled`
  - approval-waiting runs
- `warn`
  - `uncertain`
  - `partial`
  - synthetic sample validation
  - synthesized design snapshots

Design intent:

- `--auto` should remove repetitive operator input
- it should not silently steamroll important decision points

## Recommended Next Steps

1. Planner performance analysis

- measure planner sub-stages more explicitly
- reduce planner payload size / step complexity
- verify whether structured output generation is the dominant planner cost

2. Designed-flow reconstruction polish

- prefer persisted `finalFlow` over strategy-based reconstruction
- mark reconstructed snapshots explicitly in CLI and markdown artifacts

3. Classification path observability

- record whether classification used:
  - advisor direct decision
  - deterministic fallback
  - generic template fallback

## Fast Run Commands

```bash
# same as the most recent session
npm run lab -- --last

# same as the most recent session, non-interactive
npm run lab -- --last --auto

# same config, new requirement
npm run lab -- --last --auto --requirement "새 요구사항"
```
