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
    FlowNodeValidationIssue,
    FlowNodeValidationResult,
    FlowPacket,
    FlowPacketValueMap,
    FlowPort,
    FlowPortDataType,
    SetFlowPortPacketOptions,
} from './types';

/**
 * Base class that defines the flow document mutation contract.
 *
 * Subclasses can override the protected policy hooks to customize node id
 * generation, port compatibility, packet coercion, or edge creation while the
 * public workflow stays stable for higher-level callers.
 */
export abstract class FlowDocumentController {
    createDocument(blocks: FlowBlockDefinition[] = []): FlowDocument {
        return {
            blocks: [...blocks],
            nodes: [],
            edges: [],
        };
    }

    registerBlock(flow: FlowDocument, block: FlowBlockDefinition): FlowDocument {
        if (flow.blocks.some(existing => existing.id === block.id)) {
            throw new AgentError(`Flow block already exists: ${block.id}`);
        }

        return {
            ...flow,
            blocks: [...flow.blocks, block],
        };
    }

    createNode(
        flow: FlowDocument,
        blockId: string,
        options: CreateFlowNodeOptions = {},
    ): { flow: FlowDocument; node: FlowNode } {
        const block = flow.blocks.find(candidate => candidate.id === blockId);
        if (!block) {
            throw new AgentError(`Flow block not found: ${blockId}`);
        }

        const nodeId = options.nodeId ?? this.createNodeId(blockId, flow.nodes);
        if (flow.nodes.some(node => node.id === nodeId)) {
            throw new AgentError(`Flow node id already exists: ${nodeId}`);
        }

        const node: FlowNode = {
            id: nodeId,
            blockId: block.id,
            label: options.label ?? block.label,
            inputPorts: block.inputs.map(port => this.materializePort(nodeId, port)),
            outputPorts: block.outputs.map(port => this.materializePort(nodeId, port)),
            config: this.buildNodeConfig(block, options.config),
        };

        return {
            flow: {
                ...flow,
                nodes: [...flow.nodes, node],
            },
            node,
        };
    }

    connectPorts(flow: FlowDocument, options: ConnectFlowPortsOptions): { flow: FlowDocument; edge: FlowEdge } {
        const sourceNode = flow.nodes.find(node => node.id === options.sourceNodeId);
        if (!sourceNode) {
            throw new AgentError(`Flow source node not found: ${options.sourceNodeId}`);
        }

        const targetNode = flow.nodes.find(node => node.id === options.targetNodeId);
        if (!targetNode) {
            throw new AgentError(`Flow target node not found: ${options.targetNodeId}`);
        }

        const sourcePort = this.findPort(sourceNode.outputPorts, options.sourcePort);
        if (!sourcePort) {
            throw new AgentError(`Flow source output port not found: ${options.sourceNodeId}:${options.sourcePort}`);
        }

        const targetPort = this.findPort(targetNode.inputPorts, options.targetPort);
        if (!targetPort) {
            throw new AgentError(`Flow target input port not found: ${options.targetNodeId}:${options.targetPort}`);
        }

        if (flow.edges.some(edge => edge.targetPortId === targetPort.id)) {
            throw new AgentError(`Flow input port already connected: ${targetPort.id}`);
        }

        if (!this.arePortTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
            throw new AgentError(`Flow port types are incompatible: ${sourcePort.dataType} -> ${targetPort.dataType}`);
        }

        if (flow.edges.some(edge => edge.sourcePortId === sourcePort.id && edge.targetPortId === targetPort.id)) {
            throw new AgentError(`Flow edge already exists: ${sourcePort.id} -> ${targetPort.id}`);
        }

        const edge: FlowEdge = {
            id: options.edgeId ?? this.createEdgeId(sourcePort, targetPort),
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

        if (sourcePort.packet !== undefined) {
            nextFlow = this.setPortPacket(nextFlow, {
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

    setPortPacket(flow: FlowDocument, options: SetFlowPortPacketOptions): { flow: FlowDocument; port: FlowPort } {
        const node = flow.nodes.find(candidate => candidate.id === options.nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${options.nodeId}`);
        }

        const port = this.findPort([...node.inputPorts, ...node.outputPorts], options.port);
        if (!port) {
            throw new AgentError(`Flow port not found: ${options.nodeId}:${options.port}`);
        }

        const effectiveType = this.resolvePortDataType(flow, node.id, port.id);
        const coercedPacket = this.coercePacketForPort(effectiveType, options.packet);
        const nextFlow = this.updatePort(flow, port.id, {
            packet: coercedPacket,
        });

        return {
            flow: nextFlow,
            port: this.getPortById(nextFlow, port.id)!,
        };
    }

    propagatePortPacket(
        flow: FlowDocument,
        nodeId: string,
        portIdOrLocalId: string,
    ): { flow: FlowDocument; targets: FlowPort[] } {
        const node = flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        const sourcePort = this.findPort(node.outputPorts, portIdOrLocalId);
        if (!sourcePort) {
            throw new AgentError(`Flow output port not found: ${nodeId}:${portIdOrLocalId}`);
        }

        if (sourcePort.packet === undefined) {
            return {
                flow,
                targets: [],
            };
        }

        let nextFlow = flow;
        const updatedTargets: FlowPort[] = [];

        for (const edge of flow.edges.filter(candidate => candidate.sourcePortId === sourcePort.id)) {
            const target = this.getPortById(nextFlow, edge.targetPortId);
            if (!target) {
                throw new AgentError(`Flow target port not found for edge: ${edge.id}`);
            }
            const updated = this.setPortPacket(nextFlow, {
                nodeId: target.nodeId,
                port: target.id,
                packet: sourcePort.packet,
            });
            nextFlow = updated.flow;
            updatedTargets.push(updated.port);
        }

        return {
            flow: nextFlow,
            targets: updatedTargets,
        };
    }

    resolvePortDataType(flow: FlowDocument, nodeId: string, portIdOrLocalId: string): FlowPortDataType {
        const node = flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        const port = this.findPort([...node.inputPorts, ...node.outputPorts], portIdOrLocalId);
        if (!port) {
            throw new AgentError(`Flow port not found: ${nodeId}:${portIdOrLocalId}`);
        }

        if (port.direction === 'input' && port.dataType === 'any') {
            const incomingEdge = flow.edges.find(edge => edge.targetPortId === port.id);
            if (!incomingEdge) {
                return 'any';
            }

            const sourcePort = this.getPortById(flow, incomingEdge.sourcePortId);
            if (!sourcePort) {
                throw new AgentError(`Flow source port not found for edge: ${incomingEdge.id}`);
            }

            return sourcePort.dataType;
        }

        return port.dataType;
    }

    arePortTypesCompatible(sourceType: FlowPortDataType, targetType: FlowPortDataType): boolean {
        if (sourceType === targetType || sourceType === 'any' || targetType === 'any') {
            return true;
        }

        if ((sourceType === 'json' && targetType === 'text') || (sourceType === 'text' && targetType === 'json')) {
            return true;
        }

        if ((sourceType === 'json' && targetType === 'number') || (sourceType === 'number' && targetType === 'json')) {
            return true;
        }

        if ((sourceType === 'text' && targetType === 'number') || (sourceType === 'number' && targetType === 'text')) {
            return true;
        }

        if ((sourceType === 'image' && targetType === 'text') || (sourceType === 'text' && targetType === 'image')) {
            return true;
        }

        return false;
    }

    coercePacketForPort<TTargetType extends FlowPortDataType>(
        targetType: TTargetType,
        packet: FlowPacket,
    ): FlowPacket<FlowPacketValueMap[TTargetType]> {
        return {
            value: this.coercePacketValue(targetType, packet.value) as FlowPacketValueMap[TTargetType],
            ts: packet.ts,
        };
    }

    createPacket<TValue>(value: TValue, ts = now()): FlowPacket<TValue> {
        return {
            value,
            ts,
        };
    }

    getPortById(flow: FlowDocument, portId: string): FlowPort | undefined {
        for (const node of flow.nodes) {
            const match = [...node.inputPorts, ...node.outputPorts].find(port => port.id === portId);
            if (match) {
                return match;
            }
        }

        return undefined;
    }

    validateNode(flow: FlowDocument, nodeId: string): FlowNodeValidationResult {
        const node = flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        const block = flow.blocks.find(candidate => candidate.id === node.blockId);
        if (!block) {
            throw new AgentError(`Flow block not found for node: ${node.blockId}`);
        }

        const issues: FlowNodeValidationIssue[] = [];
        const configDefinitions = block.configs ?? [];
        const knownConfigIds = new Set(configDefinitions.map(config => config.id));

        for (const configId of Object.keys(node.config ?? {})) {
            if (!knownConfigIds.has(configId)) {
                issues.push({
                    code: 'unknown_config',
                    configId,
                    message: `Unknown config is stored on node ${node.id}: ${configId}`,
                });
            }
        }

        for (const definition of configDefinitions) {
            const value = node.config?.[definition.id];
            if (definition.required && (!value || !value.trim())) {
                issues.push({
                    code: 'missing_required_config',
                    configId: definition.id,
                    message: `Required config is missing on node ${node.id}: ${definition.id}`,
                });
            }
            if (definition.hint === 'select' && value && definition.options?.every(option => option.value !== value)) {
                issues.push({
                    code: 'invalid_select_option',
                    configId: definition.id,
                    message: `Config value is not one of the allowed options: ${definition.id}`,
                });
            }
        }

        return {
            isValid: issues.length === 0,
            issues,
        };
    }

    protected materializePort(nodeId: string, port: FlowBlockDefinition['inputs'][number]): FlowPort {
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

    protected buildNodeConfig(
        block: FlowBlockDefinition,
        providedConfig: Record<string, string> | undefined,
    ): Record<string, string> | undefined {
        const defaults = Object.fromEntries(
            (block.configs ?? [])
                .filter(config => config.defaultValue !== undefined)
                .map(config => [config.id, config.defaultValue!]),
        );
        const merged = {
            ...defaults,
            ...(providedConfig ?? {}),
        };

        return Object.keys(merged).length > 0 ? merged : undefined;
    }

    protected createNodeId(blockId: string, nodes: FlowNode[]): string {
        const prefix = `${blockId}-`;
        const maxNo = nodes
            .filter(node => node.id.startsWith(prefix))
            .map(node => Number(node.id.slice(prefix.length)))
            .filter(value => Number.isInteger(value) && value > 0)
            .reduce((max, value) => Math.max(max, value), 0);

        return `${blockId}-${maxNo + 1}`;
    }

    protected createEdgeId(sourcePort: FlowPort, targetPort: FlowPort): string {
        return `${sourcePort.id}->${targetPort.id}`;
    }

    protected findPort(ports: FlowPort[], portLocalIdOrGlobalId: string): FlowPort | undefined {
        return ports.find(port => port.localId === portLocalIdOrGlobalId || port.id === portLocalIdOrGlobalId);
    }

    protected updatePort(flow: FlowDocument, portId: string, patch: Partial<FlowPort>): FlowDocument {
        return {
            ...flow,
            nodes: flow.nodes.map(node => ({
                ...node,
                inputPorts: node.inputPorts.map(port => (port.id === portId ? { ...port, ...patch } : port)),
                outputPorts: node.outputPorts.map(port => (port.id === portId ? { ...port, ...patch } : port)),
            })),
        };
    }

    protected coercePacketValue(targetType: FlowPortDataType, value: unknown): unknown {
        if (value === null) {
            return null;
        }

        switch (targetType) {
            case 'any':
                return value;
            case 'text':
                return this.coerceToText(value);
            case 'json':
                return this.coerceToJson(value);
            case 'image':
                return this.coerceToImage(value);
            case 'number':
                return this.coerceToNumber(value);
            default:
                return value;
        }
    }

    protected coerceToText(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }

        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                throw new AgentError('Flow number packet must be a finite value to coerce into text');
            }
            return String(value);
        }

        return JSON.stringify(value);
    }

    protected coerceToJson(value: unknown): unknown {
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

    protected coerceToImage(value: unknown): FlowImageValue {
        if (typeof value === 'string') {
            return value;
        }

        throw new AgentError('Flow image packet must be a URL string or base64-encoded string');
    }

    protected coerceToNumber(value: unknown): number {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                throw new AgentError('Flow number packet must be a finite value');
            }

            return value;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                throw new AgentError('Flow text packet could not be parsed as a number');
            }

            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed)) {
                throw new AgentError('Flow text packet could not be parsed as a number');
            }

            return parsed;
        }

        throw new AgentError('Flow number packet must be a finite number or numeric string');
    }
}

/** Default production implementation for flow document rules. */
export class DefaultFlowDocumentController extends FlowDocumentController {}

const defaultFlowDocumentController = new DefaultFlowDocumentController();

/** Creates an empty flow document with optional initial block definitions. */
export function createFlowDocument(blocks: FlowBlockDefinition[] = []): FlowDocument {
    return defaultFlowDocumentController.createDocument(blocks);
}

/** Registers a new block definition in the flow document. */
export function registerFlowBlock(flow: FlowDocument, block: FlowBlockDefinition): FlowDocument {
    return defaultFlowDocumentController.registerBlock(flow, block);
}

/** Creates a node from a registered block definition and appends it to the flow document. */
export function createFlowNode(
    flow: FlowDocument,
    blockId: string,
    options: CreateFlowNodeOptions = {},
): { flow: FlowDocument; node: FlowNode } {
    return defaultFlowDocumentController.createNode(flow, blockId, options);
}

/** Connects one node output port to another node input port after validating compatibility. */
export function connectFlowPorts(
    flow: FlowDocument,
    options: ConnectFlowPortsOptions,
): { flow: FlowDocument; edge: FlowEdge } {
    return defaultFlowDocumentController.connectPorts(flow, options);
}

/** Writes a packet to a port while coercing it to the port's effective data type. */
export function setFlowPortPacket(
    flow: FlowDocument,
    options: SetFlowPortPacketOptions,
): { flow: FlowDocument; port: FlowPort } {
    return defaultFlowDocumentController.setPortPacket(flow, options);
}

/** Propagates one output port packet to all connected input ports. */
export function propagateFlowPortPacket(
    flow: FlowDocument,
    nodeId: string,
    portIdOrLocalId: string,
): { flow: FlowDocument; targets: FlowPort[] } {
    return defaultFlowDocumentController.propagatePortPacket(flow, nodeId, portIdOrLocalId);
}

/** Resolves the effective runtime type of a concrete port. */
export function resolveFlowPortDataType(flow: FlowDocument, nodeId: string, portIdOrLocalId: string): FlowPortDataType {
    return defaultFlowDocumentController.resolvePortDataType(flow, nodeId, portIdOrLocalId);
}

/** Returns whether two port types can be connected using the built-in coercion rules. */
export function arePortTypesCompatible(sourceType: FlowPortDataType, targetType: FlowPortDataType): boolean {
    return defaultFlowDocumentController.arePortTypesCompatible(sourceType, targetType);
}

/** Coerces a packet into the requested target type using the flow's built-in conversion rules. */
export function coercePacketForPort<TTargetType extends FlowPortDataType>(
    targetType: TTargetType,
    packet: FlowPacket,
): FlowPacket<FlowPacketValueMap[TTargetType]> {
    return defaultFlowDocumentController.coercePacketForPort(targetType, packet);
}

/** Creates a timestamped packet using the current clock. */
export function createFlowPacket<TValue>(value: TValue, ts = now()): FlowPacket<TValue> {
    return defaultFlowDocumentController.createPacket(value, ts);
}

/** Returns a concrete flow port by its global id. */
export function getFlowPortById(flow: FlowDocument, portId: string): FlowPort | undefined {
    return defaultFlowDocumentController.getPortById(flow, portId);
}

/** Validates one node against the config rules declared by its block definition. */
export function validateFlowNode(flow: FlowDocument, nodeId: string): FlowNodeValidationResult {
    return defaultFlowDocumentController.validateNode(flow, nodeId);
}
