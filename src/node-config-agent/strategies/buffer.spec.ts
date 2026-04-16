// Vitest specs for the buffer node configuration strategy.
import { describe, expect, it } from 'vitest';
import { BufferNodeStrategy } from './buffer';

describe('buffer node strategy', () => {
    it('exposes the expected strategy id', () => {
        const strategy = new BufferNodeStrategy();
        expect(strategy.strategyId).toBe('buffer-timing');
    });
});
