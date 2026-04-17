import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { now } from '../tools/now';
import type { AdvisorEvaluationReport } from '../flow/design/advisor-evaluation';
import type { PromptLabSessionConfig, PromptLabSessionRecord } from './types';

function slugify(input: string): string {
    return (
        input
            .toLowerCase()
            .replace(/[^a-z0-9가-힣]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'session'
    );
}

function timestampId(): string {
    return new Date(now()).toISOString().replace(/[:.]/g, '-');
}

function resolvePromptLabRoot(outputRoot?: string): string {
    const root = outputRoot ?? 'output/labs';
    return isAbsolute(root) ? root : resolve(process.cwd(), root);
}

const REQUIREMENT_HISTORY_FILE = 'prompt-lab-history.json';
const ADVISOR_EVAL_HISTORY_FILE = 'advisor-evaluation-history.json';
const MAX_REQUIREMENT_HISTORY = 20;
const MAX_ADVISOR_EVAL_HISTORY = 50;

export interface PromptLabRequirementHistoryEntry {
    requirement: string;
    usedAt: string;
}

export interface PromptLabAdvisorEvaluationHistoryEntry {
    recordedAt: string;
    sessionId: string;
    sessionDir: string;
    provider: string;
    liteModel: string;
    overallPassRate: number;
    overallLiteDecisionRate: number;
    overallLitePassRate: number;
    overallFallbackRate: number;
    overallAverageLiteDurationMs: number | null;
    summary: string;
}

export async function createPromptLabSession(
    config: PromptLabSessionConfig,
    requirement: string,
): Promise<PromptLabSessionRecord> {
    const sessionId = timestampId();
    const rootDir = resolvePromptLabRoot(config.outputRoot);
    const sessionDir = join(rootDir, `${sessionId}-${slugify(requirement)}`);
    await mkdir(sessionDir, { recursive: true });

    const session: PromptLabSessionRecord = {
        sessionId,
        sessionDir,
        startedAt: new Date(now()).toISOString(),
        requirement,
        config,
    };

    await writeJson(join(sessionDir, 'session.json'), session);
    return session;
}

export async function appendNdjson(filePath: string, value: unknown): Promise<void> {
    await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath: string, value: string): Promise<void> {
    await writeFile(filePath, value, 'utf8');
}

export async function readPromptLabRequirementHistory(
    config: Pick<PromptLabSessionConfig, 'outputRoot'>,
): Promise<PromptLabRequirementHistoryEntry[]> {
    const rootDir = resolvePromptLabRoot(config.outputRoot);
    const historyPath = join(rootDir, REQUIREMENT_HISTORY_FILE);

    try {
        const raw = await readFile(historyPath, 'utf8');
        const parsed = JSON.parse(raw) as PromptLabRequirementHistoryEntry[];
        return Array.isArray(parsed)
            ? parsed.filter(
                  entry =>
                      typeof entry?.requirement === 'string' &&
                      entry.requirement.trim().length > 0 &&
                      typeof entry?.usedAt === 'string',
              )
            : [];
    } catch {
        return [];
    }
}

export async function cachePromptLabRequirement(
    config: Pick<PromptLabSessionConfig, 'outputRoot'>,
    requirement: string,
): Promise<void> {
    const normalizedRequirement = requirement.trim();
    if (!normalizedRequirement) {
        return;
    }

    const rootDir = resolvePromptLabRoot(config.outputRoot);
    const historyPath = join(rootDir, REQUIREMENT_HISTORY_FILE);
    await mkdir(rootDir, { recursive: true });

    const existing = await readPromptLabRequirementHistory(config);
    const deduped = existing.filter(entry => entry.requirement !== normalizedRequirement);
    const nextHistory: PromptLabRequirementHistoryEntry[] = [
        {
            requirement: normalizedRequirement,
            usedAt: new Date(now()).toISOString(),
        },
        ...deduped,
    ].slice(0, MAX_REQUIREMENT_HISTORY);

    await writeJson(historyPath, nextHistory);
}

export function getPromptLabAdvisorEvaluationHistoryPath(config: Pick<PromptLabSessionConfig, 'outputRoot'>): string {
    return join(resolvePromptLabRoot(config.outputRoot), ADVISOR_EVAL_HISTORY_FILE);
}

export async function readPromptLabAdvisorEvaluationHistory(
    config: Pick<PromptLabSessionConfig, 'outputRoot'>,
): Promise<PromptLabAdvisorEvaluationHistoryEntry[]> {
    const historyPath = getPromptLabAdvisorEvaluationHistoryPath(config);

    try {
        const raw = await readFile(historyPath, 'utf8');
        const parsed = JSON.parse(raw) as PromptLabAdvisorEvaluationHistoryEntry[];
        return Array.isArray(parsed)
            ? parsed.filter(
                  entry =>
                      typeof entry?.recordedAt === 'string' &&
                      typeof entry?.sessionId === 'string' &&
                      typeof entry?.sessionDir === 'string' &&
                      typeof entry?.provider === 'string' &&
                      typeof entry?.liteModel === 'string',
              )
            : [];
    } catch {
        return [];
    }
}

export async function appendPromptLabAdvisorEvaluationHistory(args: {
    config: Pick<PromptLabSessionConfig, 'outputRoot'>;
    session: PromptLabSessionRecord;
    report: AdvisorEvaluationReport;
}): Promise<void> {
    const historyPath = getPromptLabAdvisorEvaluationHistoryPath(args.config);
    const rootDir = resolvePromptLabRoot(args.config.outputRoot);
    await mkdir(rootDir, { recursive: true });

    const existing = await readPromptLabAdvisorEvaluationHistory(args.config);
    const nextHistory: PromptLabAdvisorEvaluationHistoryEntry[] = [
        {
            recordedAt: args.report.recordedAt,
            sessionId: args.session.sessionId,
            sessionDir: args.session.sessionDir,
            provider: args.report.provider,
            liteModel: args.report.liteModel,
            overallPassRate: args.report.overallPassRate,
            overallLiteDecisionRate: args.report.overallLiteDecisionRate,
            overallLitePassRate: args.report.overallLitePassRate,
            overallFallbackRate: args.report.overallFallbackRate,
            overallAverageLiteDurationMs: args.report.overallTiming.averageMs,
            summary: args.report.summary,
        },
        ...existing.filter(entry => entry.sessionId !== args.session.sessionId),
    ].slice(0, MAX_ADVISOR_EVAL_HISTORY);

    await writeJson(historyPath, nextHistory);
}
