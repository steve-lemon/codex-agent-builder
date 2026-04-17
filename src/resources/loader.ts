import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { getResourceDefinition, type ResourceId, type ResourceSchemaMap } from './registry';
import { resolveResourcePath } from './path-resolver';

export interface TextResourceSource {
    readText(path: string): Promise<string>;
}

export class FileTextResourceSource implements TextResourceSource {
    async readText(path: string): Promise<string> {
        return await readFile(path, 'utf8');
    }
}

const defaultTextResourceSource = new FileTextResourceSource();
const resourceCache = new Map<string, Promise<unknown>>();

export function clearResourceCache(): void {
    resourceCache.clear();
}

export async function loadResource<K extends ResourceId>(
    id: K,
    source: TextResourceSource = defaultTextResourceSource,
): Promise<ResourceSchemaMap[K]> {
    const definition = getResourceDefinition(id);
    const resolvedPath = resolveResourcePath({
        fallbackRoot: `${process.cwd()}/data`,
        relativePath: definition.relativePath,
    });
    const cacheKey = `${id}:${resolvedPath}`;

    if (!resourceCache.has(cacheKey)) {
        resourceCache.set(
            cacheKey,
            (async () => {
                // TODO(resources): Support non-file text sources with metadata such as etag/version
                // so remote config backends can participate in cache invalidation safely.
                const text = await source.readText(resolvedPath);
                const parsed = yaml.load(text);
                // TODO(resources): Distinguish parse errors from schema-validation failures with
                // a structured ResourceLoadError so callers can surface better operator diagnostics.
                return definition.schema.parse(parsed);
            })(),
        );
    }

    // TODO(resources): Add optional stale-while-revalidate or TTL-based refresh for long-lived
    // product processes that should pick up manifest changes without a full restart.
    return (await resourceCache.get(cacheKey)) as ResourceSchemaMap[K];
}
