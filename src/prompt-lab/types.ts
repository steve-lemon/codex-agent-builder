import type { DiagnosticEvent, DiagnosticLevel } from '../diagnostics/logger';
import type { ProductDesignRunResult, ProductFlowSkill } from '../product/types';
import type { UnifiedRunEvent } from '../observability/unified-timeline';
import type { FlowDesignEvent } from '../flow/design-monitor';

export type PromptLabProvider = 'openai' | 'gemini' | 'fake';
export type PromptLabLanguage = 'ko' | 'en';

export interface PromptLabSessionConfig {
    provider: PromptLabProvider;
    mainModel: string;
    liteModel: string;
    language: PromptLabLanguage;
    skillName: ProductFlowSkill;
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
    selfReviewPath: string;
    feedbackPath: string;
    promptJsonPath: string;
    promptMarkdownPath: string;
    summaryPath: string;
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

export interface PromptLabRunArtifacts {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    codexPrompt: PromptLabCodexPrompt;
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
