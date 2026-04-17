// Vitest specs for the view node configuration strategy.
import { describe, expect, it } from 'vitest';
import { ViewNodeStrategy } from './view';

describe('view node strategy', () => {
    it('exposes the expected strategy id', () => {
        const strategy = new ViewNodeStrategy();
        expect(strategy.strategyId).toBe('view-observer');
    });
});
