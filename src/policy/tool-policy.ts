// Tool execution policy rules by risk level.
import type { ToolDefinition } from '../tools';
import type { ToolExecutionPolicy } from '../agent/types';

/** Resolves execution policy knobs from tool risk metadata. */
export function resolveToolExecutionPolicy(tool: ToolDefinition): ToolExecutionPolicy {
    if (tool.riskLevel === 'read-only') {
        return {
            riskLevel: tool.riskLevel,
            maxAttempts: 3,
            timeoutMs: 1500,
            useCircuitBreaker: true,
        };
    }

    if (tool.riskLevel === 'side-effecting') {
        return {
            riskLevel: tool.riskLevel,
            maxAttempts: 1,
            timeoutMs: 2000,
            useCircuitBreaker: false,
        };
    }

    return {
        riskLevel: tool.riskLevel,
        maxAttempts: 1,
        timeoutMs: 2000,
        useCircuitBreaker: false,
    };
}
