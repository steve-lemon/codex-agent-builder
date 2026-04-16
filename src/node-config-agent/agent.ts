// Sub-agent that specializes in configuring flow nodes after the graph structure exists.
import { validateFlowNode } from '../flow/document';
import type { FlowDocument, FlowNode } from '../flow/types';
import type {
    NodeConfigurationDesignInput,
    NodeConfigurationDesignResult,
    NodeConfigurationSuggestion,
    NodeConfigurationValidationResult,
} from './types';

function inferTaskType(
    userRequest: string,
    wantsJson: boolean,
): 'blog-title-generation' | 'json-generation' | 'text-generation' {
    const lowered = userRequest.toLowerCase();
    if (
        lowered.includes('blog') ||
        lowered.includes('title') ||
        userRequest.includes('타이틀') ||
        userRequest.includes('제목')
    ) {
        return 'blog-title-generation';
    }
    if (wantsJson) {
        return 'json-generation';
    }
    return 'text-generation';
}

function buildSystemPrompt(input: NodeConfigurationDesignInput): string {
    const taskType = inferTaskType(input.userRequest, input.wantsJson);
    const basePrompt =
        taskType === 'blog-title-generation'
            ? 'You generate clear and catchy blog titles based on one keyword.'
            : input.wantsJson
            ? 'You return concise structured output that can be safely parsed as JSON.'
            : 'You transform text requests into concise useful outputs.';

    return input.improvementNotes && input.improvementNotes.length > 0
        ? `${basePrompt} Improvements to apply: ${input.improvementNotes.join(' | ')}`
        : basePrompt;
}

function buildUserPrompt(input: NodeConfigurationDesignInput): string {
    const desiredCountInstruction =
        input.desiredCount > 1 ? `Return exactly ${input.desiredCount} results.` : 'Return one result.';
    const formatInstruction = input.wantsJson
        ? 'Return JSON only.'
        : input.desiredCount > 1
        ? 'Return each result on its own line.'
        : 'Return plain text.';
    const improvementText =
        input.improvementNotes && input.improvementNotes.length > 0
            ? ` Improvement notes: ${input.improvementNotes.join(' | ')}`
            : '';

    return `User request: ${input.userRequest}. ${desiredCountInstruction} ${formatInstruction}${improvementText}`;
}

function selectModel(input: NodeConfigurationDesignInput): string {
    const taskType = inferTaskType(input.userRequest, input.wantsJson);
    if (input.wantsJson) {
        return 'mock-structured-gpt';
    }
    if (taskType === 'blog-title-generation') {
        return 'mock-blog-gpt';
    }
    return 'mock-flow-model';
}

function applyNodeConfig(node: FlowNode, config: Record<string, string>): FlowNode {
    return {
        ...node,
        config,
    };
}

/** Designs concrete per-node configuration values for an already-structured flow draft. */
export class NodeConfigDesignAgent {
    design(input: NodeConfigurationDesignInput): NodeConfigurationDesignResult {
        const suggestions: NodeConfigurationSuggestion[] = [];
        const nextFlow: FlowDocument = {
            ...input.flow,
            nodes: input.flow.nodes.map(node => {
                const existingConfig = { ...(node.config ?? {}) };

                if (node.blockId === 'input' && node.id === 'system-input') {
                    const config = {
                        ...existingConfig,
                        input: buildSystemPrompt(input),
                    };
                    suggestions.push({
                        nodeId: node.id,
                        blockId: node.blockId,
                        config,
                        rationale: [
                            'Populate the system prompt so downstream AI behavior is constrained consistently.',
                        ],
                    });
                    return applyNodeConfig(node, config);
                }

                if (node.blockId === 'input' && node.id === 'prompt-input') {
                    const config = {
                        ...existingConfig,
                        input: buildUserPrompt(input),
                    };
                    suggestions.push({
                        nodeId: node.id,
                        blockId: node.blockId,
                        config,
                        rationale: [
                            'Populate the user-facing prompt with output count, format, and improvement hints.',
                        ],
                    });
                    return applyNodeConfig(node, config);
                }

                if (node.blockId === 'ai-generate') {
                    const config = {
                        ...existingConfig,
                        model: selectModel(input),
                        jsonOutput: String(input.wantsJson),
                    };
                    suggestions.push({
                        nodeId: node.id,
                        blockId: node.blockId,
                        config,
                        rationale: [
                            'Choose an AI model profile that matches the requested output style.',
                            'Keep jsonOutput aligned with the request so downstream parsing expectations stay stable.',
                        ],
                    });
                    return applyNodeConfig(node, config);
                }

                if (node.blockId === 'buffer') {
                    const config = {
                        ...existingConfig,
                        wait: existingConfig.wait ?? '0',
                    };
                    suggestions.push({
                        nodeId: node.id,
                        blockId: node.blockId,
                        config,
                        rationale: [
                            'Ensure buffer nodes have an explicit wait configuration for deterministic execution.',
                        ],
                    });
                    return applyNodeConfig(node, config);
                }

                return node;
            }),
        };

        return {
            flow: nextFlow,
            suggestions,
            summary: `Configured ${suggestions.length} node(s) with block-specific settings.`,
        };
    }

    validate(flow: FlowDocument): NodeConfigurationValidationResult {
        const issues: string[] = [];

        for (const node of flow.nodes) {
            const validation = validateFlowNode(flow, node.id);
            issues.push(...validation.issues.map(issue => issue.message));

            if (node.blockId === 'ai-generate') {
                if (!node.config?.model?.trim()) {
                    issues.push(`AI node is missing a model configuration: ${node.id}`);
                }
                if (!node.config?.jsonOutput?.trim()) {
                    issues.push(`AI node is missing a jsonOutput configuration: ${node.id}`);
                }
            }

            if (node.blockId === 'input' && (node.id === 'system-input' || node.id === 'prompt-input')) {
                if (!node.config?.input?.trim()) {
                    issues.push(`Input node is missing prompt text: ${node.id}`);
                }
            }
        }

        return {
            isValid: issues.length === 0,
            issues,
        };
    }
}
