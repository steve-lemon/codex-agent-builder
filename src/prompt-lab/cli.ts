import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import yaml from 'js-yaml';
import { ensureProjectEnvLoaded } from '../env/project-env';
import { getPromptLabLanguageCopy, getPromptLabManifest, getPromptLabModelOptions } from './manifest';
import { PromptLabProduct, PromptLabRunError } from './product';
import type {
    PromptLabRunArtifacts,
    PromptLabMode,
    PromptLabArtifactPaths,
    PromptLabDiagnosticEntry,
    PromptLabExecutionTimingSummary,
    PromptLabLanguage,
    PromptLabProvider,
    PromptLabSelectableModelOption,
    PromptLabSessionConfig,
} from './types';
import type { ProductFlowSkill } from '../product/types';
import type { FlowDesignEvent, FlowDesignGraphSnapshot, FlowDesignNodePhase } from '../flow/design-monitor';
import type { UnifiedRunEvent } from '../observability/unified-timeline';
import type { TraceEvent } from '../observability/types';
import { renderFlowDesignSnapshotAsReagraph } from '../graph/renderer';
import {
    cachePromptLabRequirement,
    getPromptLabAdvisorEvaluationHistoryPath,
    readPromptLabLastRun,
    readPromptLabRequirementHistory,
    writeText,
} from './files';

function resolveDefaultProvider(providerOrder: PromptLabProvider[]): PromptLabProvider {
    if (process.env.OPENAI_API_KEY) {
        return providerOrder.includes('openai') ? 'openai' : providerOrder[0]!;
    }
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
        return providerOrder.includes('gemini') ? 'gemini' : providerOrder[0]!;
    }
    return providerOrder[0]!;
}

function defaultMainModel(provider: PromptLabProvider): string {
    if (provider === 'openai') {
        return process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
    }
    if (provider === 'gemini') {
        return process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    }
    return 'fake-main';
}

function defaultLiteModel(provider: PromptLabProvider, mainModel: string): string {
    if (provider === 'openai') {
        return process.env.OPENAI_LITE_MODEL ?? mainModel;
    }
    if (provider === 'gemini') {
        return process.env.GEMINI_LITE_MODEL ?? mainModel;
    }
    return 'fake-lite';
}

async function readMultilineFeedback(
    rl: ReturnType<typeof createInterface>,
    prompt: string,
    doneHint: string,
): Promise<string> {
    output.write(`${prompt}\n${doneHint}\n`);
    const lines: string[] = [];
    while (true) {
        const line = await rl.question('> ');
        if (line.trim() === '') {
            break;
        }
        lines.push(line);
    }
    return lines.join('\n');
}

function normalizeSkill(value: string, fallback: ProductFlowSkill): ProductFlowSkill {
    const normalized = value.trim().toLowerCase();
    if (
        normalized === 'flow-preflight-validator' ||
        normalized === 'flow-designer' ||
        normalized === 'node-config-designer'
    ) {
        return normalized;
    }
    return fallback;
}

function printSessionHeader(
    sessionDir: string,
    paths: PromptLabArtifactPaths,
    options: {
        includeFailureArtifacts?: boolean;
        includeAdvisorArtifacts?: boolean;
        includeFlowArtifacts?: boolean;
    } = {},
): void {
    const showIfExists = (label: string, path: string) => {
        if (existsSync(path)) {
            output.write(`${label}: ${path}\n`);
        }
    };

    output.write('\n=== Prompt Lab Session ===\n');
    output.write(`session: ${sessionDir}\n`);
    output.write(`timeline: ${paths.timelinePath}\n`);
    showIfExists('design', paths.designPath);
    showIfExists('diagnostics', paths.diagnosticsPath);
    showIfExists('execution timing', paths.executionTimingJsonPath);
    if (options.includeFlowArtifacts !== false) {
        showIfExists('designed flow', paths.designedFlowPath);
        showIfExists('designed flow yaml', paths.designedFlowYamlPath);
        showIfExists('designed flow graph', paths.designedFlowGraphPath);
    }
    if (options.includeAdvisorArtifacts) {
        showIfExists('advisor evaluation', paths.advisorEvaluationMarkdownPath);
        showIfExists('advisor evaluation json', paths.advisorEvaluationJsonPath);
    }
    if (options.includeFailureArtifacts) {
        showIfExists('failure text', paths.failureTextPath);
        showIfExists('failure json', paths.failureJsonPath);
    } else {
        output.write('failure artifacts: generated only on failure\n');
    }
    output.write('==========================\n\n');
}

function printAdvisorEvaluationSummary(args: {
    language: PromptLabLanguage;
    advisorEvaluation: NonNullable<PromptLabRunArtifacts['advisorEvaluation']>;
    advisorHistoryPath?: string;
}): void {
    const isKorean = args.language === 'ko';
    const localizeSuitability = (value: string) =>
        isKorean
            ? {
                  suitable: '적합',
                  borderline: '경계',
                  'not-suitable': '부적합',
                  inconclusive: '판단 불가',
              }[value] ?? value
            : value;
    const localizeLatencyRisk = (value: string) =>
        isKorean
            ? {
                  acceptable: '양호',
                  warning: '주의',
                  high: '높음',
              }[value] ?? value
            : value;
    const localizeStatus = (value: string) =>
        isKorean
            ? {
                  passed: '통과',
                  failed: '실패',
                  inconclusive: '판단 불가',
              }[value] ?? value
            : value;
    output.write(`${isKorean ? '=== Advisor 평가 ===' : '=== Advisor Evaluation ==='}\n`);
    output.write(
        `${isKorean ? 'Lite 모델 적합' : 'Suitable for lite usage'}: ${String(
            args.advisorEvaluation.suitableForLiteUsage,
        )}\n`,
    );
    output.write(
        `${isKorean ? '품질 적합도' : 'Quality suitability'}: ${localizeSuitability(
            args.advisorEvaluation.qualitySuitability,
        )}\n`,
    );
    output.write(
        `${isKorean ? '지연 리스크' : 'Latency risk'}: ${localizeLatencyRisk(args.advisorEvaluation.latencyRisk)}\n`,
    );
    output.write(
        `${isKorean ? '전체 시나리오 통과율' : 'Overall scenario pass rate'}: ${
            args.advisorEvaluation.overallPassRate
        }\n`,
    );
    output.write(
        `${isKorean ? 'Lite 직접 판정 비율' : 'Lite decision rate'}: ${
            args.advisorEvaluation.overallLiteDecisionRate
        }\n`,
    );
    output.write(
        `${isKorean ? 'Lite 직접 판정 정답률' : 'Lite pass rate'}: ${args.advisorEvaluation.overallLitePassRate}\n`,
    );
    output.write(
        `${isKorean ? '전체 fallback 비율' : 'Overall fallback rate'}: ${args.advisorEvaluation.overallFallbackRate}\n`,
    );
    output.write(
        `${isKorean ? '평균 Lite 응답 시간(ms)' : 'Average lite latency (ms)'}: ${
            args.advisorEvaluation.overallTiming.averageMs ?? 'n/a'
        }\n`,
    );
    output.write(
        `${isKorean ? 'P95 Lite 응답 시간(ms)' : 'P95 lite latency (ms)'}: ${
            args.advisorEvaluation.overallTiming.p95Ms ?? 'n/a'
        }\n`,
    );
    output.write(
        `${isKorean ? '최대 Lite 응답 시간(ms)' : 'Max lite latency (ms)'}: ${
            args.advisorEvaluation.overallTiming.maxMs ?? 'n/a'
        }\n`,
    );
    output.write(`${args.advisorEvaluation.summary}\n`);
    if (args.advisorEvaluation.comparison) {
        output.write(
            `${isKorean ? '이전 비교' : 'Compared to previous run'}: decisionRate ${
                args.advisorEvaluation.comparison.deltaLiteDecisionRate >= 0 ? '+' : ''
            }${args.advisorEvaluation.comparison.deltaLiteDecisionRate}, litePassRate ${
                args.advisorEvaluation.comparison.deltaLitePassRate >= 0 ? '+' : ''
            }${args.advisorEvaluation.comparison.deltaLitePassRate}, fallbackRate ${
                args.advisorEvaluation.comparison.deltaFallbackRate >= 0 ? '+' : ''
            }${args.advisorEvaluation.comparison.deltaFallbackRate}, avgLatencyMs ${
                args.advisorEvaluation.comparison.deltaAverageLiteDurationMs === null
                    ? 'n/a'
                    : `${args.advisorEvaluation.comparison.deltaAverageLiteDurationMs >= 0 ? '+' : ''}${
                          args.advisorEvaluation.comparison.deltaAverageLiteDurationMs
                      }`
            }\n`,
        );
    }
    if (args.advisorHistoryPath) {
        output.write(`${isKorean ? '평가 히스토리' : 'Evaluation history'}: ${args.advisorHistoryPath}\n`);
    }
    for (const suite of args.advisorEvaluation.suites) {
        output.write(
            `- ${suite.label}: liteDecisionRate=${suite.liteDecisionRate}, litePassRate=${
                suite.litePassRate
            }, fallbackRate=${suite.fallbackRate}, avgLatencyMs=${
                suite.timing.averageMs ?? 'n/a'
            }, status=${localizeStatus(suite.evaluationStatus)}, suitability=${localizeSuitability(
                suite.suitability,
            )}, latencyRisk=${localizeLatencyRisk(suite.latencyRisk)}\n`,
        );
    }
    output.write(`${isKorean ? '===================' : '========================'}\n\n`);
}

function summarizeExecutionTiming(args: {
    startedAt: string;
    diagnostics: PromptLabDiagnosticEntry[];
    completedAt?: string;
    trace?: TraceEvent[];
    stages?: Array<{ stageId: string; startedAt: string; completedAt: string }>;
}): PromptLabExecutionTimingSummary {
    const totalDurationMs = Math.max(
        0,
        new Date(args.completedAt ?? new Date().toISOString()).getTime() - new Date(args.startedAt).getTime(),
    );
    const advisorBuckets = new Map<
        string,
        {
            callCount: number;
            totalDurationMs: number;
            maxDurationMs: number;
        }
    >();

    for (const entry of args.diagnostics) {
        const event = entry.event;
        if (event.scope !== 'flow-design') {
            continue;
        }
        if (
            event.action !== 'lite_advisor_selected' &&
            event.action !== 'lite_advisor_low_confidence_fallback' &&
            event.action !== 'lite_advisor_fallback'
        ) {
            continue;
        }

        const advisorId = typeof event.data?.advisorId === 'string' ? event.data.advisorId : undefined;
        const durationMs = typeof event.data?.durationMs === 'number' ? event.data.durationMs : undefined;
        if (!advisorId || durationMs === undefined || Number.isNaN(durationMs)) {
            continue;
        }

        const bucket = advisorBuckets.get(advisorId) ?? {
            callCount: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
        };
        bucket.callCount += 1;
        bucket.totalDurationMs += durationMs;
        bucket.maxDurationMs = Math.max(bucket.maxDurationMs, durationMs);
        advisorBuckets.set(advisorId, bucket);
    }

    const advisors = [...advisorBuckets.entries()]
        .map(([advisorId, bucket]) => ({
            advisorId,
            callCount: bucket.callCount,
            totalDurationMs: Number(bucket.totalDurationMs.toFixed(3)),
            averageDurationMs: Number((bucket.totalDurationMs / bucket.callCount).toFixed(3)),
            maxDurationMs: Number(bucket.maxDurationMs.toFixed(3)),
        }))
        .sort((left, right) => right.totalDurationMs - left.totalDurationMs);
    const advisorCallCount = advisors.reduce((sum, advisor) => sum + advisor.callCount, 0);
    const advisorTotalDurationMs = Number(
        advisors.reduce((sum, advisor) => sum + advisor.totalDurationMs, 0).toFixed(3),
    );
    const advisorTimingStatus = advisors.length > 0 ? 'observed' : 'not-observed';
    const advisorTimeShare =
        advisorTimingStatus === 'observed' && totalDurationMs > 0
            ? Number((advisorTotalDurationMs / totalDurationMs).toFixed(3))
            : null;
    const stages = (args.stages ?? []).map(stage => ({
        stageId: stage.stageId,
        durationMs: Math.max(0, new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime()),
    }));

    const trace = args.trace ?? [];
    const plannerCall = trace.find(event => event.type === 'planner_call');
    const firstStepStart = trace.find(event => event.type === 'step_start');
    const runEnd = trace.find(event => event.type === 'run_end');
    if (plannerCall && (firstStepStart || runEnd)) {
        stages.push({
            stageId: 'planner',
            durationMs: Math.max(0, (firstStepStart?.ts ?? runEnd!.ts) - plannerCall.ts),
        });
    }

    const toolStarts = new Map<string, number>();
    let toolExecutionDurationMs = 0;
    for (const event of trace) {
        if (event.type === 'tool_start' && typeof event.data?.toolName === 'string') {
            toolStarts.set(`${event.data.toolName}:${event.seq}`, event.ts);
        }
        if (event.type === 'tool_end' && typeof event.data?.toolName === 'string') {
            const startEntry = [...toolStarts.entries()].find(([key]) => key.startsWith(`${event.data?.toolName}:`));
            if (startEntry) {
                toolExecutionDurationMs += Math.max(0, event.ts - startEntry[1]);
                toolStarts.delete(startEntry[0]);
            }
        }
    }
    if (toolExecutionDurationMs > 0) {
        stages.push({
            stageId: 'tool-execution',
            durationMs: Number(toolExecutionDurationMs.toFixed(3)),
        });
    }

    const reflectorCall = trace.find(event => event.type === 'reflector_call');
    const finalizerCall = trace.find(event => event.type === 'finalizer_call');
    if (reflectorCall && (finalizerCall || runEnd)) {
        stages.push({
            stageId: 'reflector',
            durationMs: Math.max(0, (finalizerCall?.ts ?? runEnd!.ts) - reflectorCall.ts),
        });
    }
    if (finalizerCall && runEnd) {
        stages.push({
            stageId: 'finalizer',
            durationMs: Math.max(0, runEnd.ts - finalizerCall.ts),
        });
    }

    return {
        advisorTimingStatus,
        totalDurationMs,
        advisorCallCount,
        advisorTotalDurationMs,
        advisorTimeShare,
        advisors,
        stages,
    };
}

function printExecutionTimingSummary(args: {
    language: PromptLabLanguage;
    executionTiming: PromptLabExecutionTimingSummary;
}): void {
    const isKorean = args.language === 'ko';
    output.write(`${isKorean ? '=== 실행 시간 ===' : '=== Execution Timing ==='}\n`);
    output.write(
        `${isKorean ? '전체 실행 시간(ms)' : 'Total run duration (ms)'}: ${args.executionTiming.totalDurationMs}\n`,
    );
    output.write(`${isKorean ? 'Advisor 호출 수' : 'Advisor call count'}: ${args.executionTiming.advisorCallCount}\n`);
    output.write(
        `${isKorean ? 'Advisor 총 시간(ms)' : 'Advisor total duration (ms)'}: ${
            args.executionTiming.advisorTotalDurationMs
        }\n`,
    );
    output.write(
        `${isKorean ? 'Advisor 시간 비중' : 'Advisor time share'}: ${
            args.executionTiming.advisorTimeShare ?? 'not-observed'
        }\n`,
    );
    if (args.executionTiming.advisorTimingStatus === 'not-observed') {
        output.write(
            `${
                isKorean
                    ? '이번 실행에서는 advisor timing 이벤트가 관측되지 않았습니다.'
                    : 'Advisor timing events were not observed during this run.'
            }\n`,
        );
    }
    for (const advisor of args.executionTiming.advisors) {
        output.write(
            `- ${advisor.advisorId}: callCount=${advisor.callCount}, totalDurationMs=${advisor.totalDurationMs}, averageDurationMs=${advisor.averageDurationMs}, maxDurationMs=${advisor.maxDurationMs}\n`,
        );
    }
    for (const stage of args.executionTiming.stages) {
        output.write(`- ${isKorean ? '단계' : 'Stage'} ${stage.stageId}: durationMs=${stage.durationMs}\n`);
    }
    output.write(`${isKorean ? '=================' : '======================='}\n\n`);
}

function printFailureClipboard(error: PromptLabRunError): void {
    output.write('\n=== Copy/Paste Failure Report ===\n');
    output.write('```text\n');
    output.write(`${error.clipboardText}\n`);
    output.write('```\n');
    output.write('=================================\n');
}

function summarizeTimelineEvent(event: UnifiedRunEvent): string {
    if (event.source === 'trace') {
        const toolName = typeof event.data?.toolName === 'string' ? event.data.toolName : undefined;
        const stepId = typeof event.data?.stepId === 'string' ? event.data.stepId : undefined;
        if (toolName) {
            return `${event.type}: ${toolName}`;
        }
        if (stepId) {
            return `${event.type}: ${stepId}`;
        }
    }

    return `${event.source}:${event.type}`;
}

function summarizeDesignEvent(event: FlowDesignEvent): string {
    if (event.data?.node && typeof event.data.node === 'object') {
        const node = event.data.node as { label?: unknown; id?: unknown };
        if (typeof node.label === 'string') {
            return `${event.type}: ${node.label}`;
        }
        if (typeof node.id === 'string') {
            return `${event.type}: ${node.id}`;
        }
    }

    return event.type;
}

function createLiveStatusPrinter() {
    let active = false;
    let lastRenderedLength = 0;
    let activity = 'idle';
    let recentLog = '';

    const render = () => {
        const suffix = recentLog ? ` | ${recentLog}` : '';
        const line = `[status] ${activity}${suffix}`;
        const padded = line.padEnd(lastRenderedLength, ' ');
        output.write(`\r${padded}`);
        lastRenderedLength = Math.max(lastRenderedLength, line.length);
        active = true;
    };

    return {
        updateActivity(text: string, logMessage?: string) {
            activity = text;
            if (logMessage) {
                recentLog = logMessage;
            }
            render();
        },
        updateLog(logMessage: string) {
            recentLog = logMessage;
            render();
        },
        clear() {
            if (!active) {
                return;
            }
            output.write(`\r${''.padEnd(lastRenderedLength, ' ')}\r`);
            lastRenderedLength = 0;
            active = false;
        },
        finish(text?: string) {
            if (text) {
                activity = text;
                render();
            }
            if (active) {
                output.write('\n');
            }
            lastRenderedLength = 0;
            active = false;
        },
    };
}

interface SelectOption<TValue extends string> {
    value: TValue;
    label: string;
}

async function selectWithArrows<TValue extends string>(args: {
    prompt: string;
    options: Array<SelectOption<TValue>>;
    defaultValue?: TValue;
}): Promise<TValue> {
    const options = args.options;
    const defaultIndex = Math.max(
        0,
        args.defaultValue ? options.findIndex(option => option.value === args.defaultValue) : 0,
    );
    let selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    let hasRendered = false;

    if (!input.isTTY || !output.isTTY) {
        output.write(`${args.prompt}\n`);
        options.forEach((option, index) => {
            output.write(`${index === selectedIndex ? '*' : ' '} ${option.label}\n`);
        });
        return options[selectedIndex]!.value;
    }

    emitKeypressEvents(input);
    const previousRawMode = input.isRaw;
    input.setRawMode?.(true);

    const render = () => {
        if (!hasRendered) {
            output.write('\n');
        } else {
            output.write(`\x1B[${options.length + 1}A`);
            output.write('\r');
        }
        output.write('\x1B[0J');
        output.write(`${args.prompt}\n`);
        options.forEach((option, index) => {
            output.write(`${index === selectedIndex ? '❯' : ' '} ${option.label}\n`);
        });
        hasRendered = true;
    };

    render();

    const value = await new Promise<TValue>(resolve => {
        const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
            if (key.ctrl && key.name === 'c') {
                input.off('keypress', onKeypress);
                input.setRawMode?.(previousRawMode ?? false);
                output.write('\n');
                process.exit(130);
            }

            if (key.name === 'up') {
                selectedIndex = (selectedIndex - 1 + options.length) % options.length;
                render();
                return;
            }

            if (key.name === 'down') {
                selectedIndex = (selectedIndex + 1) % options.length;
                render();
                return;
            }

            if (key.name === 'return') {
                input.off('keypress', onKeypress);
                input.setRawMode?.(previousRawMode ?? false);
                output.write(`\x1B[${options.length + 1}B`);
                output.write(`${options[selectedIndex]!.label}\n`);
                resolve(options[selectedIndex]!.value);
            }
        };

        input.on('keypress', onKeypress);
    });

    return value;
}

async function selectModelWithCursor(args: {
    prompt: string;
    options: PromptLabSelectableModelOption[];
    defaultValue: string;
    rl: ReturnType<typeof createInterface>;
}): Promise<string> {
    const customValue = '__custom__';
    const selected = await selectWithArrows({
        prompt: `${args.prompt} (↑/↓ 후 Enter)`,
        options: [
            ...args.options,
            {
                value: customValue,
                label: '직접 입력',
            },
        ],
        defaultValue: args.options.find(option => option.value === args.defaultValue)?.value,
    });

    if (selected !== customValue) {
        return selected;
    }

    return (await args.rl.question(`${args.prompt} > `)).trim() || args.defaultValue;
}

function printSelectedDefaults(args: {
    language: PromptLabLanguage;
    mode: PromptLabMode;
    provider: PromptLabProvider;
    mainModel: string;
    liteModel: string;
    skillName?: ProductFlowSkill;
}): void {
    const isKorean = args.language === 'ko';
    output.write(`${isKorean ? '기본 설정' : 'Default settings'}:\n`);
    output.write(`- ${isKorean ? '모드' : 'Mode'}: ${args.mode}\n`);
    output.write(`- ${isKorean ? 'Provider' : 'Provider'}: ${args.provider}\n`);
    if (args.skillName) {
        output.write(`- ${isKorean ? '스킬' : 'Skill'}: ${args.skillName}\n`);
    }
    output.write(`- ${isKorean ? '메인 모델' : 'Main model'}: ${args.mainModel}\n`);
    output.write(`- ${isKorean ? 'Lite 모델' : 'Lite model'}: ${args.liteModel}\n\n`);
}

function truncateRequirementLabel(requirement: string, maxLength = 72): string {
    if (requirement.length <= maxLength) {
        return requirement;
    }
    return `${requirement.slice(0, maxLength - 1)}…`;
}

async function selectRequirementWithHistory(args: {
    prompt: string;
    historyPrompt: string;
    newRequirementOptionLabel: string;
    outputRoot?: string;
    rl: ReturnType<typeof createInterface>;
}): Promise<string> {
    const history = await readPromptLabRequirementHistory({ outputRoot: args.outputRoot });
    if (history.length === 0) {
        return (await args.rl.question(`${args.prompt}\n> `)).trim();
    }

    const newValue = '__new_requirement__';
    const selected = await selectWithArrows({
        prompt: `${args.historyPrompt} (↑/↓ 후 Enter)`,
        options: [
            ...history.map((entry, index) => ({
                value: `history:${index}`,
                label: truncateRequirementLabel(entry.requirement),
            })),
            {
                value: newValue,
                label: args.newRequirementOptionLabel,
            },
        ],
        defaultValue: history[0] ? 'history:0' : newValue,
    });

    if (selected === newValue) {
        return (await args.rl.question(`${args.prompt}\n> `)).trim();
    }

    const selectedIndex = Number.parseInt(selected.replace('history:', ''), 10);
    return history[selectedIndex]?.requirement ?? '';
}

function renderFlowSnapshotMarkdown(event: FlowDesignEvent | undefined): string {
    if (!event) {
        return ['# Designed Flow', '', '_No design snapshot was captured for this run._', ''].join('\n');
    }

    const nodes = event.snapshot.nodes;
    const edges = event.snapshot.edges;

    return [
        '# Designed Flow',
        '',
        `- Event: ${event.type}`,
        `- Nodes: ${nodes.length}`,
        `- Edges: ${edges.length}`,
        '',
        '## Nodes',
        '',
        ...(nodes.length > 0
            ? nodes.map(
                  node =>
                      `- ${node.label} (\`${node.id}\`)` +
                      `${node.blockId ? ` [${node.blockId}]` : ''}` +
                      `${node.phase ? ` phase=${node.phase}` : ''}` +
                      `${node.state ? ` state=${node.state}` : ''}`,
              )
            : ['- (none)']),
        '',
        '## Edges',
        '',
        ...(edges.length > 0
            ? edges.map(
                  edge =>
                      `- \`${edge.source}\` -> \`${edge.target}\`` +
                      `${edge.label ? ` (${edge.label})` : ''}` +
                      `${edge.flowHint ? ` [${edge.flowHint}]` : ''}`,
              )
            : ['- (none)']),
        '',
    ].join('\n');
}

function humanizeNodeId(nodeId: string): string {
    return nodeId
        .split(/[-_]/g)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function inferNodeRole(args: { nodeId: string; strategyId: string }): 'input' | 'ai' | 'view' | 'unknown' {
    const combined = `${args.nodeId} ${args.strategyId}`.toLowerCase();
    if (
        combined.includes('system-input') ||
        combined.includes('prompt-input') ||
        combined.includes('json-input') ||
        combined.includes('input') ||
        combined.includes('capture')
    ) {
        return 'input';
    }
    if (
        combined.includes('ai-generate') ||
        combined.includes('generate') ||
        combined.includes('explain') ||
        combined.includes('analy') ||
        combined.includes('summar')
    ) {
        return 'ai';
    }
    if (
        combined.includes('view') ||
        combined.includes('review') ||
        combined.includes('output') ||
        combined.includes('display')
    ) {
        return 'view';
    }
    return 'unknown';
}

function synthesizeFlowDesignEventFromResult(result: PromptLabRunArtifacts['result']): FlowDesignEvent | undefined {
    const assignments =
        result.finalResult?.designDetails?.nodeStrategyAssignments ?? result.nodeConfiguration.nodeStrategyAssignments;
    if (!assignments || assignments.length === 0) {
        return undefined;
    }

    // TODO(prompt-lab): Prefer an actual persisted flow/finalFlow snapshot when available.
    // This fallback currently reconstructs an "intended" graph from node strategy metadata,
    // which is good enough for visibility but can still look more complete than the run truly was.

    const labelByStrategyId: Record<string, string> = {
        'system-input': 'System Input',
        'prompt-input': 'Capture User Input',
        'json-input': 'Capture JSON Input',
        'ai-generate': 'AI Generate',
        view: 'Review Output',
    };
    const blockIdByStrategyId: Record<string, string> = {
        'system-input': 'system-input',
        'prompt-input': 'prompt-input',
        'json-input': 'json-input',
        'ai-generate': 'ai-generate',
        view: 'view-output',
    };
    const nodePhaseByStrategyId: Record<string, FlowDesignNodePhase> = {
        'system-input': 'ready',
        'prompt-input': 'ready',
        'json-input': 'ready',
        'ai-generate': 'connected',
        view: 'connected',
    };
    const nodeStateByStrategyId: Record<string, string> = {
        'system-input': 'system-prompt-ready',
        'prompt-input': 'user-prompt-ready',
        'json-input': 'json-input-ready',
        'ai-generate': 'generation-graph-wired',
        view: 'review-graph-wired',
    };
    const configuredNodeCount =
        result.finalResult?.designDetails?.configuredNodeCount ?? result.nodeConfiguration.configuredNodeCount;
    const nodes = assignments.map((assignment, index) => {
        const inferredRole = inferNodeRole({
            nodeId: assignment.nodeId,
            strategyId: assignment.strategyId,
        });
        const inferredBlockId =
            inferredRole === 'input'
                ? assignment.nodeId.toLowerCase().includes('json')
                    ? 'json-input'
                    : 'prompt-input'
                : inferredRole === 'ai'
                ? 'ai-generate'
                : inferredRole === 'view'
                ? 'view-output'
                : undefined;
        const explicitBlockId = blockIdByStrategyId[assignment.strategyId];
        return {
            id: assignment.nodeId,
            label:
                labelByStrategyId[assignment.strategyId] ??
                (inferredRole === 'input'
                    ? humanizeNodeId(assignment.nodeId)
                    : inferredRole === 'ai'
                    ? humanizeNodeId(assignment.nodeId)
                    : inferredRole === 'view'
                    ? humanizeNodeId(assignment.nodeId)
                    : humanizeNodeId(assignment.nodeId)),
            blockId: explicitBlockId ?? inferredBlockId,
            phase:
                nodePhaseByStrategyId[assignment.strategyId] ??
                (inferredRole === 'input'
                    ? 'ready'
                    : inferredRole === 'unknown' && index === 0
                    ? 'ready'
                    : 'connected'),
            state:
                nodeStateByStrategyId[assignment.strategyId] ??
                (explicitBlockId || inferredBlockId
                    ? `strategy=${assignment.strategyId}`
                    : `unmapped-strategy=${assignment.strategyId}`),
        };
    });

    const hasViewNode = nodes.some(node => node.blockId === 'view-output');
    const hasAiNode = nodes.some(node => node.blockId === 'ai-generate');
    if (configuredNodeCount > nodes.length && hasAiNode && !hasViewNode) {
        nodes.push({
            id: 'review-output',
            label: 'Review Output',
            blockId: 'view-output',
            phase: 'connected',
            state: 'review-graph-wired',
        });
    }

    const inputNodes = nodes.filter(node =>
        ['system-input', 'prompt-input', 'json-input'].includes(node.blockId ?? ''),
    );
    const aiNode = nodes.find(node => node.blockId === 'ai-generate');
    const viewNode = nodes.find(node => node.blockId === 'view-output');
    const edges: Array<{
        id: string;
        source: string;
        target: string;
        flowHint?: 'horizontal';
    }> = [];

    if (aiNode) {
        for (const inputNode of inputNodes) {
            edges.push({
                id: `${inputNode.id}->${aiNode.id}`,
                source: inputNode.id,
                target: aiNode.id,
                flowHint: 'horizontal',
            });
        }
        if (viewNode) {
            edges.push({
                id: `${aiNode.id}->${viewNode.id}`,
                source: aiNode.id,
                target: viewNode.id,
                flowHint: 'horizontal',
            });
        }
    }

    if (edges.length === 0) {
        for (let index = 0; index < nodes.length - 1; index += 1) {
            edges.push({
                id: `${nodes[index]!.id}->${nodes[index + 1]!.id}`,
                source: nodes[index]!.id,
                target: nodes[index + 1]!.id,
                flowHint: 'horizontal',
            });
        }
    }

    const snapshot: FlowDesignGraphSnapshot = { nodes, edges };
    return {
        sessionId: result.runId,
        ts: Date.now(),
        type: 'graph_completed',
        message: 'Synthesized design snapshot from final node configuration.',
        snapshot,
        reagraph: renderFlowDesignSnapshotAsReagraph(snapshot),
        data: {
            synthesized: true,
            source: 'nodeStrategyAssignments',
        },
    };
}

function dedupeAssessmentCaveats(args: {
    language: PromptLabLanguage;
    caveats: string[];
    reasons: Array<{ message: string }>;
}): string[] {
    const isKorean = args.language === 'ko';
    const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').replace(/[.]/g, '').trim();

    const localizedReasonTexts = new Set(
        args.reasons.map(reason =>
            normalize(isKorean ? localizeAssessmentInline(reason.message, true) : reason.message),
        ),
    );

    return args.caveats.filter(
        caveat => !localizedReasonTexts.has(normalize(isKorean ? localizeAssessmentInline(caveat, true) : caveat)),
    );
}

function localizeAssessmentInline(text: string, isKorean: boolean): string {
    if (!isKorean) {
        return text;
    }

    const replacements: Array<[string, string]> = [
        [
            'The run completed successfully, but requirement fulfillment is still uncertain because the design relied on a generic task-graph fallback and the final flow still uses mock execution settings.',
            '실행은 성공했지만, 설계가 일반 task graph fallback에 의존하고 최종 flow도 mock 실행 설정을 사용해서 요구 충족 여부는 아직 불확실합니다.',
        ],
        [
            'The run completed successfully, but requirement fulfillment is still uncertain because the design relied on a generic task-graph fallback.',
            '실행은 성공했지만, 설계가 일반 task graph fallback에 의존해서 요구 충족 여부는 아직 불확실합니다.',
        ],
        [
            'The run completed successfully, but requirement fulfillment is still uncertain because the final flow still uses mock execution settings.',
            '실행은 성공했지만, 최종 flow가 아직 mock 실행 설정을 사용하고 있어 요구 충족 여부는 아직 불확실합니다.',
        ],
        [
            'The run completed, but the requirement is only partially covered because some capabilities are still missing.',
            '실행은 완료됐지만, 일부 capability가 아직 부족해서 요구사항을 부분적으로만 충족합니다.',
        ],
        [
            'The run did not complete successfully, so the requirement is not yet fulfilled.',
            '실행이 성공적으로 끝나지 않아 아직 요구사항을 충족하지 못했습니다.',
        ],
        [
            'The run completed, but the requirement is still not fulfilled because the run completed but did not produce the requested result.',
            '실행은 완료되었지만 요청된 결과를 만들어내지 못해 아직 요구사항을 충족하지 못했습니다.',
        ],
        [
            'The run completed successfully and the current design appears to fulfill the requirement.',
            '실행이 성공적으로 완료되었고, 현재 설계는 요구사항을 충족하는 것으로 보입니다.',
        ],
        [
            'The run completed successfully, but requirement fulfillment is still uncertain because validation relied on a synthetic sample input (synthetic-graph-json).',
            '실행은 성공적으로 완료되었지만, synthetic graph JSON 샘플 기반으로만 검증되었기 때문에 요구사항 충족 여부는 아직 불확실합니다.',
        ],
        [
            'Task-graph classification fell back to a generic template.',
            'task graph 분류가 일반 템플릿 fallback으로 처리되었습니다.',
        ],
        [
            'The final flow still uses a mock AI model configuration.',
            '최종 flow가 아직 mock AI 모델 설정을 사용하고 있습니다.',
        ],
        ['the design relied on a generic task-graph fallback', '설계가 일반 task graph fallback에 의존했습니다.'],
        ['the final flow still uses mock execution settings', '최종 flow가 아직 mock 실행 설정을 사용하고 있습니다.'],
        ['the requested JSON output contract was not preserved', '요청된 JSON 출력 계약이 유지되지 않았습니다.'],
        [
            'structured JSON output still lacks an explicit output schema',
            '구조화된 JSON 출력에 필요한 명시적 스키마가 아직 없습니다.',
        ],
        [
            'the flow output format drifted away from the requested plain-text preference',
            '출력 형식이 요청된 평문 선호에서 벗어났습니다.',
        ],
        [
            'validation relied on a synthetic sample input (synthetic-graph-json)',
            'synthetic graph JSON 샘플 입력에 기반해 검증되었습니다.',
        ],
        [
            'Validation relied on a synthetic sample input (synthetic-graph-json).',
            'synthetic graph JSON 샘플 입력에 기반해 검증되었습니다.',
        ],
        ['the run did not complete successfully', '실행이 성공적으로 완료되지 않았습니다.'],
        [
            'the run completed but did not produce the requested result',
            '실행은 완료되었지만 요청된 결과를 만들어내지 못했습니다.',
        ],
    ];

    if (text.startsWith('some capabilities are still missing (')) {
        return text.replace('some capabilities are still missing', '일부 capability가 아직 부족합니다');
    }

    if (text.startsWith('Missing capabilities remain: ')) {
        return text.replace('Missing capabilities remain:', '남아 있는 부족 capability:');
    }

    const matched = replacements.find(([source]) => source === text);
    return matched?.[1] ?? text;
}

function printDesignedFlowSummary(
    event: FlowDesignEvent | undefined,
    options: { executionSucceeded: boolean } = { executionSucceeded: true },
): void {
    output.write('\n=== Final Designed Flow ===\n');
    if (!event) {
        output.write('No design snapshot was captured.\n');
        if (!options.executionSucceeded) {
            output.write('The run stopped before a flow graph snapshot could be finalized.\n');
        }
        output.write('===========================\n\n');
        return;
    }

    // TODO(prompt-lab): Mark synthesized/reconstructed snapshots explicitly in the CLI so
    // users can distinguish a true live design stream from a fallback reconstruction.

    const nodes = event.snapshot.nodes;
    const edges = event.snapshot.edges;
    output.write(`nodes: ${nodes.length}, edges: ${edges.length}\n`);
    for (const node of nodes) {
        output.write(
            `- node ${node.label} (${node.id})${node.blockId ? ` [${node.blockId}]` : ''}${
                node.phase ? ` phase=${node.phase}` : ''
            }${node.state ? ` state=${node.state}` : ''}\n`,
        );
    }
    for (const edge of edges) {
        output.write(
            `- edge ${edge.source} -> ${edge.target}${edge.label ? ` (${edge.label})` : ''}${
                edge.flowHint ? ` [${edge.flowHint}]` : ''
            }\n`,
        );
    }
    output.write('===========================\n\n');
}

function printRequirementAssessment(args: {
    language: PromptLabLanguage;
    executionSucceeded: boolean;
    fulfillmentLevel: string;
    summary: string;
    caveats: string[];
    reasons: Array<{ category: string; message: string }>;
}): void {
    const isKorean = args.language === 'ko';
    const title = isKorean ? '=== 요구 충족도 평가 ===' : '=== Requirement Assessment ===';
    const executionLabel = isKorean ? '실행 성공' : 'execution succeeded';
    const fulfillmentLabel = isKorean ? '충족도 수준' : 'fulfillment level';
    const reasonsLabel = isKorean ? '판단 근거' : 'assessment signals';
    const notesLabel = isKorean ? '참고 사항' : 'notes';
    const normalizedLevel = isKorean
        ? {
              fulfilled: '충족',
              uncertain: '불확실',
              partial: '부분 충족',
              'not-fulfilled': '미충족',
          }[args.fulfillmentLevel] ?? args.fulfillmentLevel
        : args.fulfillmentLevel;
    const footer = isKorean ? '=========================' : '==============================';
    const localizeAssessmentText = (text: string): string => localizeAssessmentInline(text, isKorean);
    const visibleCaveats = dedupeAssessmentCaveats({
        language: args.language,
        caveats: args.caveats,
        reasons: args.reasons,
    });

    output.write(`${title}\n`);
    output.write(`${executionLabel}: ${String(args.executionSucceeded)}\n`);
    output.write(`${fulfillmentLabel}: ${normalizedLevel}\n`);
    output.write(`${localizeAssessmentText(args.summary)}\n`);
    if (args.reasons.length > 0) {
        output.write(`${reasonsLabel}:\n`);
        for (const reason of args.reasons) {
            const category = isKorean
                ? {
                      execution: '실행',
                      capability: '기능',
                      classification: '분류',
                      'output-contract': '출력 계약',
                      runtime: '런타임',
                      evidence: '검증 근거',
                  }[reason.category] ?? reason.category
                : reason.category;
            output.write(`- [${category}] ${localizeAssessmentText(reason.message)}\n`);
        }
    }
    if (visibleCaveats.length > 0) {
        output.write(`${notesLabel}:\n`);
        for (const caveat of visibleCaveats) {
            output.write(`- ${localizeAssessmentText(caveat)}\n`);
        }
    }
    output.write(`${footer}\n\n`);
}

function renderReagraphHtml(event: FlowDesignEvent | undefined): string {
    const graph = event?.reagraph ?? { nodes: [], edges: [] };
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
        '  <title>Prompt Lab Designed Flow</title>',
        '  <style>',
        '    html, body, #root { height: 100%; margin: 0; }',
        '    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f4ef; color: #1f2937; }',
        '    .shell { display: grid; grid-template-columns: 320px 1fr; height: 100%; }',
        '    .panel { padding: 16px; border-right: 1px solid #d6d3d1; background: #fffdf8; overflow: auto; }',
        '    .panel h1 { margin: 0 0 8px; font-size: 20px; }',
        '    .panel p { margin: 0 0 16px; color: #57534e; line-height: 1.5; }',
        '    .meta { font-size: 12px; color: #78716c; margin-bottom: 16px; }',
        '    .list { margin: 0; padding-left: 18px; }',
        '    .list li { margin: 0 0 8px; }',
        '    .canvas { position: relative; }',
        '  </style>',
        '</head>',
        '<body>',
        '  <div class="shell">',
        '    <aside class="panel">',
        '      <h1>Designed Flow</h1>',
        `      <p>${
            event
                ? `${event.snapshot.nodes.length} nodes, ${event.snapshot.edges.length} edges`
                : 'No design snapshot captured.'
        }</p>`,
        `      <div class="meta">event=${event?.type ?? 'none'}</div>`,
        '      <h2>Nodes</h2>',
        '      <ul class="list">',
        ...(event?.snapshot.nodes.length
            ? event.snapshot.nodes.map(
                  node =>
                      `        <li><strong>${escapeHtml(node.label)}</strong> <code>${escapeHtml(node.id)}</code>${
                          node.blockId ? ` [${escapeHtml(node.blockId)}]` : ''
                      }</li>`,
              )
            : ['        <li>(none)</li>']),
        '      </ul>',
        '    </aside>',
        '    <main class="canvas"><div id="root"></div></main>',
        '  </div>',
        '  <script type="module">',
        "    import React from 'https://esm.sh/react@18';",
        "    import { createRoot } from 'https://esm.sh/react-dom@18/client';",
        "    import { GraphCanvas } from 'https://esm.sh/reagraph@4?external=react,react-dom';",
        `    const graph = ${JSON.stringify(graph)};`,
        '    const root = createRoot(document.getElementById("root"));',
        '    root.render(',
        '      React.createElement(GraphCanvas, {',
        '        nodes: graph.nodes,',
        '        edges: graph.edges,',
        '        animated: true,',
        '        draggable: true,',
        '        layoutType: "forceDirected2d",',
        '        labelType: "all",',
        '        theme: {',
        '          canvas: { background: "#f6f4ef" },',
        '          node: { fill: "#0f766e", activeFill: "#115e59", opacity: 1 },',
        '          edge: { fill: "#78716c", activeFill: "#0f172a", opacity: 0.9 }',
        '        }',
        '      })',
        '    );',
        '  </script>',
        '</body>',
        '</html>',
        '',
    ].join('\n');
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function main() {
    ensureProjectEnvLoaded();
    const manifest = await getPromptLabManifest();
    const defaultLanguage = manifest.defaults.language as PromptLabLanguage;
    const useLastRun = process.argv.slice(2).includes('--last');
    const rl = createInterface({ input, output });

    try {
        const cachedLastRun = useLastRun
            ? await readPromptLabLastRun({ outputRoot: manifest.defaults.outputRoot })
            : undefined;
        const language = cachedLastRun?.config.language
            ? cachedLastRun.config.language
            : await selectWithArrows({
                  prompt: `${(await getPromptLabLanguageCopy(defaultLanguage)).languagePrompt} (↑/↓ 후 Enter)`,
                  options: [
                      { value: 'ko', label: '한국어 (기본)' },
                      { value: 'en', label: 'English' },
                  ],
                  defaultValue: defaultLanguage,
              });
        const copy = await getPromptLabLanguageCopy(language);

        output.write(`${copy.welcome}\n`);
        const mode = cachedLastRun?.config.mode
            ? cachedLastRun.config.mode
            : await selectWithArrows({
                  prompt: `${copy.modePrompt} (↑/↓ 후 Enter)`,
                  options: [
                      { value: 'run', label: language === 'ko' ? '일반 실행' : 'Run session' },
                      {
                          value: 'advisor-eval',
                          label: language === 'ko' ? 'Advisor 평가 전용' : 'Advisor evaluation only',
                      },
                  ],
                  defaultValue: manifest.defaults.mode as PromptLabMode,
              });
        const defaultSkill = manifest.defaults.skillName;
        const defaultProvider = resolveDefaultProvider(manifest.defaults.providerOrder);
        let provider = cachedLastRun?.config.provider ?? defaultProvider;
        let skillName = mode === 'run' ? cachedLastRun?.config.skillName ?? defaultSkill : undefined;
        let mainModel = cachedLastRun?.config.mainModel ?? defaultMainModel(provider);
        let liteModel = cachedLastRun?.config.liteModel ?? defaultLiteModel(provider, mainModel);

        printSelectedDefaults({
            language,
            mode,
            provider,
            skillName,
            mainModel,
            liteModel,
        });

        const useDefaultSettings = useLastRun
            ? 'default'
            : await selectWithArrows({
                  prompt: `${copy.settingsPrompt} (↑/↓ 후 Enter)`,
                  options: [
                      {
                          value: 'default',
                          label:
                              language === 'ko' ? '기본 설정으로 계속 (권장)' : 'Continue with defaults (Recommended)',
                      },
                      {
                          value: 'customize',
                          label: language === 'ko' ? '설정 변경' : 'Customize settings',
                      },
                  ],
                  defaultValue: 'default',
              });

        if (useDefaultSettings === 'customize') {
            provider = await selectWithArrows({
                prompt: `${copy.providerPrompt} (↑/↓ 후 Enter)`,
                options: manifest.defaults.providerOrder.map(value => ({ value, label: value })),
                defaultValue: defaultProvider,
            });
            skillName =
                mode === 'run'
                    ? await selectWithArrows({
                          prompt: `${copy.skillPrompt} (↑/↓ 후 Enter)`,
                          options: manifest.defaults.skillOrder.map(value => ({ value, label: value })),
                          defaultValue: defaultSkill,
                      })
                    : undefined;
            const modelOptions = await getPromptLabModelOptions(provider);
            mainModel = await selectModelWithCursor({
                prompt: copy.mainModelPrompt,
                options: modelOptions.main,
                defaultValue: defaultMainModel(provider),
                rl,
            });
            liteModel = await selectModelWithCursor({
                prompt: copy.liteModelPrompt,
                options: modelOptions.lite,
                defaultValue: defaultLiteModel(provider, mainModel),
                rl,
            });
        }
        const requirement =
            mode === 'run'
                ? useLastRun && cachedLastRun?.config.mode === 'run' && cachedLastRun.requirement
                    ? cachedLastRun.requirement
                    : await selectRequirementWithHistory({
                          prompt: copy.requirementPrompt,
                          historyPrompt: copy.recentRequirementsPrompt,
                          newRequirementOptionLabel: copy.newRequirementOptionLabel,
                          outputRoot: manifest.defaults.outputRoot,
                          rl,
                      })
                : 'advisor-evaluation';
        if (mode === 'run' && !requirement) {
            throw new Error('Requirement is required.');
        }
        if (mode === 'run') {
            await cachePromptLabRequirement({ outputRoot: manifest.defaults.outputRoot }, requirement);
        }

        output.write(`${copy.startMessage}\n`);
        const product = new PromptLabProduct();
        const status = createLiveStatusPrinter();
        let latestDesignEvent: FlowDesignEvent | undefined;
        let latestPaths: PromptLabArtifactPaths | undefined;
        const diagnosticEntries: PromptLabDiagnosticEntry[] = [];
        const config: PromptLabSessionConfig = {
            mode,
            provider,
            mainModel,
            liteModel,
            language,
            skillName,
            outputRoot: manifest.defaults.outputRoot,
        };

        if (mode === 'advisor-eval') {
            const artifacts = await product.runAdvisorEvaluation({ config });
            printSessionHeader(
                artifacts.session.sessionDir,
                {
                    timelinePath: join(artifacts.session.sessionDir, 'timeline.ndjson'),
                    designPath: join(artifacts.session.sessionDir, 'design-events.ndjson'),
                    diagnosticsPath: join(artifacts.session.sessionDir, 'diagnostics.ndjson'),
                    resultPath: join(artifacts.session.sessionDir, 'result.json'),
                    designedFlowPath: join(artifacts.session.sessionDir, 'designed-flow.md'),
                    designedFlowYamlPath: join(artifacts.session.sessionDir, 'designed-flow.yml'),
                    designedFlowGraphPath: join(artifacts.session.sessionDir, 'designed-flow.reagraph.html'),
                    advisorEvaluationJsonPath: join(artifacts.session.sessionDir, 'advisor-evaluation.json'),
                    advisorEvaluationMarkdownPath: join(artifacts.session.sessionDir, 'advisor-evaluation.md'),
                    selfReviewPath: join(artifacts.session.sessionDir, 'self-review.json'),
                    feedbackPath: join(artifacts.session.sessionDir, 'user-feedback.txt'),
                    promptJsonPath: join(artifacts.session.sessionDir, 'codex-prompt.json'),
                    promptMarkdownPath: join(artifacts.session.sessionDir, 'codex-prompt.md'),
                    summaryPath: join(artifacts.session.sessionDir, 'summary.md'),
                    executionTimingJsonPath: join(artifacts.session.sessionDir, 'execution-timing.json'),
                    artifactsPath: join(artifacts.session.sessionDir, 'artifacts.json'),
                    failureJsonPath: join(artifacts.session.sessionDir, 'failure.json'),
                    failureTextPath: join(artifacts.session.sessionDir, 'failure.txt'),
                },
                { includeAdvisorArtifacts: true, includeFlowArtifacts: false },
            );
            printAdvisorEvaluationSummary({
                language,
                advisorEvaluation: artifacts.advisorEvaluation,
                advisorHistoryPath: getPromptLabAdvisorEvaluationHistoryPath(config),
            });
            output.write(`${copy.completionMessage} ${artifacts.session.sessionDir}\n`);
            return;
        }

        const agentRunStartedAt = new Date().toISOString();
        const { session, result, gateway } = await product.runRequirement({
            config,
            requirement,
            hooks: {
                onSessionPrepared: ({ session, paths }) => {
                    latestPaths = paths;
                    printSessionHeader(session.sessionDir, paths);
                    status.updateActivity('session prepared');
                },
                onTimelineEvent: event => {
                    status.updateActivity(summarizeTimelineEvent(event), event.message);
                },
                onDesignEvent: event => {
                    latestDesignEvent = event;
                    status.updateActivity(summarizeDesignEvent(event), event.message);
                },
                onDiagnosticEvent: entry => {
                    diagnosticEntries.push(entry);
                    status.updateLog(entry.event.message);
                },
            },
        });
        status.finish('agent execution completed');
        const agentRunCompletedAt = new Date().toISOString();

        const resolvedDesignEvent = latestDesignEvent ?? synthesizeFlowDesignEventFromResult(result);

        if (latestPaths) {
            await writeText(latestPaths.designedFlowPath, renderFlowSnapshotMarkdown(resolvedDesignEvent));
            await writeText(latestPaths.designedFlowGraphPath, renderReagraphHtml(resolvedDesignEvent));
            if (!latestDesignEvent && resolvedDesignEvent) {
                await writeText(
                    latestPaths.designedFlowYamlPath,
                    yaml.dump(resolvedDesignEvent.snapshot, { noRefs: true }),
                );
            }
        }
        printDesignedFlowSummary(resolvedDesignEvent, {
            executionSucceeded: result.requirementAssessment.executionSucceeded,
        });
        printRequirementAssessment({
            language,
            ...result.requirementAssessment,
        });
        const selfReviewStartedAt = new Date().toISOString();
        const executionTiming = summarizeExecutionTiming({
            startedAt: session.startedAt,
            completedAt: new Date().toISOString(),
            diagnostics: diagnosticEntries,
            trace: result.trace,
            stages: [
                {
                    stageId: 'agent-run',
                    startedAt: agentRunStartedAt,
                    completedAt: agentRunCompletedAt,
                },
            ],
        });
        const selfReview = await product.createSelfReview({ session, result, executionTiming, gateway });
        const selfReviewCompletedAt = new Date().toISOString();
        const reviewedExecutionTiming = summarizeExecutionTiming({
            startedAt: session.startedAt,
            completedAt: selfReviewCompletedAt,
            diagnostics: diagnosticEntries,
            trace: result.trace,
            stages: [
                {
                    stageId: 'agent-run',
                    startedAt: agentRunStartedAt,
                    completedAt: agentRunCompletedAt,
                },
                {
                    stageId: 'self-review',
                    startedAt: selfReviewStartedAt,
                    completedAt: selfReviewCompletedAt,
                },
            ],
        });
        printExecutionTimingSummary({
            language,
            executionTiming: reviewedExecutionTiming,
        });

        output.write(`${copy.selfReviewMessage}\n`);
        output.write(`${selfReview.summary}\n`);
        const feedback = await readMultilineFeedback(rl, copy.feedbackPrompt, copy.feedbackDoneHint);

        const finalizeStartedAt = new Date().toISOString();
        const artifacts = await product.finalizeSession({
            session,
            result,
            selfReview,
            userFeedback: feedback,
            executionTiming: summarizeExecutionTiming({
                startedAt: session.startedAt,
                completedAt: new Date().toISOString(),
                diagnostics: diagnosticEntries,
                trace: result.trace,
                stages: [
                    {
                        stageId: 'agent-run',
                        startedAt: agentRunStartedAt,
                        completedAt: agentRunCompletedAt,
                    },
                    {
                        stageId: 'self-review',
                        startedAt: selfReviewStartedAt,
                        completedAt: selfReviewCompletedAt,
                    },
                    {
                        stageId: 'prompt-finalize',
                        startedAt: finalizeStartedAt,
                        completedAt: new Date().toISOString(),
                    },
                ],
            }),
            gateway,
        });

        output.write(`${copy.finalPromptMessage}\n`);
        output.write(`${artifacts.codexPrompt.codexPrompt}\n\n`);
        output.write(`${copy.completionMessage} ${session.sessionDir}\n`);
    } catch (error) {
        if (error instanceof PromptLabRunError) {
            printSessionHeader(error.session.sessionDir, error.paths, { includeFailureArtifacts: true });
            printFailureClipboard(error);
            output.write(`Prompt Lab failed: ${error.cause instanceof Error ? error.cause.message : error.message}\n`);
        } else {
            const message = error instanceof Error ? error.message : String(error);
            output.write(`Prompt Lab failed: ${message}\n`);
        }
        process.exitCode = 1;
    } finally {
        rl.close();
    }
}

void main();
