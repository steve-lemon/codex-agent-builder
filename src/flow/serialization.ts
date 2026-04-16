// Flow packet serialization helpers for database persistence.
import { AgentError } from '../errors/agent-error';
import type { FlowPacket, FlowPortDataType, SerializedFlowPacket } from './types';

/**
 * Base class for packet serialization.
 *
 * Higher-level callers can depend on this stable contract while subclasses
 * customize encoding rules for a specific database or transport.
 */
export abstract class FlowPacketSerializer {
    serialize(dataType: FlowPortDataType, packet: FlowPacket): SerializedFlowPacket {
        if (packet.value === null) {
            return {
                dataType,
                ts: packet.ts,
                encoding: 'null',
                value: 'null',
            };
        }

        return this.serializeNonNull(dataType, packet);
    }

    deserialize(serialized: SerializedFlowPacket): FlowPacket {
        if (serialized.encoding === 'null') {
            return {
                value: null,
                ts: serialized.ts,
            };
        }

        return this.deserializeNonNull(serialized);
    }

    protected abstract serializeNonNull(dataType: FlowPortDataType, packet: FlowPacket): SerializedFlowPacket;

    protected abstract deserializeNonNull(serialized: SerializedFlowPacket): FlowPacket;
}

/** Default database-safe serializer for flow packets. */
export class DefaultFlowPacketSerializer extends FlowPacketSerializer {
    protected serializeNonNull(dataType: FlowPortDataType, packet: FlowPacket): SerializedFlowPacket {
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

    protected deserializeNonNull(serialized: SerializedFlowPacket): FlowPacket {
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
}

const defaultFlowPacketSerializer = new DefaultFlowPacketSerializer();

/** Serializes a runtime packet into a string-safe database payload. */
export function serializeFlowPacket(dataType: FlowPortDataType, packet: FlowPacket): SerializedFlowPacket {
    return defaultFlowPacketSerializer.serialize(dataType, packet);
}

/** Restores a runtime packet from its database-safe representation. */
export function deserializeFlowPacket(serialized: SerializedFlowPacket): FlowPacket {
    return defaultFlowPacketSerializer.deserialize(serialized);
}
