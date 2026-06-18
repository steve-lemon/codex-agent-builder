// Vitest specs for flow packet serialization helpers.
import { describe, expect, it } from 'vitest';
import { AgentError } from '../errors/agent-error';
import { createFlowPacket } from './document';
import {
    DefaultFlowPacketSerializer,
    FlowPacketSerializer,
    deserializeFlowPacket,
    serializeFlowPacket,
} from './serialization';
import type { FlowPacket, FlowPortDataType } from './types';

describe('flow packet serialization', () => {
    it('serializes and deserializes text packets for database storage', () => {
        const packet = createFlowPacket('hello', 101);

        const serialized = serializeFlowPacket('text', packet);
        const restored = deserializeFlowPacket(serialized);

        expect(serialized).toEqual({
            dataType: 'text',
            ts: 101,
            encoding: 'string',
            value: 'hello',
        });
        expect(restored).toEqual(packet);
    });

    it('serializes and deserializes json packets as json strings', () => {
        const packet = createFlowPacket({ answer: 42 }, 202);

        const serialized = serializeFlowPacket('json', packet);
        const restored = deserializeFlowPacket(serialized);

        expect(serialized).toEqual({
            dataType: 'json',
            ts: 202,
            encoding: 'json',
            value: '{"answer":42}',
        });
        expect(restored).toEqual(packet);
    });

    it('supports image packets backed by URLs or base64 strings', () => {
        const urlPacket = createFlowPacket('https://example.com/image.png', 303);
        const base64Packet = createFlowPacket('data:image/png;base64,abc123', 304);

        expect(deserializeFlowPacket(serializeFlowPacket('image', urlPacket))).toEqual(urlPacket);
        expect(deserializeFlowPacket(serializeFlowPacket('image', base64Packet))).toEqual(base64Packet);
    });

    it('serializes and deserializes finite number packets through json encoding', () => {
        const packet = createFlowPacket(42.25, 305);

        const serialized = serializeFlowPacket('number', packet);
        const restored = deserializeFlowPacket(serialized);

        expect(serialized).toEqual({
            dataType: 'number',
            ts: 305,
            encoding: 'json',
            value: '42.25',
        });
        expect(restored).toEqual(packet);
    });

    it('preserves null packet values for every supported data type', () => {
        expect(serializeFlowPacket('text', createFlowPacket(null, 501))).toEqual({
            dataType: 'text',
            ts: 501,
            encoding: 'null',
            value: 'null',
        });
        expect(deserializeFlowPacket(serializeFlowPacket('text', createFlowPacket(null, 501)))).toEqual({
            value: null,
            ts: 501,
        });
        expect(deserializeFlowPacket(serializeFlowPacket('json', createFlowPacket(null, 502)))).toEqual({
            value: null,
            ts: 502,
        });
        expect(deserializeFlowPacket(serializeFlowPacket('image', createFlowPacket(null, 503)))).toEqual({
            value: null,
            ts: 503,
        });
        expect(deserializeFlowPacket(serializeFlowPacket('number', createFlowPacket(null, 504)))).toEqual({
            value: null,
            ts: 504,
        });
    });

    it('supports any packets through json encoding', () => {
        const packet = createFlowPacket(['a', 1, { ok: true }], 404);

        const serialized = serializeFlowPacket('any', packet);
        const restored = deserializeFlowPacket(serialized);

        expect(serialized.encoding).toBe('json');
        expect(restored).toEqual(packet);
    });

    it('rejects invalid serialization or deserialization payloads', () => {
        expect(() => serializeFlowPacket('image', createFlowPacket({ bad: true }, 1))).toThrow(AgentError);
        expect(() => serializeFlowPacket('number', createFlowPacket(Number.POSITIVE_INFINITY, 1))).toThrow(
            /finite number value/,
        );
        expect(() =>
            deserializeFlowPacket({
                dataType: 'json',
                ts: 1,
                encoding: 'string',
                value: '{"bad":true}',
            }),
        ).toThrow(/must use json encoding/);
        expect(() =>
            deserializeFlowPacket({
                dataType: 'json',
                ts: 1,
                encoding: 'json',
                value: 'not-json',
            }),
        ).toThrow(/could not be parsed from JSON/);
        expect(() =>
            deserializeFlowPacket({
                dataType: 'text',
                ts: 1,
                encoding: 'json',
                value: '"hello"',
            }),
        ).toThrow(/must use string encoding/);
        expect(() =>
            deserializeFlowPacket({
                dataType: 'number',
                ts: 1,
                encoding: 'string',
                value: '1',
            }),
        ).toThrow(/must use json encoding/);
        expect(() =>
            deserializeFlowPacket({
                dataType: 'number',
                ts: 1,
                encoding: 'json',
                value: '"oops"',
            }),
        ).toThrow(/decode to a finite number/);
    });

    it('allows subclasses to customize packet encoding policies', () => {
        class UppercaseTextSerializer extends DefaultFlowPacketSerializer {
            protected override serializeNonNull(dataType: FlowPortDataType, packet: FlowPacket) {
                const serialized = super.serializeNonNull(dataType, packet);
                if (dataType === 'text' && serialized.encoding === 'string') {
                    return {
                        ...serialized,
                        value: serialized.value.toUpperCase(),
                    };
                }
                return serialized;
            }
        }

        const serializer: FlowPacketSerializer = new UppercaseTextSerializer();
        const serialized = serializer.serialize('text', createFlowPacket('hello', 9));

        expect(serialized).toEqual({
            dataType: 'text',
            ts: 9,
            encoding: 'string',
            value: 'HELLO',
        });
    });
});
