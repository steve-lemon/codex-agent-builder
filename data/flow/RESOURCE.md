# Flow Resources

This folder contains flow-level resources shared by the flow document, runtime,
and design layers.

## Files

- `BLOCK_POOL.yml`
  - Resource-backed pool of built-in block definitions.
  - Defines:
    - capability registry
    - capability categories
    - matching policy
    - built-in block definitions
    - block-authored node-config guidance

## Ownership

- This folder is owned by the shared flow layer, not by one skill.
- Skill-specific tuning should stay under `data/skills/<skill>/...`.
- Generic flow block additions or capability changes should be made here.

## Editing Guidance

- Add new capabilities before referencing them from a block.
- Adjust `matching.categoryPriority` or `matching.blockPriority` when you need
  deterministic block selection to prefer one built-in block over another.
- Keep capability categories coarse:
  - `input`
  - `process`
  - `view`
  - `ai`
- Prefer updating `BLOCK_POOL.yml` over hardcoding built-in block definitions in
  TypeScript.
