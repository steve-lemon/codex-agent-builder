import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { now } from '../tools/now';
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

export async function createPromptLabSession(
    config: PromptLabSessionConfig,
    requirement: string,
): Promise<PromptLabSessionRecord> {
    const sessionId = timestampId();
    const outputRoot = config.outputRoot ?? 'output/labs';
    const rootDir = isAbsolute(outputRoot) ? outputRoot : resolve(process.cwd(), outputRoot);
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
