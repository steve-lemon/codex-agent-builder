// Structured tracing types and tracer implementation.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TraceDocument, TraceStore } from './types';

/** Persists trace sessions as JSON files under the configured output directory. */
export class FileTraceStore implements TraceStore {
    constructor(
        private readonly outputDir = join(process.cwd(), 'output', 'traces'),
        private readonly isMocks = true,
    ) {}

    async save(document: TraceDocument): Promise<string> {
        await mkdir(this.outputDir, { recursive: true });
        const filePath = join(this.outputDir, `${document.runId}.json`);
        if (!this.isMocks) await writeFile(filePath, JSON.stringify(document, null, 2), 'utf-8');
        return filePath;
    }
}
