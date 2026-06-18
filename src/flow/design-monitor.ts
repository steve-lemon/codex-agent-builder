// Real-time monitoring primitives for flow design sessions.
import { AgentError } from '../errors/agent-error';
import { renderFlowDesignSnapshotAsReagraph, type FlowDesignReagraphGraph } from '../graph/renderer';
import { now } from '../tools/now';
import { DefaultFlowDocumentController } from './document';
import type {
    ConnectFlowPortsOptions,
    CreateFlowNodeOptions,
    FlowBlockDefinition,
    FlowDocument,
    FlowEdge,
    FlowNode,
} from './types';

/** Visual side hint for rendering an edge anchor on a node. */
export type FlowDesignAnchorSide = 'top' | 'right' | 'bottom' | 'left';

/** High-level node lifecycle phase exposed to design clients. */
export type FlowDesignNodePhase = 'staged' | 'created' | 'connected' | 'ready' | 'deleted';

/** Anchor metadata that helps clients render edge attachment points. */
export interface FlowDesignAnchor {
    portId: string;
    portLocalId?: string;
    side: FlowDesignAnchorSide;
    offset?: number;
}

/** Client-facing node model used by the live design stream. */
export interface FlowDesignGraphNode {
    id: string;
    label: string;
    blockId?: string;
    phase?: FlowDesignNodePhase;
    state?: string;
}

/** Client-facing edge model used by the live design stream. */
export interface FlowDesignGraphEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
    sourceAnchor?: FlowDesignAnchor;
    targetAnchor?: FlowDesignAnchor;
    flowHint?: 'horizontal' | 'vertical' | 'custom';
}

/** Snapshot sent with each monitoring event so clients can redraw incrementally. */
export interface FlowDesignGraphSnapshot {
    nodes: FlowDesignGraphNode[];
    edges: FlowDesignGraphEdge[];
}

/** One real-time design event delivered to observers. */
export interface FlowDesignEvent {
    sessionId: string;
    ts: number;
    type:
        | 'graph_started'
        | 'graph_cleared'
        | 'graph_completed'
        | 'node_staged'
        | 'node_created'
        | 'node_updated'
        | 'node_deleted'
        | 'node_phase_changed'
        | 'edge_created'
        | 'edge_deleted';
    message: string;
    snapshot: FlowDesignGraphSnapshot;
    reagraph: FlowDesignReagraphGraph;
    data?: Record<string, unknown>;

    // TODO(monitoring): Add optional diff metadata so clients can update large
    // graphs incrementally without reprocessing the full snapshot every time.
}

/** Connection contract used to forward live design events to any observer. */
export interface FlowDesignConnection {
    send(event: FlowDesignEvent): void;
    close?(): void | Promise<void>;
}

/** WebSocket-like transport abstraction used by the serialized connection. */
export interface FlowDesignTransport {
    send(payload: string): void | Promise<void>;
    close?(): void | Promise<void>;
}

/** Runtime configuration for a serialized flow-design WebSocket connection. */
export interface WebSocketFlowDesignConnectionConfig {
    serializer?: (event: FlowDesignEvent) => string;
}

const DEFAULT_CONNECTION_CONFIG: WebSocketFlowDesignConnectionConfig = {
    serializer: event => JSON.stringify(event),
};

/** WebSocket-oriented connection that serializes each design event for external clients. */
export class WebSocketFlowDesignConnection implements FlowDesignConnection {
    private readonly config: WebSocketFlowDesignConnectionConfig;

    constructor(
        private readonly transport: FlowDesignTransport,
        config: Partial<WebSocketFlowDesignConnectionConfig> = {},
    ) {
        this.config = {
            ...DEFAULT_CONNECTION_CONFIG,
            ...config,
        };
    }

    send(event: FlowDesignEvent): void {
        void this.transport.send(this.config.serializer!(event));
    }

    close(): void {
        void this.transport.close?.();
    }
}

/** Convenience callback adapter used by tests, UI controllers, or in-process observers. */
export class CallbackFlowDesignConnection implements FlowDesignConnection {
    constructor(private readonly callback: (event: FlowDesignEvent) => void) {}

    send(event: FlowDesignEvent): void {
        this.callback(event);
    }
}

/** Optional visual hints supplied when creating a live edge event. */
export interface FlowDesignEdgeVisual {
    sourceAnchor?: Partial<FlowDesignAnchor>;
    targetAnchor?: Partial<FlowDesignAnchor>;
    flowHint?: 'horizontal' | 'vertical' | 'custom';
}

interface FlowDesignNodeVisualState {
    phase?: FlowDesignNodePhase;
    state?: string;
}

/**
 * Mutable design session that mirrors flow mutations into live graph events.
 *
 * The session owns an in-memory flow document and emits snapshots for graph
 * start/reset/complete, node lifecycle changes, and edge mutations.
 */
export class FlowDesignSession {
    private readonly controller = new DefaultFlowDocumentController();
    private readonly nodeVisuals = new Map<string, FlowDesignNodeVisualState>();
    private readonly edgeVisuals = new Map<string, FlowDesignGraphEdge>();
    private flow: FlowDocument;
    private started = false;

    constructor(
        public readonly sessionId: string,
        blocks: FlowBlockDefinition[] = [],
        private readonly connection?: FlowDesignConnection,
    ) {
        this.flow = this.controller.createDocument(blocks);
    }

    getFlow(): FlowDocument {
        return this.flow;
    }

    start(data: Record<string, unknown> = {}): void {
        this.started = true;
        this.emit('graph_started', 'Flow design started.', data);
    }

    clear(data: Record<string, unknown> = {}): void {
        this.flow = this.controller.createDocument(this.flow.blocks);
        this.nodeVisuals.clear();
        this.edgeVisuals.clear();
        // TODO(monitoring): Preserve stable client-side layout hints across
        // clears/retries so graph UIs can animate resets more gracefully.
        this.emit('graph_cleared', 'Flow design graph cleared.', data);
    }

    complete(data: Record<string, unknown> = {}): void {
        this.emit('graph_completed', 'Flow design completed.', data);
        void this.connection?.close?.();
    }

    stageNode(nodeId: string, data: { label: string; blockId: string; state?: string }): void {
        this.nodeVisuals.set(nodeId, {
            phase: 'staged',
            state: data.state,
        });
        this.emit('node_staged', `Node staged: ${data.label}`, {
            node: {
                id: nodeId,
                label: data.label,
                blockId: data.blockId,
                phase: 'staged',
                state: data.state,
            },
        });
    }

    createNode(blockId: string, options: CreateFlowNodeOptions = {}): FlowNode {
        const created = this.controller.createNode(this.flow, blockId, options);
        this.flow = created.flow;
        const visual = this.nodeVisuals.get(created.node.id) ?? {};
        this.nodeVisuals.set(created.node.id, {
            ...visual,
            phase: 'created',
        });
        this.emit('node_created', `Node created: ${created.node.label}`, {
            node: {
                id: created.node.id,
                label: created.node.label,
                blockId: created.node.blockId,
                phase: 'created',
                state: visual.state,
            },
        });
        return created.node;
    }

    updateNode(nodeId: string, patch: Partial<Pick<FlowNode, 'label' | 'config'>> & { state?: string }): FlowNode {
        const node = this.flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        this.flow = {
            ...this.flow,
            nodes: this.flow.nodes.map(candidate =>
                candidate.id === nodeId
                    ? {
                          ...candidate,
                          ...(patch.label ? { label: patch.label } : {}),
                          ...(patch.config ? { config: patch.config } : {}),
                      }
                    : candidate,
            ),
        };

        const updated = this.flow.nodes.find(candidate => candidate.id === nodeId)!;
        const visual = this.nodeVisuals.get(nodeId) ?? {};
        this.nodeVisuals.set(nodeId, {
            ...visual,
            ...(patch.state ? { state: patch.state } : {}),
        });
        this.emit('node_updated', `Node updated: ${updated.label}`, {
            node: this.snapshotNode(updated),
        });
        return updated;
    }

    deleteNode(nodeId: string): void {
        const node = this.flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        const edgeIdsToDelete = this.flow.edges
            .filter(edge => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)
            .map(edge => edge.id);
        for (const edgeId of edgeIdsToDelete) {
            this.edgeVisuals.delete(edgeId);
        }

        this.flow = {
            ...this.flow,
            nodes: this.flow.nodes.filter(candidate => candidate.id !== nodeId),
            edges: this.flow.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
        };
        this.nodeVisuals.set(nodeId, { phase: 'deleted' });
        this.emit('node_deleted', `Node deleted: ${node.label}`, {
            node: {
                id: node.id,
                label: node.label,
                blockId: node.blockId,
                phase: 'deleted',
            },
        });
        this.nodeVisuals.delete(nodeId);
    }

    setNodePhase(nodeId: string, phase: FlowDesignNodePhase, state?: string): void {
        const node = this.flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        const visual = this.nodeVisuals.get(nodeId) ?? {};
        this.nodeVisuals.set(nodeId, {
            ...visual,
            phase,
            ...(state ? { state } : {}),
        });
        this.emit('node_phase_changed', `Node phase changed: ${node.label} -> ${phase}`, {
            node: this.snapshotNode(node),
        });
    }

    connectPorts(options: ConnectFlowPortsOptions, visual: FlowDesignEdgeVisual = {}): FlowEdge {
        const created = this.controller.connectPorts(this.flow, options);
        this.flow = created.flow;
        const sourcePortLocalId = created.edge.sourcePortId.split(':').slice(1).join(':');
        const targetPortLocalId = created.edge.targetPortId.split(':').slice(1).join(':');
        this.edgeVisuals.set(created.edge.id, {
            id: created.edge.id,
            source: created.edge.sourceNodeId,
            target: created.edge.targetNodeId,
            label: created.edge.label,
            flowHint: visual.flowHint ?? 'horizontal',
            sourceAnchor: {
                side: 'right',
                offset: 0.5,
                portId: created.edge.sourcePortId,
                portLocalId: sourcePortLocalId,
                ...visual.sourceAnchor,
            },
            targetAnchor: {
                side: 'left',
                offset: 0.5,
                portId: created.edge.targetPortId,
                portLocalId: targetPortLocalId,
                ...visual.targetAnchor,
            },
        });

        // TODO(monitoring): Support curved-path or routing hints once clients
        // need to distinguish overlapping edges in denser designs.
        this.emit('edge_created', `Edge created: ${created.edge.sourceNodeId} -> ${created.edge.targetNodeId}`, {
            edge: this.edgeVisuals.get(created.edge.id),
        });
        return created.edge;
    }

    deleteEdge(edgeId: string): void {
        const edge = this.flow.edges.find(candidate => candidate.id === edgeId);
        if (!edge) {
            throw new AgentError(`Flow edge not found: ${edgeId}`);
        }

        this.flow = {
            ...this.flow,
            edges: this.flow.edges.filter(candidate => candidate.id !== edgeId),
        };
        const snapshot = this.edgeVisuals.get(edgeId) ?? {
            id: edge.id,
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            label: edge.label,
        };
        this.edgeVisuals.delete(edgeId);
        this.emit('edge_deleted', `Edge deleted: ${edge.sourceNodeId} -> ${edge.targetNodeId}`, {
            edge: snapshot,
        });
    }

    private emit(type: FlowDesignEvent['type'], message: string, data: Record<string, unknown> = {}): void {
        if (!this.started && type !== 'graph_started') {
            this.start();
        }

        this.connection?.send({
            sessionId: this.sessionId,
            ts: now(),
            type,
            message,
            snapshot: {
                nodes: this.flow.nodes.map(node => this.snapshotNode(node)),
                edges: this.flow.edges.map(edge => this.snapshotEdge(edge)),
            },
            reagraph: renderFlowDesignSnapshotAsReagraph({
                nodes: this.flow.nodes.map(node => this.snapshotNode(node)),
                edges: this.flow.edges.map(edge => this.snapshotEdge(edge)),
            }),
            data,
        });
    }

    private snapshotNode(node: FlowNode): FlowDesignGraphNode {
        const visual = this.nodeVisuals.get(node.id) ?? {};
        return {
            id: node.id,
            label: node.label,
            blockId: node.blockId,
            phase: visual.phase,
            state: visual.state,
        };
    }

    private snapshotEdge(edge: FlowEdge): FlowDesignGraphEdge {
        return (
            this.edgeVisuals.get(edge.id) ?? {
                id: edge.id,
                source: edge.sourceNodeId,
                target: edge.targetNodeId,
                label: edge.label,
                flowHint: 'horizontal',
            }
        );
    }
}
