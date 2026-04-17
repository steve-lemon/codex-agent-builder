# Skill Resource Layout

The `data/skills/` tree contains skill-owned extension resources.

## Structure

- `data/flow/*`
  - shared flow core resources
- `data/skills/<skill>/*`
  - skill-specific manifests, prompts, and tool exposure

## Current Skill-Owned Folders

- `flow-designer/`
  - `SKILL.md` at the root for runtime skill lookup
  - `FLOW_DESIGN_MANIFEST.yml` for manifests and prompt/config data
  - `TOOLS.yml` for runtime-visible tool metadata
  - `RESOURCE.md` for ownership and tuning notes
- `node-config-designer/`
  - `SKILL.md` at the root for runtime skill lookup
  - `FLOW_DESIGN_MANIFEST.yml` for manifests and prompt/config data
  - `TOOLS.yml` for runtime-visible tool metadata
  - `RESOURCE.md` for ownership and tuning notes
- `flow-preflight-validator/`
  - `SKILL.md` at the root for runtime skill lookup
  - `TOOLS.yml` for preflight-facing tool metadata
  - `RESOURCE.md` for ownership and tuning notes

## Editing Guidance

- Change `data/flow/*` when the resource belongs to the reusable flow core.
- Change `data/skills/<skill>/*` when the tuning or tool exposure belongs to one skill surface.
- Keep `SKILL.md` at the skill root unless runtime skill discovery is redesigned.
