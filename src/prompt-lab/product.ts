import { join } from 'node:path';
import { addDiagnosticListener, removeDiagnosticListener, type DiagnosticListener } from '../diagnostics/logger';
import { AgentError } from '../errors/agent-error';
import { renderFlowDesignSnapshotAsReagraph } from '../graph/renderer';
import { FlowDesignProduct } from '../product';
import type { ProductDesignRunResult, ProductFlowSkill } from '../product/types';
import { FakeLlmGateway, GeminiGateway, OpenAiGateway, type LlmGateway } from '../llm';
import { appendNdjson, createPromptLabSession, writeJson, writeText } from './files';
import { getPromptLabManifest } from './manifest';
import { buildPromptLabCodexPromptRequest, buildPromptLabSelfReviewRequest } from './requests';
import type {
    PromptLabArtifactPaths,
    PromptLabCodexPrompt,
    PromptLabEventHooks,
    PromptLabRunArtifacts,
    PromptLabSelfReview,
    PromptLabSessionConfig,
    PromptLabSessionRecord,
} from './types';
import yaml from 'js-yaml';

export interface PromptLabProductOptions {
    productFactory?: (gateway: LlmGateway) => FlowDesignProduct;
}

export class PromptLabRunError extends AgentError {
    constructor(
        message: string,
        public readonly session: PromptLabSessionRecord,
        public readonly paths: PromptLabArtifactPaths,
        public readonly clipboardText: string,
        options?: { cause?: unknown; code?: string },
    ) {
        super(message, {
            cause: options?.cause,
            code: options?.code ?? 'PROMPT_LAB_RUN_FAILED',
        });
    }
}

function assertProviderConfiguration(config: PromptLabSessionConfig): void {
    if (config.provider === 'openai') {
        const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
        const hasProxy = Boolean(process.env.OPENAI_STRUCTURED_PROXY_URL);
        if (!hasApiKey && !hasProxy) {
            throw new AgentError(
                'Prompt Lab cannot start with OpenAI because neither OPENAI_API_KEY nor OPENAI_STRUCTURED_PROXY_URL is configured.',
                {
                    code: 'PROMPT_LAB_OPENAI_NOT_CONFIGURED',
                },
            );
        }
        return;
    }

    if (config.provider === 'gemini') {
        const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
        if (!hasGeminiKey) {
            throw new AgentError(
                'Prompt Lab cannot start with Gemini because GEMINI_API_KEY or GOOGLE_API_KEY is missing.',
                {
                    code: 'PROMPT_LAB_GEMINI_NOT_CONFIGURED',
                },
            );
        }
    }
}

function createGateway(config: PromptLabSessionConfig): LlmGateway {
    assertProviderConfiguration(config);

    if (config.provider === 'openai') {
        return new OpenAiGateway({ model: config.mainModel, liteModel: config.liteModel });
    }

    if (config.provider === 'gemini') {
        return new GeminiGateway({ model: config.mainModel, liteModel: config.liteModel });
    }

    return new FakeLlmGateway();
}

async function runFlowSkill(
    product: FlowDesignProduct,
    skillName: ProductFlowSkill,
    requirement: string,
    hooks?: PromptLabEventHooks,
) {
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
        '## Requirement Assessment',
        '',
        `- Execution Succeeded: ${String(args.result.requirementAssessment.executionSucceeded)}`,
        `- Fulfillment Level: ${args.result.requirementAssessment.fulfillmentLevel}`,
        `- Summary: ${args.result.requirementAssessment.summary}`,
        ...(args.result.requirementAssessment.caveats.length > 0
            ? ['', ...args.result.requirementAssessment.caveats.map(item => `- ${item}`), '']
            : ['']),
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

function buildArtifactPaths(sessionDir: string): PromptLabArtifactPaths {
    return {
        timelinePath: join(sessionDir, 'timeline.ndjson'),
        designPath: join(sessionDir, 'design-events.ndjson'),
        diagnosticsPath: join(sessionDir, 'diagnostics.ndjson'),
        resultPath: join(sessionDir, 'result.json'),
        designedFlowPath: join(sessionDir, 'designed-flow.md'),
        designedFlowYamlPath: join(sessionDir, 'designed-flow.yml'),
        designedFlowGraphPath: join(sessionDir, 'designed-flow.reagraph.html'),
        selfReviewPath: join(sessionDir, 'self-review.json'),
        feedbackPath: join(sessionDir, 'user-feedback.txt'),
        promptJsonPath: join(sessionDir, 'codex-prompt.json'),
        promptMarkdownPath: join(sessionDir, 'codex-prompt.md'),
        summaryPath: join(sessionDir, 'summary.md'),
        artifactsPath: join(sessionDir, 'artifacts.json'),
        failureJsonPath: join(sessionDir, 'failure.json'),
        failureTextPath: join(sessionDir, 'failure.txt'),
    };
}

function serializeError(error: unknown): unknown {
    if (!(error instanceof Error)) {
        return {
            message: String(error),
        };
    }

    return {
        name: error.name,
        message: error.message,
        code: error instanceof AgentError ? error.code : undefined,
        stack: error.stack,
        cause: 'cause' in error ? serializeError((error as Error & { cause?: unknown }).cause) : undefined,
    };
}

function formatFailureClipboard(args: {
    session: PromptLabSessionRecord;
    paths: PromptLabArtifactPaths;
    error: unknown;
}): string {
    const message = args.error instanceof Error ? args.error.message : String(args.error);
    const stack = args.error instanceof Error && args.error.stack ? args.error.stack : '(no stack)';
    const causeMessage =
        args.error instanceof Error &&
        'cause' in args.error &&
        (args.error as Error & { cause?: unknown }).cause instanceof Error
            ? (args.error as Error & { cause?: Error }).cause?.message
            : undefined;

    return [
        'PROMPT_LAB_FAILURE',
        `sessionDir=${args.session.sessionDir}`,
        `skill=${args.session.config.skillName}`,
        `provider=${args.session.config.provider}`,
        `mainModel=${args.session.config.mainModel}`,
        `liteModel=${args.session.config.liteModel}`,
        `requirement=${args.session.requirement}`,
        `timeline=${args.paths.timelinePath}`,
        `design=${args.paths.designPath}`,
        `diagnostics=${args.paths.diagnosticsPath}`,
        `failureJson=${args.paths.failureJsonPath}`,
        `failureText=${args.paths.failureTextPath}`,
        `error=${message}`,
        `cause=${causeMessage ?? '(none)'}`,
        'stack<<EOF',
        stack,
        'EOF',
    ].join('\n');
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
        const paths = buildArtifactPaths(session.sessionDir);
        args.hooks?.onSessionPrepared?.({ session, paths });

        let gateway: LlmGateway | undefined;
        let diagnosticListener: DiagnosticListener | undefined;

        try {
            gateway = createGateway(args.config);
            const product =
                this.options.productFactory?.(gateway) ??
                new FlowDesignProduct({
                    runtimeOptions: {
                        llm: gateway,
                    },
                });

            diagnosticListener = (level, event) => {
                void appendNdjson(paths.diagnosticsPath, { level, event });
                args.hooks?.onDiagnosticEvent?.({ level, event });
            };
            addDiagnosticListener(diagnosticListener);

            const result = await runFlowSkill(product, args.config.skillName, args.requirement, {
                onTimelineEvent: event => {
                    void appendNdjson(paths.timelinePath, event);
                    args.hooks?.onTimelineEvent?.(event);
                },
                onDesignEvent: event => {
                    void appendNdjson(paths.designPath, event);
                    args.hooks?.onDesignEvent?.(event);
                },
            });

            await writeJson(paths.resultPath, result);
            await writeText(paths.designedFlowYamlPath, yaml.dump(result.finalFlow ?? null, { noRefs: true }));
            return { session, result, gateway };
        } catch (error) {
            const clipboardText = formatFailureClipboard({ session, paths, error });
            await writeJson(paths.failureJsonPath, {
                error: serializeError(error),
                session,
                paths,
            });
            await writeText(paths.failureTextPath, `${clipboardText}\n`);
            await writeJson(paths.artifactsPath, paths);

            throw new PromptLabRunError('Prompt Lab execution failed.', session, paths, clipboardText, {
                cause: error,
                code: error instanceof AgentError ? error.code : 'PROMPT_LAB_RUN_FAILED',
            });
        } finally {
            if (diagnosticListener) {
                removeDiagnosticListener(diagnosticListener);
            }
        }
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
