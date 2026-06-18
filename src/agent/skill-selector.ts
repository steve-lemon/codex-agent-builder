// Agent runtime flow and data contracts.
/** Stable list of built-in skills known to the runtime. */
export const SKILL_NAMES = [
    'customer-support-reviewer',
    'research-brief-generator',
    'ops-automation-agent',
    'flow-designer',
    'node-config-designer',
    'flow-preflight-validator',
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
            text.includes('node config') ||
            text.includes('node configuration') ||
            text.includes('시스템 프롬프트') ||
            text.includes('프롬프트 설정') ||
            text.includes('모델 설정') ||
            text.includes('노드 설정')
        ) {
            return 'node-config-designer';
        }

        if (
            text.includes('preflight') ||
            text.includes('feasibility') ||
            text.includes('가능한지') ||
            text.includes('사전 검증') ||
            text.includes('검증해줘')
        ) {
            return 'flow-preflight-validator';
        }

        if (
            text.includes('flow') ||
            text.includes('pipeline') ||
            text.includes('블로그') ||
            text.includes('타이틀') ||
            text.includes('제목') ||
            text.includes('키워드') ||
            text.includes('email') ||
            text.includes('mail') ||
            text.includes('reply') ||
            text.includes('답장') ||
            text.includes('이메일')
        ) {
            return 'flow-designer';
        }

        return 'customer-support-reviewer';
    }
}
