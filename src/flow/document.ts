// Flow document creation, connection, and packet helpers.
import { AgentError } from '../errors/agent-error';
import { now } from '../time/now';
import type {
    ConnectFlowPortsOptions,
    CreateFlowNodeOptions,
    FlowBlockDefinition,
    FlowDocument,
    FlowEdge,
    FlowImageValue,
    FlowNode,
    FlowPacket,
    FlowPacketValueMap,
    FlowPort,
    FlowPortDataType,
    SetFlowPortPacketOptions,
} from './types';

/** Creates an empty flow document with optional initial block definitions. */
export function createFlowDocument(blocks: FlowBlockDefinition[] = []): FlowDocument {
    return {
        blocks: [...blocks],
        nodes: [],
        edges: [],
    };
}

/** Registers a new block definition in the flow document. */
export function registerFlowBlock(flow: FlowDocument, block: FlowBlockDefinition): FlowDocument {
    if (flow.blocks.some(existing => existing.id === block.id)) {
        throw new AgentError(`Flow block already exists: ${block.id}`);
    }

    return {
        ...flow,
        blocks: [...flow.blocks, block],
    };
}

/** Creates a node from a registered block definition and appends it to the flow document. */
export function createFlowNode(
    flow: FlowDocument,
    blockId: string,
    options: CreateFlowNodeOptions = {},
): { flow: FlowDocument; node: FlowNode } {
    const block = flow.blocks.find(candidate => candidate.id === blockId);
    if (!block) {
        throw new AgentError(`Flow block not found: ${blockId}`);
    }

    const nodeId = options.nodeId ?? nextNodeId(blockId, flow.nodes);
    if (flow.nodes.some(node => node.id === nodeId)) {
        throw new AgentError(`Flow node id already exists: ${nodeId}`);
    }

    const node: FlowNode = {
        id: nodeId,
        blockId: block.id,
        label: options.label ?? block.label,
        inputPorts: block.inputs.map(port => materializePort(nodeId, port)),
        outputPorts: block.outputs.map(port => materializePort(nodeId, port)),
        config: options.config,
    };

    return {
        flow: {
            ...flow,
            nodes: [...flow.nodes, node],
        },
        node,
    };
}

/** Connects one node output port to another node input port after validating compatibility. */
export function connectFlowPorts(
    flow: FlowDocument,
    options: ConnectFlowPortsOptions,
): { flow: FlowDocument; edge: FlowEdge } {
    const sourceNode = flow.nodes.find(node => node.id === options.sourceNodeId);
    if (!sourceNode) {
        throw new AgentError(`Flow source node not found: ${options.sourceNodeId}`);
    }

    const targetNode = flow.nodes.find(node => node.id === options.targetNodeId);
    if (!targetNode) {
        throw new AgentError(`Flow target node not found: ${options.targetNodeId}`);
    }

    const sourcePort = findPort(sourceNode.outputPorts, options.sourcePort);
    if (!sourcePort) {
        throw new AgentError(`Flow source output port not found: ${options.sourceNodeId}:${options.sourcePort}`);
    }

    const targetPort = findPort(targetNode.inputPorts, options.targetPort);
    if (!targetPort) {
        throw new AgentError(`Flow target input port not found: ${options.targetNodeId}:${options.targetPort}`);
    }

    if (flow.edges.some(edge => edge.targetPortId === targetPort.id)) {
        throw new AgentError(`Flow input port already connected: ${targetPort.id}`);
    }

    if (!arePortTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
        throw new AgentError(`Flow port types are incompatible: ${sourcePort.dataType} -> ${targetPort.dataType}`);
    }

    if (flow.edges.some(edge => edge.sourcePortId === sourcePort.id && edge.targetPortId === targetPort.id)) {
        throw new AgentError(`Flow edge already exists: ${sourcePort.id} -> ${targetPort.id}`);
    }

    const edge: FlowEdge = {
        id: options.edgeId ?? `${sourcePort.id}->${targetPort.id}`,
        sourceNodeId: sourceNode.id,
        sourcePortId: sourcePort.id,
        targetNodeId: targetNode.id,
        targetPortId: targetPort.id,
        label: options.label,
    };

    if (flow.edges.some(existing => existing.id === edge.id)) {
        throw new AgentError(`Flow edge id already exists: ${edge.id}`);
    }

    let nextFlow: FlowDocument = {
        ...flow,
        edges: [...flow.edges, edge],
    };

    // Keep connected input ports aligned with the source packet when present.
    if (sourcePort.packet) {
        nextFlow = setFlowPortPacket(nextFlow, {
            nodeId: targetNode.id,
            port: targetPort.id,
            packet: sourcePort.packet,
        }).flow;
    }

    return {
        flow: nextFlow,
        edge,
    };
}

/** Writes a packet to a port while coercing it to the port's effective data type. */
export function setFlowPortPacket(
    flow: FlowDocument,
    options: SetFlowPortPacketOptions,
): { flow: FlowDocument; port: FlowPort } {
    const node = flow.nodes.find(candidate => candidate.id === options.nodeId);
    if (!node) {
        throw new AgentError(`Flow node not found: ${options.nodeId}`);
    }

    const port = findPort([...node.inputPorts, ...node.outputPorts], options.port);
    if (!port) {
        throw new AgentError(`Flow port not found: ${options.nodeId}:${options.port}`);
    }

    const effectiveType = resolveFlowPortDataType(flow, node.id, port.id);
    const coercedPacket = coercePacketForPort(effectiveType, options.packet);
    const nextFlow = updatePort(flow, port.id, {
        packet: coercedPacket,
    });

    return {
        flow: nextFlow,
        port: getFlowPortById(nextFlow, port.id)!,
    };
}

/** Resolves the effective runtime type of a concrete port. */
export function resolveFlowPortDataType(flow: FlowDocument, nodeId: string, portIdOrLocalId: string): FlowPortDataType {
    const node = flow.nodes.find(candidate => candidate.id === nodeId);
    if (!node) {
        throw new AgentError(`Flow node not found: ${nodeId}`);
    }

    const port = findPort([...node.inputPorts, ...node.outputPorts], portIdOrLocalId);
    if (!port) {
        throw new AgentError(`Flow port not found: ${nodeId}:${portIdOrLocalId}`);
    }

    if (port.direction === 'input' && port.dataType === 'any') {
        const incomingEdge = flow.edges.find(edge => edge.targetPortId === port.id);
        if (!incomingEdge) {
            return 'any';
        }

        const sourcePort = getFlowPortById(flow, incomingEdge.sourcePortId);
        if (!sourcePort) {
            throw new AgentError(`Flow source port not found for edge: ${incomingEdge.id}`);
        }

        return sourcePort.dataType;
    }

    return port.dataType;
}

/** Returns whether two port types can be connected using the built-in coercion rules. */
export function arePortTypesCompatible(sourceType: FlowPortDataType, targetType: FlowPortDataType): boolean {
    if (sourceType === targetType || sourceType === 'any' || targetType === 'any') {
        return true;
    }

    if ((sourceType === 'json' && targetType === 'text') || (sourceType === 'text' && targetType === 'json')) {
        return true;
    }

    if ((sourceType === 'image' && targetType === 'text') || (sourceType === 'text' && targetType === 'image')) {
        return true;
    }

    return false;
}

/** Coerces a packet into the requested target type using the flow's built-in conversion rules. */
export function coercePacketForPort<TTargetType extends FlowPortDataType>(
    targetType: TTargetType,
    packet: FlowPacket,
): FlowPacket<FlowPacketValueMap[TTargetType]> {
    return {
        value: coercePacketValue(targetType, packet.value) as FlowPacketValueMap[TTargetType],
        ts: packet.ts,
    };
}

/** Creates a timestamped packet using the current clock. */
export function createFlowPacket<TValue>(value: TValue, ts = now()): FlowPacket<TValue> {
    return {
        value,
        ts,
    };
}

/** Returns a concrete flow port by its global id. */
export function getFlowPortById(flow: FlowDocument, portId: string): FlowPort | undefined {
    for (const node of flow.nodes) {
        const match = [...node.inputPorts, ...node.outputPorts].find(port => port.id === portId);
        if (match) {
            return match;
        }
    }

    return undefined;
}

function materializePort(nodeId: string, port: FlowBlockDefinition['inputs'][number]): FlowPort {
    return {
        id: `${nodeId}:${port.localId}`,
        nodeId,
        localId: port.localId,
        label: port.label,
        direction: port.direction,
        dataType: port.dataType,
        packet: undefined,
        description: port.description,
    };
}

function nextNodeId(blockId: string, nodes: FlowNode[]): string {
    const prefix = `${blockId}-`;
    const maxNo = nodes
        .filter(node => node.id.startsWith(prefix))
        .map(node => Number(node.id.slice(prefix.length)))
        .filter(value => Number.isInteger(value) && value > 0)
        .reduce((max, value) => Math.max(max, value), 0);

    return `${blockId}-${maxNo + 1}`;
}

function findPort(ports: FlowPort[], portLocalIdOrGlobalId: string): FlowPort | undefined {
    return ports.find(port => port.localId === portLocalIdOrGlobalId || port.id === portLocalIdOrGlobalId);
}

function updatePort(flow: FlowDocument, portId: string, patch: Partial<FlowPort>): FlowDocument {
    return {
        ...flow,
        nodes: flow.nodes.map(node => ({
            ...node,
            inputPorts: node.inputPorts.map(port => (port.id === portId ? { ...port, ...patch } : port)),
            outputPorts: node.outputPorts.map(port => (port.id === portId ? { ...port, ...patch } : port)),
        })),
    };
}

function coercePacketValue(targetType: FlowPortDataType, value: unknown): unknown {
    if (value === null) {
        return null;
    }

    switch (targetType) {
        case 'any':
            return value;
        case 'text':
            return coerceToText(value);
        case 'json':
            return coerceToJson(value);
        case 'image':
            return coerceToImage(value);
        default:
            return value;
    }
}

function coerceToText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value);
}

function coerceToJson(value: unknown): unknown {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (error) {
            throw new AgentError('Flow text packet could not be parsed as JSON', {
                cause: AgentError.rootCause(error),
            });
        }
    }

    return value;
}

function coerceToImage(value: unknown): FlowImageValue {
    if (typeof value === 'string') {
        return value;
    }

    throw new AgentError('Flow image packet must be a URL string or base64-encoded string');
}
