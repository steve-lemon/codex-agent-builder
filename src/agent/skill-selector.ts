// Agent runtime flow and data contracts.
export const SKILL_NAMES = [
  'customer-support-reviewer',
  'research-brief-generator',
  'ops-automation-agent'
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

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
