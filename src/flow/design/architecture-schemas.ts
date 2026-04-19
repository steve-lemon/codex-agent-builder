import { z } from 'zod';

export const ArchitectureOperationModelSchema = z.enum([
    'classify',
    'count',
    'extract',
    'transform',
    'summarize',
    'explain',
    'generate',
    'validate',
    'route',
]);

export const DesignBriefInputFormatSchema = z.enum(['text', 'json', 'image', 'mixed', 'unknown']);
export const DesignBriefSourceSchema = z.enum(['user-provided', 'inferred', 'synthetic']);
export const DesignBriefOutputFormatSchema = z.enum(['json', 'plain-text', 'markdown', 'unspecified']);
export const DesignBriefExecutionStrategySchema = z.enum(['deterministic-first', 'ai-first', 'hybrid', 'blocked']);
export const ValidationSampleRoleSchema = z.enum(['representative', 'edge', 'format']);
export const ConfidenceCeilingSchema = z.enum(['fulfilled', 'uncertain', 'partial']);
export const ArchitectureReviewFitSchema = z.enum(['good', 'mixed', 'poor']);
export const ArchitectureReviewAdequacySchema = z.enum(['sufficient', 'thin', 'insufficient']);
export const ArchitectureReviewSyntheticRelianceSchema = z.enum(['none', 'bounded', 'high']);

export const ValidationSampleCaseSchema = z.object({
    id: z.string(),
    role: ValidationSampleRoleSchema,
    source: DesignBriefSourceSchema,
    input: z.unknown(),
    expectedResult: z.unknown().optional(),
    assertions: z.array(z.string()),
});

export const DesignBriefSchema = z.object({
    mission: z.object({
        summary: z.string(),
        goal: z.string(),
        operationModel: z.array(ArchitectureOperationModelSchema),
    }),
    inputContract: z.object({
        format: DesignBriefInputFormatSchema,
        source: DesignBriefSourceSchema,
        concreteInputPresent: z.boolean(),
        missingRequiredInput: z.boolean(),
        notes: z.array(z.string()),
    }),
    outputContract: z.object({
        format: DesignBriefOutputFormatSchema,
        structured: z.boolean(),
        cardinality: z.enum(['single', 'multiple']),
        schemaExpectation: z.string().optional(),
    }),
    executionPosture: z.object({
        strategy: DesignBriefExecutionStrategySchema,
        rationale: z.array(z.string()),
    }),
    successCriteria: z.array(z.string()),
    validationPlan: z.object({
        sampleCases: z.array(ValidationSampleCaseSchema),
        assertions: z.array(z.string()),
        confidenceCeiling: ConfidenceCeilingSchema,
    }),
    designPrinciples: z.array(z.string()),
    riskFlags: z.array(z.string()),
    strategicAssumptions: z.array(
        z.object({
            statement: z.string(),
            source: z.enum(['user-provided', 'inferred', 'knowledge']),
        }),
    ),
    knowledgeReferences: z.array(
        z.object({
            resourceId: z.string(),
            noteId: z.string(),
            appliedTo: z.string(),
            summary: z.string(),
        }),
    ),
});

export const ArchitectureReviewSchema = z.object({
    strategyFit: ArchitectureReviewFitSchema,
    evidenceAdequacy: ArchitectureReviewAdequacySchema,
    syntheticReliance: ArchitectureReviewSyntheticRelianceSchema,
    keyFindings: z.array(z.string()),
    recommendedAdjustments: z.array(z.string()),
});

const ArchitectureKnowledgeMatchSchema = z.object({
    operationModels: z.array(ArchitectureOperationModelSchema).optional(),
    taskTypes: z.array(z.string()).optional(),
    sampleSource: z.array(z.enum(['default', 'synthetic-graph-json'])).optional(),
    outputFormats: z.array(DesignBriefOutputFormatSchema).optional(),
});

export const ArchitectureKnowledgeResourceSchema = z.object({
    version: z.number().int().positive(),
    heuristics: z.array(
        z.object({
            id: z.string(),
            match: ArchitectureKnowledgeMatchSchema.default({}),
            guidance: z.object({
                executionPosture: DesignBriefExecutionStrategySchema.optional(),
                rationale: z.array(z.string()).optional(),
                designPrinciples: z.array(z.string()).optional(),
                assumptions: z.array(z.string()).optional(),
            }),
        }),
    ),
    validationPatterns: z.array(
        z.object({
            id: z.string(),
            match: ArchitectureKnowledgeMatchSchema.default({}),
            recommendedSamples: z
                .object({
                    roles: z.array(ValidationSampleRoleSchema).optional(),
                })
                .optional(),
            assertions: z.array(z.string()).optional(),
            successCriteria: z.array(z.string()).optional(),
        }),
    ),
    knownRisks: z.array(
        z.object({
            id: z.string(),
            match: ArchitectureKnowledgeMatchSchema.default({}),
            note: z.array(z.string()),
        }),
    ),
    qualityBars: z.array(
        z.object({
            id: z.string(),
            match: ArchitectureKnowledgeMatchSchema.default({}),
            fulfillmentCeiling: ConfidenceCeilingSchema,
        }),
    ),
    reviewRules: z.array(
        z.object({
            id: z.string(),
            match: ArchitectureKnowledgeMatchSchema.default({}),
            findings: z.array(z.string()).optional(),
            adjustments: z.array(z.string()).optional(),
        }),
    ),
});

export type ValidationSampleCaseRecord = z.infer<typeof ValidationSampleCaseSchema>;
export type DesignBriefRecord = z.infer<typeof DesignBriefSchema>;
export type ArchitectureReviewRecord = z.infer<typeof ArchitectureReviewSchema>;
export type ArchitectureKnowledgeResourceRecord = z.infer<typeof ArchitectureKnowledgeResourceSchema>;
