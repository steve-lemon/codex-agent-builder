import { join } from 'node:path';
import { addDiagnosticListener, removeDiagnosticListener, type DiagnosticListener } from '../diagnostics/logger';
import { FlowDesignProduct } from '../product';
import type { ProductDesignRunResult, ProductFlowSkill } from '../product/types';
import { FakeLlmGateway, GeminiGateway, OpenAiGateway, type LlmGateway } from '../llm';
import { appendNdjson, createPromptLabSession, writeJson, writeText } from './files';
import { getPromptLabManifest } from './manifest';
import { buildPromptLabCodexPromptRequest, buildPromptLabSelfReviewRequest } from './requests';
import type {
    PromptLabCodexPrompt,
    PromptLabEventHooks,
    PromptLabRunArtifacts,
    PromptLabSelfReview,
    PromptLabSessionConfig,
    PromptLabSessionRecord,
} from './types';

export interface PromptLabProductOptions {
    productFactory?: (gateway: LlmGateway) => FlowDesignProduct;
}

function createGateway(config: PromptLabSessionConfig): LlmGateway {
    if (config.provider === 'openai') {
        return new OpenAiGateway({ model: config.mainModel, liteModel: config.liteModel });
    }

    if (config.provider === 'gemini') {
        return new GeminiGateway({ model: config.mainModel, liteModel: config.liteModel });
    }

    return new FakeLlmGateway();
}

async function runFlowSkill(product: FlowDesignProduct, skillName: ProductFlowSkill, requirement: string, hooks?: PromptLabEventHooks) {
    if (skillName === 'flow-preflight-validator') {
        return await product.preflight(requirement, hooks);
    }
    if (skillName === 'node-config-designer') {
        return await product.designNodeConfiguration(requirement, hooks);
    }
    return await product.design(requirement, hooks);
}

function renderCodexPromptMarkdown(prompt: PromptLabCodexPrompt): string {
    return [
        `# ${prompt.title}`,
        '',
        prompt.summary,
        '',
        '## Prompt',
        '',
        prompt.codexPrompt,
        '',
        '## Usage Notes',
        '',
        ...prompt.usageNotes.map(note => `- ${note}`),
        '',
    ].join('\n');
}

function renderSummaryMarkdown(args: {
    session: PromptLabSessionRecord;
    result: ProductDesignRunResult;
    selfReview: PromptLabSelfReview;
    userFeedback: string;
    codexPrompt: PromptLabCodexPrompt;
}): string {
    return [
        '# Prompt Lab Session',
        '',
        `- Session ID: ${args.session.sessionId}`,
        `- Skill: ${args.session.config.skillName}`,
        `- Provider: ${args.session.config.provider}`,
        `- Main Model: ${args.session.config.mainModel}`,
        `- Lite Model: ${args.session.config.liteModel}`,
        `- Language: ${args.session.config.language}`,
        '',
        '## Requirement',
        '',
        args.session.requirement,
        '',
        '## Agent Result',
        '',
        `- Status: ${args.result.status}`,
        `- Summary: ${args.result.summary ?? 'n/a'}`,
        `- Success: ${String(args.result.success ?? false)}`,
        '',
        '## Self Review',
        '',
        args.selfReview.summary,
        '',
        ...args.selfReview.improvements.map(item => `- ${item}`),
        '',
        '## User Feedback',
        '',
        args.userFeedback || '(none)',
        '',
        '## Final Codex Prompt Summary',
        '',
        args.codexPrompt.summary,
        '',
    ].join('\n');
}

function buildArtifactPaths(sessionDir: string) {
    return {
        timelinePath: join(sessionDir, 'timeline.ndjson'),
        designPath: join(sessionDir, 'design-events.ndjson'),
        diagnosticsPath: join(sessionDir, 'diagnostics.ndjson'),
        resultPath: join(sessionDir, 'result.json'),
        selfReviewPath: join(sessionDir, 'self-review.json'),
        feedbackPath: join(sessionDir, 'user-feedback.txt'),
        promptJsonPath: join(sessionDir, 'codex-prompt.json'),
        promptMarkdownPath: join(sessionDir, 'codex-prompt.md'),
        summaryPath: join(sessionDir, 'summary.md'),
        artifactsPath: join(sessionDir, 'artifacts.json'),
    };
}

export class PromptLabProduct {
    constructor(private readonly options: PromptLabProductOptions = {}) {}

    async runRequirement(args: {
        config: PromptLabSessionConfig;
        requirement: string;
        hooks?: PromptLabEventHooks;
    }): Promise<{
        session: PromptLabSessionRecord;
        result: ProductDesignRunResult;
        gateway: LlmGateway;
    }> {
        const session = await createPromptLabSession(args.config, args.requirement);
        const gateway = createGateway(args.config);
        const product =
            this.options.productFactory?.(gateway) ??
            new FlowDesignProduct({
                runtimeOptions: {
                    llm: gateway,
                },
            });
        const paths = buildArtifactPaths(session.sessionDir);

        const diagnosticListener: DiagnosticListener = (level, event) => {
            void appendNdjson(paths.diagnosticsPath, { level, event });
            args.hooks?.onDiagnosticEvent?.({ level, event });
        };

        addDiagnosticListener(diagnosticListener);
        let result: ProductDesignRunResult;
        try {
            result = await runFlowSkill(product, args.config.skillName, args.requirement, {
                onTimelineEvent: event => {
                    void appendNdjson(paths.timelinePath, event);
                    args.hooks?.onTimelineEvent?.(event);
                },
                onDesignEvent: event => {
                    void appendNdjson(paths.designPath, event);
                    args.hooks?.onDesignEvent?.(event);
                },
            });
        } finally {
            removeDiagnosticListener(diagnosticListener);
        }

        await writeJson(paths.resultPath, result);
        return { session, result, gateway };
    }

    async createSelfReview(args: {
        session: PromptLabSessionRecord;
        result: ProductDesignRunResult;
        gateway: LlmGateway;
    }): Promise<PromptLabSelfReview> {
        const selfReview = await args.gateway.generateStructured(
            await buildPromptLabSelfReviewRequest({
                session: args.session,
                result: args.result,
                language: args.session.config.language,
            }),
        );
        await writeJson(buildArtifactPaths(args.session.sessionDir).selfReviewPath, selfReview);
        return selfReview;
    }

    async finalizeSession(args: {
        session: PromptLabSessionRecord;
        result: ProductDesignRunResult;
        selfReview: PromptLabSelfReview;
        userFeedback: string;
        gateway: LlmGateway;
    }): Promise<PromptLabRunArtifacts> {
        const paths = buildArtifactPaths(args.session.sessionDir);
        await writeText(paths.feedbackPath, `${args.userFeedback}\n`);

        const codexPrompt = await args.gateway.generateStructured(
            await buildPromptLabCodexPromptRequest({
                session: args.session,
                result: args.result,
                selfReview: args.selfReview,
                userFeedback: args.userFeedback,
                language: args.session.config.language,
            }),
        );

        await writeJson(paths.promptJsonPath, codexPrompt);
        await writeText(paths.promptMarkdownPath, renderCodexPromptMarkdown(codexPrompt));
        await writeText(
            paths.summaryPath,
            renderSummaryMarkdown({
                session: args.session,
                result: args.result,
                selfReview: args.selfReview,
                userFeedback: args.userFeedback,
                codexPrompt,
            }),
        );
        await writeJson(paths.artifactsPath, paths);

        return {
            session: args.session,
            result: args.result,
            selfReview: args.selfReview,
            userFeedback: args.userFeedback,
            codexPrompt,
        };
    }

    async run(args: {
        config: PromptLabSessionConfig;
        requirement: string;
        userFeedback: string;
        hooks?: PromptLabEventHooks;
    }): Promise<PromptLabRunArtifacts> {
        const { session, result, gateway } = await this.runRequirement(args);
        const selfReview = await this.createSelfReview({ session, result, gateway });
        return await this.finalizeSession({
            session,
            result,
            selfReview,
            userFeedback: args.userFeedback,
            gateway,
        });
    }

    async getDefaults() {
        const manifest = await getPromptLabManifest();
        return manifest.defaults;
    }
}
