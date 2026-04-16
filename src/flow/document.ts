// Flow document creation and mutation helpers.
import { AgentError } from '../errors/agent-error';
import type {
    ConnectFlowPortsOptions,
    CreateFlowNodeOptions,
    FlowBlockDefinition,
    FlowDocument,
    FlowEdge,
    FlowNode,
    FlowPort,
    FlowPortDataType,
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

    return {
        flow: {
            ...flow,
            edges: [...flow.edges, edge],
        },
        edge,
    };
}

/** Returns whether two port types can be connected. */
export function arePortTypesCompatible(sourceType: FlowPortDataType, targetType: FlowPortDataType): boolean {
    return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
}

function materializePort(nodeId: string, port: FlowBlockDefinition['inputs'][number]): FlowPort {
    return {
        id: `${nodeId}:${port.key}`,
        nodeId,
        key: port.key,
        label: port.label,
        direction: port.direction,
        dataType: port.dataType,
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

function findPort(ports: FlowPort[], portKeyOrId: string): FlowPort | undefined {
    return ports.find(port => port.key === portKeyOrId || port.id === portKeyOrId);
}
