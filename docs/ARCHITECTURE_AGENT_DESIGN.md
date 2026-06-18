# Architecture Agent Design

## Goal

Introduce an architecture-level agent that behaves like a seasoned strategist.

It should:

- frame the real user mission before flow design starts
- define success criteria and validation posture
- derive minimal, focused sample evidence when the requirement does not include enough concrete input
- consult external knowledge/experience resources when relevant
- produce a reusable brief for downstream layers without taking over tactical orchestration from the planner

The architecture agent must work inside the existing agent/runtime/flow-design structure rather than bypassing it.

## Non-Goals

This layer should not become:

- a replacement planner
- a second node-config generator
- a domain-specific rule bucket
- a mandatory runtime dependency that can block the existing design path

Its job is to improve strategic clarity before tactical orchestration begins.

## Strategy vs Tactics

### Architecture Agent = strategist

Owns:

- mission framing
- success criteria
- evidence requirements
- execution posture
- design principles
- knowledge-backed risk review
- strategy review after execution

Must not own:

- tool sequencing
- step reference wiring
- retry ordering
- runtime fallback mechanics
- final node wiring/config execution details

### Planner = tactician

Owns:

- tool sequence
- step graph
- step references
- execution-order repair
- tactical fallback during orchestration

Must not redefine:

- mission
- output contract
- success criteria
- synthetic-vs-real evidence posture
- strategic fulfillment ceiling

## Strategic Responsibilities

The architecture layer should answer the following questions before design begins:

1. What is the real mission?
2. What counts as success?
3. What evidence is minimally sufficient to validate the mission?
4. Is the current input real, inferred, or synthetic?
5. Should this be solved deterministically, with AI, or as a hybrid?
6. What known risks or experience-backed caveats apply?

These are strategy questions. They must be stable enough for downstream consumers to share.

## Boundary Contract

The architecture layer should emit a compact `DesignBrief`.

The planner consumes the brief as a planning input, but the brief must not directly encode a tool plan.

Good:

- `executionPosture: "ai-first"`
- `validationPlan: representative sample + exact assertions`
- `riskFlags: synthetic input only`

Bad:

- `call designFlowDraft first, then validateFlowDraft`
- `use step id analyze-request`
- `retry prevalidate 2 times`

Design rule:

- the brief defines `why`, `what`, and `constraints`
- the planner defines `how`, `sequence`, and `references`

## Core Outputs

The architecture layer should produce three artifacts.

### 1. DesignBrief

Canonical pre-design strategy document.

Suggested shape:

```ts
interface DesignBrief {
  mission: {
    summary: string;
    goal: string;
    operationModel: Array<
      'classify' |
      'count' |
      'extract' |
      'transform' |
      'summarize' |
      'explain' |
      'generate' |
      'validate' |
      'route'
    >;
  };
  inputContract: {
    format: 'text' | 'json' | 'image' | 'mixed' | 'unknown';
    source: 'user-provided' | 'inferred' | 'synthetic';
    concreteInputPresent: boolean;
    missingRequiredInput: boolean;
    notes: string[];
  };
  outputContract: {
    format: 'json' | 'plain-text' | 'markdown' | 'unspecified';
    structured: boolean;
    cardinality: 'single' | 'multiple';
    schemaExpectation?: string;
  };
  executionPosture: {
    strategy: 'deterministic-first' | 'ai-first' | 'hybrid' | 'blocked';
    rationale: string[];
  };
  successCriteria: string[];
  validationPlan: {
    sampleCases: ValidationSampleCase[];
    assertions: string[];
    confidenceCeiling: 'fulfilled' | 'uncertain' | 'partial';
  };
  designPrinciples: string[];
  riskFlags: string[];
  strategicAssumptions: Array<{
    statement: string;
    source: 'user-provided' | 'inferred' | 'knowledge';
  }>;
  knowledgeReferences: Array<{
    resourceId: string;
    noteId: string;
    appliedTo: string;
    summary: string;
  }>;
}
```

### 2. ValidationSampleCase

Minimal evidence object used by design/sample execution/review.

```ts
interface ValidationSampleCase {
  id: string;
  role: 'representative' | 'edge' | 'format';
  source: 'user-provided' | 'inferred' | 'synthetic';
  input: unknown;
  expectedResult?: unknown;
  assertions: string[];
}
```

Principles:

- no sample explosion
- 1-3 cases by default
- only cover core evidence
- synthetic only when real input is absent
- each sample must justify its existence through a distinct validation purpose

### 3. ArchitectureReview

This is not execution review. It is strategy review.

```ts
interface ArchitectureReview {
  strategyFit: 'good' | 'mixed' | 'poor';
  evidenceAdequacy: 'sufficient' | 'thin' | 'insufficient';
  syntheticReliance: 'none' | 'bounded' | 'high';
  keyFindings: string[];
  recommendedAdjustments: string[];
}
```

ArchitectureReview should answer:

- was the original strategy appropriate?
- did the evidence plan cover the right thing?
- did we over-rely on synthetic or inferred inputs?
- did execution reveal that the strategy itself was weak?

## Knowledge / Experience Layer

The architecture layer should consult external knowledge, not hardcoded heuristics.

This is how the strategist gains experience.

### Why external resources

- strategy guidance changes over time
- repeated mistakes should be captured without editing core code
- domain knowledge should remain inspectable and reviewable

### Recommended resource types

Use a separate resource family, for example:

- `data/skills/flow-designer/ARCHITECTURE_KNOWLEDGE.yml`

Suggested sections:

```yaml
version: 1
heuristics:
  - id: counting-deterministic-first
    match:
      operationModels: [count]
    guidance:
      executionPosture: deterministic-first
      rationale:
        - Counting tasks are easier to verify exactly.

validationPatterns:
  - id: counting-exact-assertions
    match:
      operationModels: [count]
    recommendedSamples:
      roles: [representative, edge]
    assertions:
      - Output must preserve exact counts.

knownRisks:
  - id: synthetic-overclaim
    match:
      sampleSource: synthetic
    note:
      - Synthetic-only validation should not auto-upgrade to fulfilled.

qualityBars:
  - id: synthetic-ceiling
    match:
      sampleSource: synthetic
    fulfillmentCeiling: uncertain

reviewRules:
  - id: synthetic-review-warning
    match:
      sampleSource: synthetic
    findings:
      - Do not overstate fulfillment when execution only validated synthetic evidence.
```

### What architecture should do with knowledge

It should:

- selectively retrieve only relevant guidance
- record which guidance was used
- convert guidance into strategy constraints
- use knowledge as experienced guidance rather than absolute law

It should not:

- blindly obey every note as a hard rule
- copy long prose into planner context
- turn knowledge resources into a second planner

### Knowledge sourcing principles

Knowledge resources should be:

- externalized and reviewable
- compact enough to retrieve selectively
- organized around strategy, validation, and risk
- versioned so changes in strategy posture are traceable

Knowledge resources should not:

- encode tactical tool sequences
- hardcode planner internals
- store giant prose playbooks that bloat context

## Sample Derivation Rules

Sample derivation must stay narrow and evidence-driven.

Order of precedence:

1. use concrete input from the requirement when present
2. infer a minimal representative sample when the requirement strongly implies one
3. synthesize a conservative sample only when necessary for design/validation

Examples:

### Consonant/vowel counting

Requirement:

- `입력의 자음과 모음의 수를 카운트해`

Architecture output should infer:

- likely input domain: Hangul text
- minimal representative sample: `한글`
- expected decomposition evidence:
  - `ㅎ ㅏ ㄴ ㄱ ㅡ ㄹ`
- expected validation target:
  - consonant/vowel counts can be checked exactly
- likely execution posture:
  - deterministic-first if capability exists
  - otherwise ai-first with conservative fulfillment posture

### Graph JSON explanation

Requirement:

- `그래프(json)를 보고 이게 뭐하는 것인지 설명(md) 해줘`

Architecture output should infer:

- missing real graph JSON
- synthetic graph sample allowed for design validation
- fulfillment ceiling must stay `uncertain`
- architecture review should explicitly record that explanatory quality against real input is still unverified

## Where It Fits

Recommended placement in the existing pipeline:

1. `analyzeFlowRequest`
2. `buildDesignBrief`
3. `prevalidateFlowDesignRequest`
4. `designFlowDraft`
5. `designFlowNodeConfigurations`
6. `runFlowSample`
7. `reflectFlowResult`

The architecture layer should sit between request analysis and tactical planning.

This is the intended control flow:

- `analyzeFlowRequest` provides a lightweight parse
- `buildDesignBrief` upgrades that into strategy
- planner chooses tactical steps using the brief
- design/node-config/assessment consume the same strategy source of truth

### Existing boundaries it should support

- [`src/flow/design/core.ts`](/Users/dujung/Documents/Codex/src/flow/design/core.ts)
- [`src/flow/agent/tools.ts`](/Users/dujung/Documents/Codex/src/flow/agent/tools.ts)
- [`src/agent/planner.ts`](/Users/dujung/Documents/Codex/src/agent/planner.ts)
- [`src/flow/node-config/design/core.ts`](/Users/dujung/Documents/Codex/src/flow/node-config/design/core.ts)
- [`src/product/normalize.ts`](/Users/dujung/Documents/Codex/src/product/normalize.ts)

## Consumers of the Brief

### Planner

Reads:

- mission summary
- output contract
- execution posture
- design principles
- risk flags
- fulfillment ceiling
- provenance-aware validation posture

Must not consume:

- explicit tactical tool ordering
- long knowledge prose
- architecture review findings as if they were tactical commands

### Flow draft design

Reads:

- mission
- execution posture
- validation samples
- design principles

### Node configuration

Reads:

- AI prompt hints
- expected output shape
- validation assertions

### Requirement assessment / review

Reads:

- sample provenance
- fulfillment ceiling
- evidence adequacy

## Collision Avoidance with the Planner

The architecture layer should not generate a plan.

Safe pattern:

- architecture emits `constraints + posture + evidence`
- planner emits `steps + sequence + references`

Unsafe pattern:

- architecture emits tactical step order
- planner independently emits a different tactical step order

That creates dual sources of truth.

Additional collision risks to avoid:

- architecture turns inferred samples into assumed real input
- planner silently redefines success criteria from the brief
- node-config treats architecture hints as final config
- review treats architecture guidance as proof that execution succeeded

## Failure and Fallback

The architecture layer must not become a single point of failure.

Fallback policy:

- if architecture generation fails, continue with a deterministic minimal brief
- record `architectureBriefStatus: unavailable` or equivalent
- never let architecture failure block the existing flow-design path entirely

Minimal fallback brief should still include:

- inferred output contract
- minimal execution posture
- minimal validation plan
- provenance flags

Fallback must preserve the existing planner-driven runtime rather than introducing a new hard stop.

## Observability

This layer must be inspectable.

Recommended artifacts:

- `architecture-brief.json`
- `architecture-review.json`

Recommended timeline events:

- `architecture_brief_started`
- `architecture_brief_completed`
- `architecture_review_completed`

Recommended prompt-lab display:

- whether the brief used synthetic evidence
- whether knowledge resources were referenced
- whether architecture imposed a fulfillment ceiling
- whether the displayed brief is full or fallback

## Rollout Plan

### Phase 1

- define `DesignBrief` schema
- add architecture knowledge resource
- produce brief only
- do not change planner yet

### Phase 2

- planner consumes a small subset of brief fields
- node-config consumes AI hint fields
- requirement assessment consumes fulfillment ceiling / provenance

### Phase 3

- add `ArchitectureReview`
- surface it in prompt-lab and result summaries

### Phase 4

- let architecture knowledge contribute to requirement assessment wording
- expose brief/review artifacts in prompt-lab session output
- measure whether architecture improves downstream stability without worsening planner latency too much

## Current Recommendation

Build the architecture layer as a general-purpose strategy generator, not a domain-specific helper.

Its main value is:

- making success criteria explicit
- keeping synthetic evidence honest
- reusing externalized experience
- stabilizing downstream design and review

If it stays compact, provenance-aware, and non-tactical, it should integrate cleanly with the existing planner-driven runtime.
