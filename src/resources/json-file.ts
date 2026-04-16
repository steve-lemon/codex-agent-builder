// Shared JSON resource loader for file-backed defaults, manifests, and fake copy.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ZodType } from 'zod';

/** Abstract text source so file-backed JSON can later be swapped with remote/config-backed sources. */
export interface JsonTextResourceSource {
    readTextSync(): string;
    readText(): Promise<string>;
}

/** Default text source implementation backed by the local filesystem. */
export class FileJsonTextResourceSource implements JsonTextResourceSource {
    constructor(private readonly filePath: string) {}

    readTextSync(): string {
        return readFileSync(this.filePath, 'utf8');
    }

    readText(): Promise<string> {
        return readFile(this.filePath, 'utf8');
    }
}

/** Generic cached JSON resource with sync and async loading paths. */
export class CachedJsonResource<T> {
    private cachedValue: T | undefined;

    constructor(private readonly source: JsonTextResourceSource, private readonly schema: ZodType<T>) {}

    loadSync(): T {
        if (this.cachedValue) {
            return this.cachedValue;
        }

        this.cachedValue = this.schema.parse(JSON.parse(this.source.readTextSync()));
        return this.cachedValue;
    }

    async load(): Promise<T> {
        if (this.cachedValue) {
            return this.cachedValue;
        }

        this.cachedValue = this.schema.parse(JSON.parse(await this.source.readText()));
        return this.cachedValue;
    }
}

/** Backward-compatible file-backed wrapper around the generic cached JSON resource. */
export class CachedJsonFileResource<T> extends CachedJsonResource<T> {
    constructor(filePath: string, schema: ZodType<T>) {
        super(new FileJsonTextResourceSource(filePath), schema);
    }
}
