import {
    getBuiltinFlowBlocks,
    getFlowBlockCapabilityMap,
    getFlowCapabilityCategoryMap,
    getFlowBlockMatchingPolicy,
} from './block-pool';
import type { FlowCapabilityCategory } from './types';

export interface FlowBlockMatchCandidate {
    blockId: string;
    matchedCapabilities: string[];
    missingCapabilities: string[];
    matchedCategories: FlowCapabilityCategory[];
    score: number;
    allRequiredCapabilitiesMatched: boolean;
}

export interface FlowBlockMatchResult {
    requiredCapabilities: string[];
    requiredCategories: FlowCapabilityCategory[];
    candidates: FlowBlockMatchCandidate[];
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function getCategoryPriorityScore(
    matchedCategories: FlowCapabilityCategory[],
    categoryPriority: FlowCapabilityCategory[],
): number {
    if (categoryPriority.length === 0 || matchedCategories.length === 0) {
        return 0;
    }

    return matchedCategories.reduce((bestScore, category) => {
        const index = categoryPriority.indexOf(category);
        if (index === -1) {
            return bestScore;
        }
        return Math.max(bestScore, categoryPriority.length - index);
    }, 0);
}

function getBlockPriorityScore(blockId: string, blockPriority: string[]): number {
    const index = blockPriority.indexOf(blockId);
    if (index === -1) {
        return 0;
    }
    return blockPriority.length - index;
}

function sortCandidates(
    left: FlowBlockMatchCandidate,
    right: FlowBlockMatchCandidate,
    categoryPriority: FlowCapabilityCategory[],
    blockPriority: string[],
): number {
    if (left.allRequiredCapabilitiesMatched !== right.allRequiredCapabilitiesMatched) {
        return left.allRequiredCapabilitiesMatched ? -1 : 1;
    }
    const categoryPriorityDelta =
        getCategoryPriorityScore(right.matchedCategories, categoryPriority) -
        getCategoryPriorityScore(left.matchedCategories, categoryPriority);
    if (categoryPriorityDelta !== 0) {
        return categoryPriorityDelta;
    }
    const blockPriorityDelta =
        getBlockPriorityScore(right.blockId, blockPriority) - getBlockPriorityScore(left.blockId, blockPriority);
    if (blockPriorityDelta !== 0) {
        return blockPriorityDelta;
    }
    if (left.score !== right.score) {
        return right.score - left.score;
    }
    return left.blockId.localeCompare(right.blockId);
}

/** Resource-backed helper that matches blocks against required capabilities. */
export async function matchFlowBlocksByCapabilities(requiredCapabilities: string[]): Promise<FlowBlockMatchResult> {
    // TODO(flow): Expand matching policy beyond simple priority lists so
    // resource-driven scoring can account for preferred capability sets,
    // explicit penalties, and task-graph hints without pushing logic back into analysis.
    const normalizedRequiredCapabilities = unique(requiredCapabilities);
    const blocks = await getBuiltinFlowBlocks();
    const blockCapabilityMap = await getFlowBlockCapabilityMap();
    const capabilityCategoryMap = await getFlowCapabilityCategoryMap();
    const matchingPolicy = await getFlowBlockMatchingPolicy();

    const candidates = blocks
        .map<FlowBlockMatchCandidate>(block => {
            const blockCapabilities = blockCapabilityMap[block.id] ?? [];
            const matchedCapabilities = normalizedRequiredCapabilities.filter(capability =>
                blockCapabilities.includes(capability),
            );
            const missingCapabilities = normalizedRequiredCapabilities.filter(
                capability => !matchedCapabilities.includes(capability),
            );
            const matchedCategories = unique(
                matchedCapabilities
                    .map(capability => capabilityCategoryMap[capability])
                    .filter((category): category is FlowCapabilityCategory => category !== undefined),
            );

            return {
                blockId: block.id,
                matchedCapabilities,
                missingCapabilities,
                matchedCategories,
                score: matchedCapabilities.length,
                allRequiredCapabilitiesMatched: missingCapabilities.length === 0,
            };
        })
        .filter(candidate => candidate.score > 0 || normalizedRequiredCapabilities.length === 0)
        .sort((left, right) =>
            sortCandidates(left, right, matchingPolicy.categoryPriority, matchingPolicy.blockPriority),
        );

    const requiredCategories = unique(
        normalizedRequiredCapabilities
            .map(capability => capabilityCategoryMap[capability])
            .filter((category): category is FlowCapabilityCategory => category !== undefined),
    );

    return {
        requiredCapabilities: normalizedRequiredCapabilities,
        requiredCategories,
        candidates,
    };
}
