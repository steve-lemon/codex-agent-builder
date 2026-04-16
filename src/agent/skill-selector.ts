// Agent runtime flow and data contracts.
/** Stable list of built-in skills known to the runtime. */
export const SKILL_NAMES = [
    'customer-support-reviewer',
    'research-brief-generator',
    'ops-automation-agent',
    'flow-designer',
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** Maps user intent to a single skill using deterministic keyword rules. */
export class SkillSelector {
    async select(userInput: string): Promise<SkillName> {
        const text = userInput.toLowerCase();

        if (
            text.includes('research') ||
            text.includes('brief') ||
            text.includes('market') ||
            text.includes('compare')
        ) {
            return 'research-brief-generator';
        }

        if (text.includes('ops') || text.includes('automation') || text.includes('slack') || text.includes('runbook')) {
            return 'ops-automation-agent';
        }

        if (
            text.includes('flow') ||
            text.includes('pipeline') ||
            text.includes('블로그') ||
            text.includes('타이틀') ||
            text.includes('제목') ||
            text.includes('키워드')
        ) {
            return 'flow-designer';
        }

        return 'customer-support-reviewer';
    }
}
