// DTO builders for flow-design summaries used by UI and persistence boundaries.

/** Compact DTO for flow-design details. */
export interface FlowDesignDetailsDto {
    improvements: string[];
    feasible: boolean;
    missingCapabilities: string[];
    designPassCount: number;
    taskGraphRefinementCount: number;
}

/** Builds a stable DTO from flow-design summary facts. */
export function toFlowDesignDetailsDto(args: {
    improvements?: string[];
    feasible: boolean;
    missingCapabilities?: string[];
    designPassCount?: number;
    taskGraphRefinementCount?: number;
}): FlowDesignDetailsDto {
    return {
        improvements: args.improvements ?? [],
        feasible: args.feasible,
        missingCapabilities: args.missingCapabilities ?? [],
        designPassCount: args.designPassCount ?? 0,
        taskGraphRefinementCount: args.taskGraphRefinementCount ?? 0,
    };
}
