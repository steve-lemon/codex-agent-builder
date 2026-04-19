# Prompt Lab Resources

This folder owns the prompt-lab manifest used by the interactive CLI and the product service.

Files:
- `PROMPT_LAB_MANIFEST.yml`: CLI copy, defaults, self-review prompt, and Codex prompt synthesis prompt.
- `PROMPT_LAB_AUTO_POLICY.yml`: auto-run stop/warn rules used by `--auto`.

Update this folder when:
- the interactive CLI wording changes,
- the default session behavior changes,
- the self-review or final Codex prompt synthesis instructions need tuning,
- auto-stop / warn behavior should change without touching CLI code.
