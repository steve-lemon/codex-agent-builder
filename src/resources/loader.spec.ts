// Vitest specs for shared async resource loading and path resolution.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { clearResourceCache, loadResource } from './loader';
import { resolveResourcePath } from './path-resolver';

const originalProfile = process.env.CODEX_RESOURCE_PROFILE;
const originalResourceRoot = process.env.CODEX_RESOURCE_ROOT;

afterEach(() => {
    clearResourceCache();
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

describe('resource helpers', () => {
    it('loads manifest resources asynchronously and caches by resolved path', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'resource-cache-'));
        const skillDir = join(rootDir, 'skills', 'flow-designer');
        await mkdir(skillDir, { recursive: true });
        await writeFile(
            join(skillDir, 'FLOW_DESIGN_MANIFEST.yml'),
            [
                'taskTypes: []',
                'taskGraphTemplates: []',
                'classifierPrompts:',
                '  taskTypeSystemPrompt: classify',
                '  taskGraphSystemPrompt: graph',
                'defaults:',
                '  sampleInputs:',
                '    default: sample',
                '    keywordDriven: keyword',
                '    byTaskType: {}',
                '  systemPrompts:',
                '    unknown: unknown',
                '  aiNodeDefaults:',
                '    model: model',
                '  probeDefaults:',
                '    sampleConfig:',
                '      model: probe',
                '    sampleInputs:',
                '      system: sys',
                '      prompt: prompt',
                '  taskTypeSelection:',
                '    jsonPreferredTaskTypeId: json-generation',
                '    plainTextFallbackTaskTypeId: text-generation',
                'knowledge:',
                '  sharedDraftNotes: []',
                '  reflectionNotes: []',
                '  reflectionRules: []',
                '',
            ].join('\n'),
            'utf8',
        );
        process.env.CODEX_RESOURCE_ROOT = rootDir;

        const first = await loadResource('flow-design.manifest');
        const second = await loadResource('flow-design.manifest');

        expect(first).toBe(second);
        expect(first.defaults.aiNodeDefaults.model).toBe('model');
    });

    it('uses a profiled sibling file when CODEX_RESOURCE_PROFILE is set', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'resource-profile-'));
        const skillDir = join(rootDir, 'skills', 'flow-designer');
        const defaultPath = join(skillDir, 'FLOW_DESIGN_MANIFEST.yml');
        const profiledPath = join(skillDir, 'FLOW_DESIGN_MANIFEST.staging.yml');

        await mkdir(skillDir, { recursive: true });
        await writeFile(defaultPath, 'value: default\n', 'utf8');
        await writeFile(profiledPath, 'value: staging\n', 'utf8');
        process.env.CODEX_RESOURCE_PROFILE = 'staging';
        process.env.CODEX_RESOURCE_ROOT = rootDir;

        const resolvedPath = resolveResourcePath({
            fallbackRoot: join(process.cwd(), 'data'),
            relativePath: join('skills', 'flow-designer', 'FLOW_DESIGN_MANIFEST.yml'),
        });

        expect(resolvedPath).toBe(profiledPath);
    });

    it('resolves from CODEX_RESOURCE_ROOT before falling back to the built-in data directory', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'resource-root-'));
        const runtimeDir = join(rootDir, 'runtime');
        const defaultPath = join(runtimeDir, 'LLM_RUNTIME_MANIFEST.yml');
        const profiledPath = join(runtimeDir, 'LLM_RUNTIME_MANIFEST.production.yml');

        await mkdir(runtimeDir, { recursive: true });
        await writeFile(defaultPath, 'value: root\n', 'utf8');
        await writeFile(profiledPath, 'value: production\n', 'utf8');
        process.env.CODEX_RESOURCE_PROFILE = 'production';
        process.env.CODEX_RESOURCE_ROOT = rootDir;

        const resolvedPath = resolveResourcePath({
            fallbackRoot: join(process.cwd(), 'data'),
            relativePath: join('runtime', 'LLM_RUNTIME_MANIFEST.yml'),
        });

        expect(resolvedPath).toBe(profiledPath);
    });
});
