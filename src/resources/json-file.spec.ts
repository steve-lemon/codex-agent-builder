// Vitest specs for shared JSON resource loading and path resolution.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { CachedJsonResource } from './json-file';
import { resolveJsonResourcePath } from './path-resolver';

const originalProfile = process.env.CODEX_RESOURCE_PROFILE;
const originalResourceRoot = process.env.CODEX_RESOURCE_ROOT;

afterEach(() => {
    if (typeof originalProfile === 'undefined') {
        delete process.env.CODEX_RESOURCE_PROFILE;
    } else {
        process.env.CODEX_RESOURCE_PROFILE = originalProfile;
    }

    if (typeof originalResourceRoot === 'undefined') {
        delete process.env.CODEX_RESOURCE_ROOT;
    } else {
        process.env.CODEX_RESOURCE_ROOT = originalResourceRoot;
    }
});

describe('json resource helpers', () => {
    it('caches parsed values across sync and async reads', async () => {
        let reads = 0;
        const resource = new CachedJsonResource(
            {
                readTextSync() {
                    reads += 1;
                    return '{"value":"cached"}';
                },
                async readText() {
                    reads += 1;
                    return '{"value":"cached"}';
                },
            },
            z.object({
                value: z.string(),
            }),
        );

        expect(resource.loadSync()).toEqual({ value: 'cached' });
        expect(await resource.load()).toEqual({ value: 'cached' });
        expect(reads).toBe(1);
    });

    it('uses a profiled sibling file when CODEX_RESOURCE_PROFILE is set', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'json-resource-profile-'));
        const skillDir = join(rootDir, 'skills', 'flow-designer');
        const defaultPath = join(skillDir, 'FLOW_DESIGN_MANIFEST.json');
        const profiledPath = join(skillDir, 'FLOW_DESIGN_MANIFEST.staging.json');

        await mkdir(skillDir, { recursive: true });
        await writeFile(defaultPath, '{"value":"default"}', 'utf8');
        await writeFile(profiledPath, '{"value":"staging"}', 'utf8');
        process.env.CODEX_RESOURCE_PROFILE = 'staging';
        process.env.CODEX_RESOURCE_ROOT = rootDir;

        const resolvedPath = resolveJsonResourcePath({
            fallbackRoot: join(process.cwd(), 'data'),
            relativePath: join('skills', 'flow-designer', 'FLOW_DESIGN_MANIFEST.json'),
        });

        expect(resolvedPath).toBe(profiledPath);
    });

    it('resolves from CODEX_RESOURCE_ROOT before falling back to the built-in data directory', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'json-resource-root-'));
        const runtimeDir = join(rootDir, 'runtime');
        const defaultPath = join(runtimeDir, 'LLM_RUNTIME_MANIFEST.json');
        const profiledPath = join(runtimeDir, 'LLM_RUNTIME_MANIFEST.production.json');

        await mkdir(runtimeDir, { recursive: true });
        await writeFile(defaultPath, '{"value":"root"}', 'utf8');
        await writeFile(profiledPath, '{"value":"production"}', 'utf8');
        process.env.CODEX_RESOURCE_PROFILE = 'production';
        process.env.CODEX_RESOURCE_ROOT = rootDir;

        const resolvedPath = resolveJsonResourcePath({
            fallbackRoot: join(process.cwd(), 'data'),
            relativePath: join('runtime', 'LLM_RUNTIME_MANIFEST.json'),
        });

        expect(resolvedPath).toBe(profiledPath);
    });
});
