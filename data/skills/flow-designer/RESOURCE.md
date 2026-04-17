# Flow Designer Resources

This folder owns the resource files used by the `flow-designer` skill.

Files:
- `SKILL.md`: skill-level instructions for planning and design behavior
- `FLOW_DESIGN_MANIFEST.yml`: flow-design core manifest
  - task types
  - task graph templates
  - classifier prompts
  - defaults
  - knowledge
- `TOOLS.yml`: tool-pack metadata exposed by the `flow-designer` runtime tool layer

Operational note:
- Keep flow-design behavior tuning in this folder when the change is specific to the `flow-designer` skill.
- Shared runtime resources should stay under `data/runtime/`.
- Shared cross-skill tool packs should stay under `data/tools/`.
