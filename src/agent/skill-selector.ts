// Agent runtime flow and data contracts.
/** Stable list of built-in skills known to the runtime. */
export const SKILL_NAMES = [
  'customer-support-reviewer',
  'research-brief-generator',
  'ops-automation-agent'
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** Maps user intent to a single skill using deterministic keyword rules. */
export class SkillSelector {
  select(userInput: string): SkillName {
    const text = userInput.toLowerCase();

    if (
      text.includes('research') ||
      text.includes('brief') ||
      text.includes('market') ||
      text.includes('compare')
    ) {
      return 'research-brief-generator';
    }

    if (
      text.includes('ops') ||
      text.includes('automation') ||
      text.includes('slack') ||
      text.includes('runbook')
    ) {
      return 'ops-automation-agent';
    }

    return 'customer-support-reviewer';
  }
}
