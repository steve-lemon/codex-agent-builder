// Resolves resource file paths from a shared resource root and optional profile-specific variants.
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** Options for resolving a JSON resource path inside the shared resource root. */
export interface JsonResourcePathOptions {
    fallbackRoot: string;
    relativePath: string;
    profileEnvVarName?: string;
    resourceRootEnvVarName?: string;
}

/** Inserts a profile suffix before the file extension. */
export function withProfileSuffix(filePath: string, profile: string): string {
    const extension = extname(filePath);
    const fileBase = basename(filePath, extension);
    return join(dirname(filePath), `${fileBase}.${profile}${extension}`);
}

/** Resolves the active file path for a JSON-backed resource inside the resource root. */
export function resolveJsonResourcePath(options: JsonResourcePathOptions): string {
    const root = process.env[options.resourceRootEnvVarName ?? 'CODEX_RESOURCE_ROOT'] ?? options.fallbackRoot;
    const defaultPath = join(root, options.relativePath);
    const profile = process.env[options.profileEnvVarName ?? 'CODEX_RESOURCE_PROFILE'];

    if (profile) {
        const profiledPath = withProfileSuffix(defaultPath, profile);
        if (existsSync(profiledPath)) {
            return profiledPath;
        }
    }

    return defaultPath;
}
