// Executable flow node runtime classes for sample blocks.
import { AgentError } from '../errors/agent-error';
import { DefaultFlowDocumentController, FlowDocumentController } from './document';
import type { FlowBlockDefinition, FlowDocument, FlowNode, FlowPacket, FlowPort } from './types';

/** Runtime services shared by executable flow nodes. */
export interface FlowNodeExecutionServices {
    /** Flow controller used to mutate documents and packets. */
    controller?: FlowDocumentController;

    /** Logger used by view-style nodes. */
    logger?: (message: string) => void;

    /** Sleep function used by time-based nodes. */
    sleep?: (ms: number) => Promise<void>;
}

/** Default runtime services used when the caller does not provide overrides. */
export const defaultFlowNodeExecutionServices: Required<FlowNodeExecutionServices> = {
    controller: new DefaultFlowDocumentController(),
    logger: message => {
        console.log(message);
    },
    sleep: async (ms: number) => {
        await new Promise(resolve => setTimeout(resolve, ms));
    },
};

/**
 * Base executable flow node.
 *
 * Subclasses implement `execute()` while reusing shared helpers for config
 * access, packet lookup, validation, and output propagation.
 */
export abstract class ExecutableFlowNode {
    protected readonly controller: FlowDocumentController;
    protected readonly logger: (message: string) => void;
    protected readonly sleep: (ms: number) => Promise<void>;

    constructor(
        readonly node: FlowNode,
        readonly block: FlowBlockDefinition,
        services: FlowNodeExecutionServices = {},
    ) {
        this.controller = services.controller ?? defaultFlowNodeExecutionServices.controller;
        this.logger = services.logger ?? defaultFlowNodeExecutionServices.logger;
        this.sleep = services.sleep ?? defaultFlowNodeExecutionServices.sleep;
    }

    /** Executes the node and returns the updated flow document. */
    abstract execute(flow: FlowDocument): Promise<FlowDocument>;

    protected ensureValid(flow: FlowDocument): void {
        const result = this.controller.validateNode(flow, this.node.id);
        if (!result.isValid) {
            throw new AgentError(`Flow node is invalid and cannot execute: ${this.node.id}`, {
                cause: result.issues,
            });
        }
    }

    protected getRequiredConfig(configId: string): string {
        const value = this.node.config?.[configId];
        if (!value || !value.trim()) {
            throw new AgentError(`Required config is missing on node ${this.node.id}: ${configId}`);
        }

        return value;
    }

    protected getInputPort(localId: string): FlowPort {
        const port = this.node.inputPorts.find(candidate => candidate.localId === localId);
        if (!port) {
            throw new AgentError(`Input port not found on node ${this.node.id}: ${localId}`);
        }

        return port;
    }

    protected getOutputPort(localId: string): FlowPort {
        const port = this.node.outputPorts.find(candidate => candidate.localId === localId);
        if (!port) {
            throw new AgentError(`Output port not found on node ${this.node.id}: ${localId}`);
        }

        return port;
    }

    protected requireInputPacket(flow: FlowDocument, localId: string): FlowPacket {
        const packet = this.controller.getPortById(flow, this.getInputPort(localId).id)?.packet;
        if (packet === undefined) {
            throw new AgentError(`Input packet is missing on node ${this.node.id}:${localId}`);
        }

        return packet;
    }

    protected writeOutputPacket(flow: FlowDocument, localId: string, packet: FlowPacket): FlowDocument {
        const written = this.controller.setPortPacket(flow, {
            nodeId: this.node.id,
            port: localId,
            packet,
        });

        return this.controller.propagatePortPacket(written.flow, this.node.id, localId).flow;
    }

    protected formatPacketValue(packet: FlowPacket): string {
        if (packet.value === null) {
            return 'null';
        }
        if (typeof packet.value === 'string') {
            return packet.value;
        }

        return JSON.stringify(packet.value);
    }
}

/** Executable node for the sample input block. */
export class InputExecutableFlowNode extends ExecutableFlowNode {
    override async execute(flow: FlowDocument): Promise<FlowDocument> {
        this.ensureValid(flow);
        const input = this.getRequiredConfig('input');

        return this.writeOutputPacket(flow, 'output', this.controller.createPacket(input));
    }
}

/** Executable node for the sample buffer block. */
export class BufferExecutableFlowNode extends ExecutableFlowNode {
    override async execute(flow: FlowDocument): Promise<FlowDocument> {
        this.ensureValid(flow);
        const wait = Number(this.getRequiredConfig('wait'));
        if (!Number.isFinite(wait) || wait < 0) {
            throw new AgentError(`Buffer wait config must be a non-negative number: ${this.node.id}`);
        }

        await this.sleep(wait);
        const packet = this.requireInputPacket(flow, 'input');
        return this.writeOutputPacket(flow, 'output', packet);
    }
}

/** Executable node for the sample view block. */
export class ViewExecutableFlowNode extends ExecutableFlowNode {
    override async execute(flow: FlowDocument): Promise<FlowDocument> {
        this.ensureValid(flow);
        const packet = this.requireInputPacket(flow, 'input');
        this.logger(this.formatPacketValue(packet));
        return flow;
    }
}

/**
 * Base factory for turning flow nodes into executable runtime objects.
 *
 * Subclasses can add new block ids or override the mapping strategy while
 * keeping the high-level `create()` contract stable.
 */
export abstract class ExecutableFlowNodeFactory {
    protected readonly controller: FlowDocumentController;
    protected readonly logger: (message: string) => void;
    protected readonly sleep: (ms: number) => Promise<void>;

    constructor(services: FlowNodeExecutionServices = {}) {
        this.controller = services.controller ?? defaultFlowNodeExecutionServices.controller;
        this.logger = services.logger ?? defaultFlowNodeExecutionServices.logger;
        this.sleep = services.sleep ?? defaultFlowNodeExecutionServices.sleep;
    }

    create(flow: FlowDocument, nodeId: string): ExecutableFlowNode {
        const node = flow.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new AgentError(`Flow node not found: ${nodeId}`);
        }

        const block = flow.blocks.find(candidate => candidate.id === node.blockId);
        if (!block) {
            throw new AgentError(`Flow block not found for node: ${node.blockId}`);
        }

        return this.createNodeRuntime(node, block);
    }

    protected abstract createNodeRuntime(node: FlowNode, block: FlowBlockDefinition): ExecutableFlowNode;
}

/** Default factory that supports the built-in sample executable blocks. */
export class DefaultExecutableFlowNodeFactory extends ExecutableFlowNodeFactory {
    protected override createNodeRuntime(node: FlowNode, block: FlowBlockDefinition): ExecutableFlowNode {
        const services = {
            controller: this.controller,
            logger: this.logger,
            sleep: this.sleep,
        };

        switch (block.id) {
            case 'input':
                return new InputExecutableFlowNode(node, block, services);
            case 'buffer':
                return new BufferExecutableFlowNode(node, block, services);
            case 'view':
                return new ViewExecutableFlowNode(node, block, services);
            default:
                throw new AgentError(`No executable flow node runtime is registered for block: ${block.id}`);
        }
    }
}
