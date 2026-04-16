// Skill implementations for the flow design agent pipeline.
import { AgentError } from '../errors/agent-error';
import { GraphExecutionEngine } from '../graph/executor';
import { AiGenerateBlock, InputBlock, ViewBlock } from '../flow/blocks';
import {
    createFlowDocument,
    createFlowNode,
    connectFlowPorts,
    getFlowPortById,
    validateFlowNode,
} from '../flow/document';
import { planFlowGraph } from '../flow/graph';
import { DefaultExecutableFlowNodeFactory } from '../flow/runtime';
import type { FlowDocument } from '../flow/types';
import type {
    FlowDesignAiGenerateRequest,
    FlowDesignAttemptState,
    FlowDesignReflection,
    FlowDesignSkill,
    FlowDesignSkillServices,
    FlowDesignTaskType,
    FlowDesignValidation,
} from './types';

function parseDesiredCount(userRequest: string): number {
    const digitMatch = userRequest.match(/(\d+)/);
    if (digitMatch) {
        const parsed = Number(digitMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('여러') ||
        lowered.includes('several') ||
        lowered.includes('multiple') ||
        lowered.includes('many') ||
        lowered.includes('ideas') ||
        lowered.includes('titles')
    ) {
        return 5;
    }

    return 1;
}

function inferTaskType(userRequest: string, wantsJson: boolean): FlowDesignTaskType {
    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        lowered.includes('타이틀') ||
        lowered.includes('제목')
    ) {
        return 'blog-title-generation';
    }
    if (wantsJson) {
        return 'json-generation';
    }
    if (lowered.trim()) {
        return 'text-generation';
    }

    return 'unknown';
}

function buildSampleInput(taskType: FlowDesignTaskType, userRequest: string): string {
    const lowered = userRequest.toLowerCase();
    if (lowered.includes('keyword') || lowered.includes('키워드')) {
        return '생산성 향상';
    }
    if (taskType === 'blog-title-generation') {
        return '원격 근무';
    }

    return '샘플 입력';
}

function buildSystemPrompt(state: FlowDesignAttemptState): string {
    const intent = state.intent!;
    const basePrompt =
        intent.taskType === 'blog-title-generation'
            ? 'You generate clear and catchy blog titles based on one keyword.'
            : intent.wantsJson
            ? 'You return concise structured output that can be safely parsed as JSON.'
            : 'You transform text requests into concise useful outputs.';

    if (state.improvementNotes.length === 0) {
        return basePrompt;
    }

    return `${basePrompt} Improvements to apply: ${state.improvementNotes.join(' | ')}`;
}

function buildUserPrompt(state: FlowDesignAttemptState): string {
    const intent = state.intent!;
    const desiredCountInstruction =
        intent.wantsMultiple && intent.desiredCount > 1
            ? `Return exactly ${intent.desiredCount} results.`
            : 'Return one result.';
    const formatInstruction = intent.wantsJson
        ? 'Return JSON only.'
        : intent.wantsMultiple
        ? 'Return each result on its own line.'
        : 'Return plain text.';

    const improvementText =
        state.improvementNotes.length > 0 ? ` Improvement notes: ${state.improvementNotes.join(' | ')}` : '';

    return `User request: ${intent.userRequest}. Sample input: ${intent.sampleInput}. ${desiredCountInstruction} ${formatInstruction}${improvementText}`;
}

function ensureRequiredBlocks(state: FlowDesignAttemptState, requiredBlockIds: string[]): void {
    for (const blockId of requiredBlockIds) {
        if (!state.availableBlocks.some(block => block.id === blockId)) {
            throw new AgentError(`Required flow block is not available for design: ${blockId}`);
        }
    }
}

function extractItems(output: unknown): string[] {
    if (Array.isArray(output)) {
        return output
            .map(item => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
            .filter(item => item.length > 0);
    }

    if (typeof output === 'string') {
        return output
            .split('\n')
            .map(line => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
            .filter(line => line.length > 0);
    }

    if (output && typeof output === 'object') {
        const items = (output as { items?: unknown }).items;
        if (Array.isArray(items)) {
            return extractItems(items);
        }
    }

    return [];
}

function createReflection(state: FlowDesignAttemptState): FlowDesignReflection {
    const intent = state.intent!;
    const execution = state.execution;
    if (!execution) {
        return {
            satisfied: false,
            summary: 'No execution result was produced.',
            issues: ['Example execution did not run.'],
            suggestedImprovements: ['Ensure the flow executes successfully before reflection.'],
        };
    }

    const issues: string[] = [];
    const suggestedImprovements: string[] = [];
    const output = execution.output;
    const items = extractItems(output);

    if (execution.status !== 'completed') {
        issues.push(`Example execution ended with status ${execution.status}.`);
        suggestedImprovements.push('Stabilize the flow execution path before retrying.');
    }

    if (intent.wantsJson) {
        const isJsonShape = output !== null && typeof output === 'object';
        if (!isJsonShape) {
            issues.push('The output was not JSON-shaped even though JSON output was requested.');
            suggestedImprovements.push('Force the AI block to return JSON only.');
        }
    }

    if (intent.wantsMultiple && items.length < intent.desiredCount) {
        issues.push(`The output only produced ${items.length} item(s) but ${intent.desiredCount} were requested.`);
        suggestedImprovements.push(`Ask for exactly ${intent.desiredCount} distinct results.`);
    }

    if (intent.taskType === 'blog-title-generation' && items.length > 0) {
        const likelyTitleCount = items.filter(item => item.length >= 6).length;
        if (likelyTitleCount === 0) {
            issues.push('The output did not look like usable blog titles.');
            suggestedImprovements.push('Make each result read like a publishable blog title.');
        }
    }

    return {
        satisfied: issues.length === 0,
        summary:
            issues.length === 0
                ? 'The sample flow output appears to satisfy the request.'
                : 'The sample flow output needs another design pass.',
        issues,
        suggestedImprovements,
    };
}

async function defaultMockGenerate(request: FlowDesignAiGenerateRequest): Promise<unknown> {
    const countMatch = request.prompt.match(/exactly\s+(\d+)\s+results?/i);
    const count = countMatch ? Number(countMatch[1]) : 1;
    const sampleInputMatch = request.prompt.match(/Sample input:\s*([^.]+)\./i);
    const sampleInput = sampleInputMatch?.[1]?.trim() ?? '샘플 입력';

    if (request.jsonOutput) {
        return {
            model: request.model,
            items: Array.from({ length: Math.max(1, count) }, (_, index) => `${sampleInput} 아이디어 ${index + 1}`),
        };
    }

    return Array.from({ length: Math.max(1, count) }, (_, index) => `${sampleInput} 블로그 타이틀 ${index + 1}`).join(
        '\n',
    );
}

/** Extracts intent from the user's natural-language request. */
export class IntentAnalysisSkill implements FlowDesignSkill {
    readonly name = 'intent-analysis';

    applies(): boolean {
        return true;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        const lowered = state.userRequest.toLowerCase();
        const wantsJson =
            lowered.includes('json') ||
            lowered.includes('structured') ||
            lowered.includes('객체') ||
            lowered.includes('구조화');
        const desiredCount = parseDesiredCount(state.userRequest);
        state.intent = {
            userRequest: state.userRequest,
            taskType: inferTaskType(state.userRequest, wantsJson),
            wantsJson,
            wantsMultiple: desiredCount > 1,
            desiredCount,
            sampleInput: buildSampleInput(inferTaskType(state.userRequest, wantsJson), state.userRequest),
        };
    }
}

/** Builds a candidate flow using only the blocks already available to the agent. */
export class FlowCompositionSkill implements FlowDesignSkill {
    readonly name = 'flow-composition';

    applies(state: FlowDesignAttemptState): boolean {
        return state.intent !== undefined;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        ensureRequiredBlocks(state, [InputBlock.id, AiGenerateBlock.id, ViewBlock.id]);

        let flow = createFlowDocument(state.availableBlocks);
        flow = createFlowNode(flow, InputBlock.id, {
            nodeId: 'system-input',
            label: 'System Input',
            config: {
                input: buildSystemPrompt(state),
            },
        }).flow;
        flow = createFlowNode(flow, InputBlock.id, {
            nodeId: 'prompt-input',
            label: 'Prompt Input',
            config: {
                input: buildUserPrompt(state),
            },
        }).flow;
        flow = createFlowNode(flow, AiGenerateBlock.id, {
            nodeId: 'ai-node',
            label: 'AI Generate',
            config: {
                model: 'mock-flow-model',
                jsonOutput: String(state.intent?.wantsJson ?? false),
            },
        }).flow;
        flow = createFlowNode(flow, ViewBlock.id, {
            nodeId: 'view-output',
            label: 'View Output',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'system-input',
            sourcePort: 'output',
            targetNodeId: 'ai-node',
            targetPort: 'system',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'prompt-input',
            sourcePort: 'output',
            targetNodeId: 'ai-node',
            targetPort: 'prompt',
        }).flow;
        flow = connectFlowPorts(flow, {
            sourceNodeId: 'ai-node',
            sourcePort: 'output',
            targetNodeId: 'view-output',
            targetPort: 'input',
        }).flow;

        state.flow = flow;
    }
}

/** Validates the flow draft and ensures it can be planned through the graph engine. */
export class FlowValidationSkill implements FlowDesignSkill {
    readonly name = 'flow-validation';

    applies(state: FlowDesignAttemptState): boolean {
        return state.flow !== undefined;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        const issues: string[] = [];
        for (const node of state.flow!.nodes) {
            const validation = validateFlowNode(state.flow!, node.id);
            if (!validation.isValid) {
                issues.push(...validation.issues.map(issue => issue.message));
            }
        }

        let plan: FlowDesignValidation['plan'];
        try {
            plan = planFlowGraph(state.flow!).plan;
        } catch (error) {
            issues.push(AgentError.from(error).message);
        }

        state.validation = {
            isValid: issues.length === 0,
            issues,
            plan,
        };
    }
}

/** Executes the designed flow with the shared graph executor and a mock AI runtime. */
export class FlowExecutionSkill implements FlowDesignSkill {
    readonly name = 'flow-execution';

    applies(state: FlowDesignAttemptState): boolean {
        return state.flow !== undefined && state.validation?.isValid === true;
    }

    async run(state: FlowDesignAttemptState, services: FlowDesignSkillServices): Promise<void> {
        const flow = state.flow!;
        const logs: string[] = [];
        let currentFlow: FlowDocument = flow;
        const factory = new DefaultExecutableFlowNodeFactory({
            logger: message => {
                logs.push(message);
            },
            aiGenerate: async request => {
                const extendedRequest: FlowDesignAiGenerateRequest = {
                    ...request,
                    iteration: state.iteration,
                    userRequest: state.userRequest,
                    improvementNotes: [...state.improvementNotes],
                };
                return await (services.aiGenerate ?? defaultMockGenerate)(extendedRequest);
            },
        });
        const planned = planFlowGraph(flow);
        const engine = new GraphExecutionEngine<string>(
            async input => {
                const runtime = factory.create(currentFlow, input.node.id);
                currentFlow = await runtime.execute(currentFlow);
                return input.node.id;
            },
            {
                maxConcurrency: 1,
            },
        );

        const graphRun = await engine.execute(planned.graph, planned.plan);
        state.execution = {
            status: graphRun.status,
            flow: currentFlow,
            output: getFlowPortById(currentFlow, 'ai-node:output')?.packet?.value,
            logs,
            graphRun,
        };
    }
}

/** Reflects on the sample run to decide whether another attempt is warranted. */
export class FlowReflectionSkill implements FlowDesignSkill {
    readonly name = 'flow-reflection';

    applies(state: FlowDesignAttemptState): boolean {
        return state.execution !== undefined;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        state.reflection = createReflection(state);
    }
}

/** Feeds reflection findings into the next iteration when the output is not good enough yet. */
export class FlowImprovementSkill implements FlowDesignSkill {
    readonly name = 'flow-improvement';

    applies(state: FlowDesignAttemptState): boolean {
        return state.reflection !== undefined;
    }

    async run(state: FlowDesignAttemptState): Promise<void> {
        if (state.reflection?.satisfied) {
            return;
        }

        for (const suggestion of state.reflection?.suggestedImprovements ?? []) {
            if (!state.improvementNotes.includes(suggestion)) {
                state.improvementNotes.push(suggestion);
            }
        }
    }
}

/** Default ordered skill pipeline used by the flow design agent. */
export function buildDefaultFlowDesignSkills(): FlowDesignSkill[] {
    return [
        new IntentAnalysisSkill(),
        new FlowCompositionSkill(),
        new FlowValidationSkill(),
        new FlowExecutionSkill(),
        new FlowReflectionSkill(),
        new FlowImprovementSkill(),
    ];
}
