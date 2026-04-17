import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { ensureProjectEnvLoaded } from '../env/project-env';
import { getPromptLabLanguageCopy, getPromptLabManifest, getPromptLabModelOptions } from './manifest';
import { PromptLabProduct, PromptLabRunError } from './product';
import type {
    PromptLabArtifactPaths,
    PromptLabLanguage,
    PromptLabProvider,
    PromptLabSelectableModelOption,
    PromptLabSessionConfig,
} from './types';
import type { ProductFlowSkill } from '../product/types';
import type { FlowDesignEvent } from '../flow/design-monitor';
import type { UnifiedRunEvent } from '../observability/unified-timeline';
import { writeText } from './files';

function normalizeLanguage(value: string, fallback: PromptLabLanguage): PromptLabLanguage {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'en' || normalized === 'en-us') {
        return 'en';
    }
    if (normalized === 'ko' || normalized === 'ko-kr' || normalized === '') {
        return fallback;
    }
    return fallback;
}

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
    options: { includeFailureArtifacts?: boolean } = {},
): void {
    output.write('\n=== Prompt Lab Session ===\n');
    output.write(`session: ${sessionDir}\n`);
    output.write(`timeline: ${paths.timelinePath}\n`);
    output.write(`design: ${paths.designPath}\n`);
    output.write(`diagnostics: ${paths.diagnosticsPath}\n`);
    output.write(`designed flow: ${paths.designedFlowPath}\n`);
    output.write(`designed flow yaml: ${paths.designedFlowYamlPath}\n`);
    output.write(`designed flow graph: ${paths.designedFlowGraphPath}\n`);
    if (options.includeFailureArtifacts) {
        output.write(`failure text: ${paths.failureTextPath}\n`);
        output.write(`failure json: ${paths.failureJsonPath}\n`);
    } else {
        output.write('failure artifacts: generated only on failure\n');
    }
    output.write('==========================\n\n');
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
        output.write(`\n${args.prompt}\n`);
        options.forEach((option, index) => {
            output.write(`${index === selectedIndex ? '❯' : ' '} ${option.label}\n`);
        });
        output.write('\x1B[0J');
        output.write(`\x1B[${options.length + 1}A`);
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

function printDesignedFlowSummary(event: FlowDesignEvent | undefined): void {
    output.write('\n=== Final Designed Flow ===\n');
    if (!event) {
        output.write('No design snapshot was captured.\n');
        output.write('===========================\n\n');
        return;
    }

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
    const normalizedLevel = isKorean
        ? {
              fulfilled: '충족',
              uncertain: '불확실',
              partial: '부분 충족',
              'not-fulfilled': '미충족',
          }[args.fulfillmentLevel] ?? args.fulfillmentLevel
        : args.fulfillmentLevel;
    const footer = isKorean ? '=========================' : '==============================';
    const localizeAssessmentText = (text: string): string => {
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
                'The run completed successfully and the current design appears to fulfill the requirement.',
                '실행이 성공적으로 완료되었고, 현재 설계는 요구사항을 충족하는 것으로 보입니다.',
            ],
            [
                'Task-graph classification fell back to a generic template.',
                'task graph 분류가 일반 템플릿 fallback으로 처리되었습니다.',
            ],
            [
                'The final flow still uses a mock AI model configuration.',
                '최종 flow가 아직 mock AI 모델 설정을 사용하고 있습니다.',
            ],
            [
                'the design relied on a generic task-graph fallback',
                '설계가 일반 task graph fallback에 의존했습니다.',
            ],
            [
                'the final flow still uses mock execution settings',
                '최종 flow가 아직 mock 실행 설정을 사용하고 있습니다.',
            ],
            [
                'the requested JSON output contract was not preserved',
                '요청된 JSON 출력 계약이 유지되지 않았습니다.',
            ],
            [
                'structured JSON output still lacks an explicit output schema',
                '구조화된 JSON 출력에 필요한 명시적 스키마가 아직 없습니다.',
            ],
            [
                'the flow output format drifted away from the requested plain-text preference',
                '출력 형식이 요청된 평문 선호에서 벗어났습니다.',
            ],
            [
                'the run did not complete successfully',
                '실행이 성공적으로 완료되지 않았습니다.',
            ],
        ];

        if (text.startsWith('some capabilities are still missing (')) {
            return text.replace('some capabilities are still missing', '일부 capability가 아직 부족합니다');
        }

        const matched = replacements.find(([source]) => source === text);
        return matched?.[1] ?? text;
    };

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
                  }[reason.category] ?? reason.category
                : reason.category;
            output.write(`- [${category}] ${localizeAssessmentText(reason.message)}\n`);
        }
    }
    for (const caveat of args.caveats) {
        output.write(`- ${localizeAssessmentText(caveat)}\n`);
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
    const rl = createInterface({ input, output });

    try {
        const language = await selectWithArrows({
            prompt: `${(await getPromptLabLanguageCopy(defaultLanguage)).languagePrompt} (↑/↓ 후 Enter)`,
            options: [
                { value: 'ko', label: '한국어 (기본)' },
                { value: 'en', label: 'English' },
            ],
            defaultValue: defaultLanguage,
        });
        const copy = await getPromptLabLanguageCopy(language);

        output.write(`${copy.welcome}\n`);
        const defaultProvider = resolveDefaultProvider(manifest.defaults.providerOrder);
        const provider = await selectWithArrows({
            prompt: `${copy.providerPrompt} (↑/↓ 후 Enter)`,
            options: manifest.defaults.providerOrder.map(value => ({ value, label: value })),
            defaultValue: defaultProvider,
        });
        const defaultSkill = manifest.defaults.skillName;
        const skillName = await selectWithArrows({
            prompt: `${copy.skillPrompt} (↑/↓ 후 Enter)`,
            options: manifest.defaults.skillOrder.map(value => ({ value, label: value })),
            defaultValue: defaultSkill,
        });
        const mainModelDefault = defaultMainModel(provider);
        const modelOptions = await getPromptLabModelOptions(provider);
        const mainModel = await selectModelWithCursor({
            prompt: copy.mainModelPrompt,
            options: modelOptions.main,
            defaultValue: mainModelDefault,
            rl,
        });
        const liteModelDefault = defaultLiteModel(provider, mainModel);
        const liteModel = await selectModelWithCursor({
            prompt: copy.liteModelPrompt,
            options: modelOptions.lite,
            defaultValue: liteModelDefault,
            rl,
        });
        const requirement = (await rl.question(`${copy.requirementPrompt}\n> `)).trim();
        if (!requirement) {
            throw new Error('Requirement is required.');
        }

        output.write(`${copy.startMessage}\n`);
        const product = new PromptLabProduct();
        const status = createLiveStatusPrinter();
        let latestDesignEvent: FlowDesignEvent | undefined;
        let latestPaths: PromptLabArtifactPaths | undefined;
        const config: PromptLabSessionConfig = {
            provider,
            mainModel,
            liteModel,
            language,
            skillName,
            outputRoot: manifest.defaults.outputRoot,
        };

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
                    status.updateLog(entry.event.message);
                },
            },
        });
        status.finish('agent execution completed');

        if (latestPaths) {
            await writeText(latestPaths.designedFlowPath, renderFlowSnapshotMarkdown(latestDesignEvent));
            await writeText(latestPaths.designedFlowGraphPath, renderReagraphHtml(latestDesignEvent));
        }
        printDesignedFlowSummary(latestDesignEvent);
        printRequirementAssessment({
            language,
            ...result.requirementAssessment,
        });

        const selfReview = await product.createSelfReview({ session, result, gateway });

        output.write(`${copy.selfReviewMessage}\n`);
        output.write(`${selfReview.summary}\n`);
        const feedback = await readMultilineFeedback(rl, copy.feedbackPrompt, copy.feedbackDoneHint);

        const artifacts = await product.finalizeSession({
            session,
            result,
            selfReview,
            userFeedback: feedback,
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
