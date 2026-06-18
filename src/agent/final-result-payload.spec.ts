// Vitest specs for skill-specific final-result payload helpers.
import { describe, expect, it } from 'vitest';
import {
    buildFlowDesignerPayload,
    buildFlowPreflightValidatorPayload,
    buildNodeConfigDesignerPayload,
    getFlowDesignerPayload,
    getFlowPreflightValidatorPayload,
    getNodeConfigDesignerPayload,
} from './final-result-payload';

describe('final-result payload helpers', () => {
    it('builds and reads flow-designer payloads', () => {
        const payload = buildFlowDesignerPayload({
            feasible: true,
            designPassCount: 3,
            taskGraphRefinementCount: 2,
            configuredNodeCount: 4,
            probeInsightCount: 1,
        });

        expect(payload).toEqual({
            kind: 'flow-designer',
            feasible: true,
            designPassCount: 3,
            taskGraphRefinementCount: 2,
            configuredNodeCount: 4,
            probeInsightCount: 1,
            missingCapabilities: [],
        });
        expect(getFlowDesignerPayload(payload)).toEqual(payload);
        expect(getFlowPreflightValidatorPayload(payload)).toBeUndefined();
    });

    it('builds and reads flow-preflight payloads', () => {
        const payload = buildFlowPreflightValidatorPayload({
            feasible: false,
            missingCapabilities: ['email-read'],
            proposedBlockIds: ['email-read-block'],
        });

        expect(payload).toEqual({
            kind: 'flow-preflight-validator',
            feasible: false,
            missingCapabilities: ['email-read'],
            proposedBlockIds: ['email-read-block'],
        });
        expect(getFlowPreflightValidatorPayload(payload)).toEqual(payload);
        expect(getNodeConfigDesignerPayload(payload)).toBeUndefined();
    });

    it('builds and reads node-config payloads', () => {
        const payload = buildNodeConfigDesignerPayload({
            suggestedNextTools: ['designFlowNodeConfigurations'],
        });

        expect(payload).toEqual({
            kind: 'node-config-designer',
            requiresExistingFlowDraft: true,
            suggestedNextTools: ['designFlowNodeConfigurations'],
        });
        expect(getNodeConfigDesignerPayload(payload)).toEqual(payload);
        expect(getFlowDesignerPayload(payload)).toBeUndefined();
    });
});
