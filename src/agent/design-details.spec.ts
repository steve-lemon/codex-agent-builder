// Vitest specs for DTO-first final-result design details helpers.
import { describe, expect, it } from 'vitest';
import { createEmptyFlowDesignDetailsDto } from '../flow-design/dto';
import { createEmptyNodeConfigDesignDetailsDto } from '../node-config-design/dto';
import { buildFinalResultDesignDetails, getFlowDesignDetails, getNodeConfigurationDetails } from './design-details';

describe('design-details helpers', () => {
    it('builds compatibility fields from DTOs in one place', () => {
        const details = buildFinalResultDesignDetails({
            flowDesign: createEmptyFlowDesignDetailsDto({
                improvements: ['Improve structure'],
                designPassCount: 2,
            }),
            nodeConfiguration: createEmptyNodeConfigDesignDetailsDto({
                improvements: ['Tighten AI strategy'],
                appliedStrategies: ['ai-generation'],
                nodeStrategyAssignments: [{ nodeId: 'ai-node', strategyId: 'ai-generation' }],
                configuredNodeCount: 1,
                probeInsightCount: 1,
            }),
        });

        expect(details.flowDesign?.designPassCount).toBe(2);
        expect(details.flowDesignImprovements).toEqual(['Improve structure']);
        expect(details.nodeConfiguration?.appliedStrategies).toEqual(['ai-generation']);
        expect(details.appliedNodeConfigStrategies).toEqual(['ai-generation']);
        expect(details.nodeStrategyAssignments).toEqual([{ nodeId: 'ai-node', strategyId: 'ai-generation' }]);
        expect(details.configuredNodeCount).toBe(1);
        expect(details.probeInsightCount).toBe(1);
    });

    it('prefers DTO fields when reading final-result design details', () => {
        const details = buildFinalResultDesignDetails({
            flowDesign: createEmptyFlowDesignDetailsDto({
                improvements: ['Use JSON mode'],
                designPassCount: 3,
            }),
            nodeConfiguration: createEmptyNodeConfigDesignDetailsDto({
                improvements: ['Strengthen prompt strategy'],
                configuredNodeCount: 4,
            }),
        });

        expect(getFlowDesignDetails(details)).toEqual(details.flowDesign);
        expect(getNodeConfigurationDetails(details)).toEqual(details.nodeConfiguration);
    });

    it('falls back to legacy compatibility fields when DTO fields are missing', () => {
        const flowDetails = getFlowDesignDetails({
            flowDesignImprovements: ['Fallback flow note'],
            nodeConfigStrategyImprovements: [],
        });
        const nodeDetails = getNodeConfigurationDetails({
            flowDesignImprovements: [],
            nodeConfigStrategyImprovements: ['Fallback node note'],
            appliedNodeConfigStrategies: ['buffer-timing'],
            nodeStrategyAssignments: [{ nodeId: 'buffer-node', strategyId: 'buffer-timing' }],
            configuredNodeCount: 1,
            probeInsightCount: 2,
        });

        expect(flowDetails).toEqual(
            createEmptyFlowDesignDetailsDto({
                improvements: ['Fallback flow note'],
            }),
        );
        expect(nodeDetails).toEqual(
            createEmptyNodeConfigDesignDetailsDto({
                improvements: ['Fallback node note'],
                appliedStrategies: ['buffer-timing'],
                nodeStrategyAssignments: [{ nodeId: 'buffer-node', strategyId: 'buffer-timing' }],
                configuredNodeCount: 1,
                probeInsightCount: 2,
            }),
        );
    });
});
