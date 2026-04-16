// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { SkillSelector } from './skill-selector';
import { MultiSkillRouter } from './skill-router';
import { buildDefaultToolRegistry } from '../tools';

describe('skill selector and router', () => {
    it('selects research skill for research-like prompts', async () => {
        const selector = new SkillSelector();
        const skill = await selector.select('Create a research brief comparing two vendors');
        expect(skill).toBe('research-brief-generator');
    });

    it('selects ops skill for ops-like prompts', async () => {
        const selector = new SkillSelector();
        const skill = await selector.select('Run ops automation and post to Slack');
        expect(skill).toBe('ops-automation-agent');
    });

    it('selects flow designer skill for flow-design-like prompts', async () => {
        const selector = new SkillSelector();
        const skill = await selector.select('키워드를 줄테니 블로그 타이틀 여러개 만들기');
        expect(skill).toBe('flow-designer');
    });

    it('selects flow designer skill for capability-gap requests such as email handling', async () => {
        const selector = new SkillSelector();
        const skill = await selector.select('이메일을 확인해서 답장 해줘');
        expect(skill).toBe('flow-designer');
    });

    it('defaults to customer support reviewer otherwise', async () => {
        const selector = new SkillSelector();
        const skill = await selector.select('Help me review this customer complaint');
        expect(skill).toBe('customer-support-reviewer');
    });

    it('exposes only tools allowed for selected skill', async () => {
        const router = new MultiSkillRouter(buildDefaultToolRegistry());
        const tools = router.toolNamesForSkill('research-brief-generator');
        expect(tools).toContain('webSearch');
        expect(tools).not.toContain('refundOrder');
        expect(tools).not.toContain('getCustomerById');
    });

    it('exposes only flow design tools for the flow designer skill', async () => {
        const router = new MultiSkillRouter(buildDefaultToolRegistry());
        const tools = router.toolNamesForSkill('flow-designer');
        expect(tools).toEqual([
            'analyzeFlowRequest',
            'listAvailableFlowBlocks',
            'assessFlowFeasibility',
            'probeFlowBlock',
            'designFlowDraft',
            'validateFlowDraft',
            'proposeBlockSpecUpdate',
            'runFlowSample',
            'reflectFlowResult',
        ]);
    });
});
