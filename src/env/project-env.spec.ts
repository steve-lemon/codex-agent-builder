import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureProjectEnvLoaded, resetProjectEnvLoaderForTests } from './project-env';

describe('ensureProjectEnvLoaded', () => {
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalProvider = process.env.LLM_PROVIDER;

    afterEach(() => {
        resetProjectEnvLoaderForTests();
        if (originalOpenAiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalOpenAiKey;
        }
        if (originalProvider === undefined) {
            delete process.env.LLM_PROVIDER;
        } else {
            process.env.LLM_PROVIDER = originalProvider;
        }
    });

    it('loads missing env vars from the local .env file without overwriting existing values', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'project-env-'));
        await writeFile(join(dir, '.env'), ['OPENAI_API_KEY=test-openai-key', 'LLM_PROVIDER=openai'].join('\n'));
        delete process.env.OPENAI_API_KEY;
        process.env.LLM_PROVIDER = 'fake';

        ensureProjectEnvLoaded({ cwd: dir });

        expect(process.env.OPENAI_API_KEY).toBe('test-openai-key');
        expect(process.env.LLM_PROVIDER).toBe('fake');
    });
});
