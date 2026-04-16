// Flow packet serialization helpers for database persistence.
import { AgentError } from '../errors/agent-error';
import type { FlowPacket, FlowPortDataType, SerializedFlowPacket } from './types';

/**
 * Serializes a runtime packet into a string-safe database payload.
 *
 * Text and image packets are stored as raw strings. Json and any packets are
 * stored as JSON strings so they can round-trip through a database column.
 */
export function serializeFlowPacket(dataType: FlowPortDataType, packet: FlowPacket): SerializedFlowPacket {
    if (packet.value === null) {
        return {
            dataType,
            ts: packet.ts,
            encoding: 'null',
            value: 'null',
        };
    }

    switch (dataType) {
        case 'text':
        case 'image':
            if (typeof packet.value !== 'string') {
                throw new AgentError(`Flow ${dataType} packet must serialize from a string value`);
            }
            return {
                dataType,
                ts: packet.ts,
                encoding: 'string',
                value: packet.value,
            };
        case 'json':
        case 'any':
            return {
                dataType,
                ts: packet.ts,
                encoding: 'json',
                value: JSON.stringify(packet.value),
            };
        default:
            return {
                dataType,
                ts: packet.ts,
                encoding: 'json',
                value: JSON.stringify(packet.value),
            };
    }
}

/**
 * Restores a runtime packet from its database-safe representation.
 *
 * The deserializer validates that the stored encoding matches the declared data
 * type so persistence issues fail fast instead of producing misleading values.
 */
export function deserializeFlowPacket(serialized: SerializedFlowPacket): FlowPacket {
    if (serialized.encoding === 'null') {
        return {
            value: null,
            ts: serialized.ts,
        };
    }

    switch (serialized.dataType) {
        case 'text':
        case 'image':
            if (serialized.encoding !== 'string') {
                throw new AgentError(`Serialized flow ${serialized.dataType} packet must use string encoding`);
            }
            return {
                value: serialized.value,
                ts: serialized.ts,
            };
        case 'json':
        case 'any':
            if (serialized.encoding !== 'json') {
                throw new AgentError(`Serialized flow ${serialized.dataType} packet must use json encoding`);
            }
            try {
                return {
                    value: JSON.parse(serialized.value),
                    ts: serialized.ts,
                };
            } catch (error) {
                throw new AgentError('Serialized flow packet could not be parsed from JSON', {
                    cause: AgentError.rootCause(error),
                });
            }
        default:
            throw new AgentError(`Unsupported serialized flow packet type: ${serialized.dataType}`);
    }
}
