# Node Config Designer Resources

This folder owns the resource files used by the `node-config-designer` skill.

Files:
- `SKILL.md`: skill-level instructions for node configuration design
- `NODE_CONFIG_MANIFEST.yml`: node-config design manifest
  - defaults
  - knowledge
- `TOOLS.yml`: tool-pack metadata exposed by the `node-config-designer` runtime tool layer

Operational note:
- Put block- or strategy-specific configuration guidance here when it belongs to the node-config design surface.
- Keep shared runtime or fake-only resources outside this folder.
