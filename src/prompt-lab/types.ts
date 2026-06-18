import type { DiagnosticEvent, DiagnosticLevel } from '../diagnostics/logger';
import type { ProductDesignRunResult, ProductFlowSkill } from '../product/types';
import type { UnifiedRunEvent } from '../observability/unified-timeline';
import type { FlowDesignEvent } from '../flow/design-monitor';
import type { AdvisorEvaluationReport } from '../flow/design/advisor-evaluation';
import type { ArchitectureReview, DesignBrief } from '../flow/design/types';

export type PromptLabProvider = 'openai' | 'gemini' | 'fake';
export type PromptLabLanguage = 'ko' | 'en';
export type PromptLabMode = 'run' | 'advisor-eval';

export interface PromptLabSessionConfig {
    mode: PromptLabMode;
    provider: PromptLabProvider;
    mainModel: string;
    liteModel: string;
    language: PromptLabLanguage;
    skillName?: ProductFlowSkill;
    outputRoot?: string;
}

export interface PromptLabSessionRecord {
    sessionId: string;
    sessionDir: string;
    startedAt: string;
    requirement: string;
    config: PromptLabSessionConfig;
}

export interface PromptLabArtifactPaths {
    timelinePath: string;
    designPath: string;
    diagnosticsPath: string;
    resultPath: string;
    designedFlowPath: string;
    designedFlowYamlPath: string;
    designedFlowGraphPath: string;
    advisorEvaluationJsonPath: string;
    advisorEvaluationMarkdownPath: string;
    selfReviewPath: string;
    feedbackPath: string;
    promptJsonPath: string;
    promptMarkdownPath: string;
    summaryPath: string;
    executionTimingJsonPath: string;
    architectureBriefJsonPath: string;
    architectureBriefMarkdownPath: string;
    architectureReviewJsonPath: string;
    architectureReviewMarkdownPath: string;
    artifactsPath: string;
    failureJsonPath: string;
    failureTextPath: string;
}

export interface PromptLabSelfReview {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
    recommendedPromptFocus: string[];
}

export interface PromptLabCodexPrompt {
    title: string;
    summary: string;
    codexPrompt: string;
    usageNotes: string[];
}

export interface PromptLabAdvisorTimingDetail {
    advisorId: string;
    callCount: number;
    totalDurationMs: number;
    averageDurationMs: number;
    maxDurationMs: number;
}

export interface PromptLabStageTimingDetail {
    stageId: string;
    durationMs: number;
}

export interface PromptLabToolTimingDetail {
    toolName: string;
    callCount: number;
    totalDurationMs: number;
    averageDurationMs: number;
    maxDurationMs: number;
    lastError?: string;
}

export interface PromptLabFailureSummary {
    toolName?: string;
    stepId?: string;
    message: string;
}

export interface PromptLabExecutionTimingSummary {
    advisorTimingStatus: 'observed' | 'not-observed';
    totalDurationMs: number;
    advisorCallCount: number;
    advisorTotalDurationMs: number;
    advisorTimeShare: number | null;
    advisors: PromptLabAdvisorTimingDetail[];
    stages: PromptLabStageTimingDetail[];
    tools: PromptLabToolTimingDetail[];
    lastFailure?: PromptLabFailureSummary;
}

export interface PromptLabRunArtifacts {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    advisorEvaluation?: AdvisorEvaluationReport;
    executionTiming?: PromptLabExecutionTimingSummary;
    architectureBrief?: DesignBrief;
    architectureReview?: ArchitectureReview;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    codexPrompt: PromptLabCodexPrompt;
}

export interface PromptLabAdvisorEvalArtifacts {
    session: PromptLabSessionRecord;
    advisorEvaluation: AdvisorEvaluationReport;
}

export interface PromptLabDiagnosticEntry {
    level: DiagnosticLevel;
    event: DiagnosticEvent;
}

export interface PromptLabEventHooks {
    onTimelineEvent?: (event: UnifiedRunEvent) => void;
    onDesignEvent?: (event: FlowDesignEvent) => void;
    onDiagnosticEvent?: (entry: PromptLabDiagnosticEntry) => void;
    onSessionPrepared?: (args: { session: PromptLabSessionRecord; paths: PromptLabArtifactPaths }) => void;
}

export interface PromptLabSelectableModelOption {
    value: string;
    label: string;
}
