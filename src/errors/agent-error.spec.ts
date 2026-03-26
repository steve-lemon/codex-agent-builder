// Vitest specs for core runtime behaviors.
import { describe, expect, it } from 'vitest';
import { AgentError } from './agent-error';

describe('AgentError', () => {
    it('stores message, code, transient flag, and cause from constructor options', () => {
        const cause = new Error('disk failure');
        const error = new AgentError('wrapper failed', {
            cause,
            code: 'E_WRAPPER',
            transient: true,
        });

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(AgentError);
        expect(error.name).toBe('AgentError');
        expect(error.message).toBe('wrapper failed');
        expect(error.code).toBe('E_WRAPPER');
        expect(error.transient).toBe(true);
        expect(error.cause).toBe(cause);
    });

    it('defaults transient to false when not provided', () => {
        const error = new AgentError('plain failure');

        expect(error.transient).toBe(false);
        expect(error.code).toBeUndefined();
        expect(error.cause).toBeUndefined();
    });

    it('rootCause returns the deepest nested cause for chained AgentErrors', () => {
        const root = new Error('root');
        const middle = new AgentError('middle', { cause: root });
        const top = new AgentError('top', { cause: middle });

        expect(AgentError.rootCause(top)).toBe(root);
    });

    it('rootCause returns primitive causes when the deepest cause is not an Error', () => {
        const top = new AgentError('top', { cause: 'primitive-cause' });

        expect(AgentError.rootCause(top)).toBe('primitive-cause');
    });

    it('rootCause returns the original value when no nested cause exists', () => {
        const plain = new Error('plain');

        expect(AgentError.rootCause(plain)).toBe(plain);
        expect(AgentError.rootCause('not-an-error')).toBe('not-an-error');
    });

    it('from wraps a plain Error and preserves the deepest root cause', () => {
        const root = new Error('database offline');
        const wrapped = new Error('service failed');
        (wrapped as Error & { cause?: unknown }).cause = root;

        const agentError = AgentError.from(wrapped);

        expect(agentError).toBeInstanceOf(AgentError);
        expect(agentError.message).toBe('service failed');
        expect(agentError.cause).toBe(root);
        expect(agentError.transient).toBe(false);
        expect(agentError.code).toBeUndefined();
    });

    it('from re-wraps an AgentError while preserving message, code, transient, and root cause', () => {
        const root = new Error('socket reset');
        const original = new AgentError('transport failed', {
            cause: new AgentError('retry layer failed', {
                cause: root,
                code: 'E_RETRY',
                transient: true,
            }),
            code: 'E_TRANSPORT',
            transient: true,
        });

        const wrapped = AgentError.from(original);

        expect(wrapped).not.toBe(original);
        expect(wrapped.message).toBe('transport failed');
        expect(wrapped.code).toBe('E_TRANSPORT');
        expect(wrapped.transient).toBe(true);
        expect(wrapped.cause).toBe(root);
    });

    it('from wraps non-Error throwables with the fallback message and raw cause', () => {
        const thrownValue = { status: 500, detail: 'boom' };

        const wrapped = AgentError.from(thrownValue, 'custom fallback');

        expect(wrapped.message).toBe('custom fallback');
        expect(wrapped.cause).toBe(thrownValue);
        expect(wrapped.transient).toBe(false);
    });

    it('from uses the default fallback message for primitive throwables', () => {
        const wrapped = AgentError.from(42);

        expect(wrapped.message).toBe('Agent execution failed');
        expect(wrapped.cause).toBe(42);
    });
});
