// DTO builders for flow-design summaries used by UI and persistence boundaries.

/** Compact DTO for flow-design details. */
export interface FlowDesignDetailsDto {
    improvements: string[];
    feasible: boolean;
    missingCapabilities: string[];
    designPassCount: number;
    taskGraphRefinementCount: number;
}

/** Creates an empty-but-valid flow-design DTO for fallback and compatibility paths. */
export function createEmptyFlowDesignDetailsDto(overrides: Partial<FlowDesignDetailsDto> = {}): FlowDesignDetailsDto {
    return {
        improvements: [],
        feasible: true,
        missingCapabilities: [],
        designPassCount: 0,
        taskGraphRefinementCount: 0,
        ...overrides,
    };
}

/** Builds a stable DTO from flow-design summary facts. */
export function toFlowDesignDetailsDto(args: {
    improvements?: string[];
    feasible: boolean;
    missingCapabilities?: string[];
    designPassCount?: number;
    taskGraphRefinementCount?: number;
}): FlowDesignDetailsDto {
    return createEmptyFlowDesignDetailsDto({
        improvements: args.improvements ?? [],
        feasible: args.feasible,
        missingCapabilities: args.missingCapabilities ?? [],
        designPassCount: args.designPassCount ?? 0,
        taskGraphRefinementCount: args.taskGraphRefinementCount ?? 0,
    });
}
