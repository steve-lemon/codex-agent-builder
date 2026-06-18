// Resolves resource file paths from a shared resource root and optional profile-specific variants.
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export interface ResourcePathOptions {
    fallbackRoot: string;
    relativePath: string;
    profileEnvVarName?: string;
    resourceRootEnvVarName?: string;
}

export function withProfileSuffix(filePath: string, profile: string): string {
    const extension = extname(filePath);
    const fileBase = basename(filePath, extension);
    return join(dirname(filePath), `${fileBase}.${profile}${extension}`);
}

export function resolveResourcePath(options: ResourcePathOptions): string {
    const root = process.env[options.resourceRootEnvVarName ?? 'CODEX_RESOURCE_ROOT'] ?? options.fallbackRoot;
    const defaultPath = join(root, options.relativePath);
    const profile = process.env[options.profileEnvVarName ?? 'CODEX_RESOURCE_PROFILE'];

    if (profile) {
        const profiledPath = withProfileSuffix(defaultPath, profile);
        if (existsSync(profiledPath)) {
            return profiledPath;
        }
    }

    // TODO(resources): Support hierarchical profile fallback such as
    // `production-apac -> production -> default` when deployment environments become more granular.
    return defaultPath;
}
