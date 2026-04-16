// Helpers for resolving planner step-result references inside tool arguments.
import { AgentError } from '../errors/agent-error';
import type { StepResult } from './types';

/** Structured reference to a previously completed planner step result. */
export interface StepResultReference {
    /** Step id to load from the current run history. */
    $fromStep: string;

    /** Optional dotted path inside the step result payload. */
    path?: string;
}

/** Returns true when a value is a structured step-result reference. */
export function isStepResultReference(value: unknown): value is StepResultReference {
    return (
        typeof value === 'object' &&
        value !== null &&
        '$fromStep' in value &&
        typeof (value as { $fromStep?: unknown }).$fromStep === 'string'
    );
}

/** Returns true when any nested value contains a step-result reference. */
export function containsStepReferences(value: unknown): boolean {
    if (isStepResultReference(value)) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.some(containsStepReferences);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(containsStepReferences);
    }
    return false;
}

/** Validates the shape of all nested step references before execution begins. */
export function validateStepReferences(value: unknown, currentPath = 'args'): void {
    if (isStepResultReference(value)) {
        if (!value.$fromStep.trim()) {
            throw new AgentError(`Invalid step reference at ${currentPath}: $fromStep must be non-empty`);
        }
        if (value.path !== undefined && !value.path.trim()) {
            throw new AgentError(`Invalid step reference at ${currentPath}: path must be non-empty when provided`);
        }
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => validateStepReferences(item, `${currentPath}.${index}`));
        return;
    }

    if (typeof value === 'object' && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
            validateStepReferences(nested, `${currentPath}.${key}`);
        }
    }
}

function getPathValue(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (current === undefined || current === null) {
            return undefined;
        }

        if (Array.isArray(current)) {
            const index = Number(segment);
            return Number.isInteger(index) ? current[index] : undefined;
        }

        if (typeof current === 'object') {
            return (current as Record<string, unknown>)[segment];
        }

        return undefined;
    }, value);
}

/** Resolves all nested step-result references against the completed run history. */
export function resolveStepReferences<TValue>(value: TValue, stepResults: StepResult[]): TValue {
    if (isStepResultReference(value)) {
        const stepResult = stepResults.find(candidate => candidate.stepId === value.$fromStep);
        if (!stepResult) {
            throw new AgentError(`Step reference could not be resolved: ${value.$fromStep}`);
        }

        if (!value.path) {
            return stepResult as TValue;
        }

        const resolved = getPathValue(stepResult, value.path);
        if (resolved === undefined) {
            throw new AgentError(`Step reference path could not be resolved: ${value.$fromStep}.${value.path}`);
        }

        return resolved as TValue;
    }

    if (Array.isArray(value)) {
        return value.map(item => resolveStepReferences(item, stepResults)) as TValue;
    }

    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, resolveStepReferences(nested, stepResults)]),
        ) as TValue;
    }

    return value;
}
