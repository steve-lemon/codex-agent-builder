import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

function stripMatchingQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

function parseEnvFile(text: string): Array<[string, string]> {
    const entries: Array<[string, string]> = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const equalIndex = line.indexOf('=');
        if (equalIndex <= 0) {
            continue;
        }

        const key = line.slice(0, equalIndex).trim();
        const value = stripMatchingQuotes(line.slice(equalIndex + 1).trim());
        if (!key) {
            continue;
        }
        entries.push([key, value]);
    }

    return entries;
}

export function ensureProjectEnvLoaded(options?: { cwd?: string }): void {
    if (loaded) {
        return;
    }

    const envPath = resolve(options?.cwd ?? process.cwd(), '.env');
    if (!existsSync(envPath)) {
        loaded = true;
        return;
    }

    const entries = parseEnvFile(readFileSync(envPath, 'utf8'));
    for (const [key, value] of entries) {
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }

    loaded = true;
}

export function resetProjectEnvLoaderForTests(): void {
    loaded = false;
}
