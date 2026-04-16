// Flow design types for blocks, nodes, ports, and connections.

/**
 * Supported payload types that may travel through flow ports.
 *
 * `any` acts as a permissive type that may connect to or from any other port
 * type when a block intentionally supports mixed payloads.
 */
export type FlowPortDataType = 'text' | 'json' | 'image' | 'number' | 'any';

/** String payload used for image ports. It may contain a URL or base64-encoded image data. */
export type FlowImageValue = string;

/** Runtime payload map keyed by flow port data type. */
export interface FlowPacketValueMap {
    text: string | null;
    json: unknown | null;
    image: FlowImageValue | null;
    number: number | null;
    any: unknown | null;
}

/** Timestamped value carried through a flow port. */
export interface FlowPacket<TValue = unknown> {
    /** Payload value carried by the packet. */
    value: TValue | null;

    /** Unix timestamp in milliseconds when the packet was last written. */
    ts: number;

    // TODO(flow): Add packet-level metadata for provenance, schema versioning,
    // and partial execution diagnostics once packets move across process boundaries.
}

/** String-safe packet representation intended for database storage. */
export interface SerializedFlowPacket {
    /** Declared runtime type of the original packet. */
    dataType: FlowPortDataType;

    /** Unix timestamp in milliseconds when the packet was last written. */
    ts: number;

    /** Storage encoding used for the serialized value. */
    encoding: 'string' | 'json' | 'null';

    /** Serialized payload value. */
    value: string;
}

/** Direction of data travel relative to a node. */
export type FlowPortDirection = 'input' | 'output';

/** Editor hint describing how a config field should be presented. */
export type FlowConfigHintKind = 'text' | 'select' | 'checkbox' | 'number';

/** One option for a select-style config field. */
export interface FlowConfigOption {
    /** Stable stored string value for the option. */
    value: string;

    /** Human-friendly label shown in editors. */
    label: string;
}

/** Config field definition declared by a block. */
export interface FlowBlockConfigDefinition {
    /** Stable config id unique within the block definition. */
    id: string;

    /** Human-friendly label shown in editors and inspectors. */
    label: string;

    /** Optional free-form description for UI help text. */
    description?: string;

    /** Presentation hint for the editor UI. */
    hint: FlowConfigHintKind;

    /** Optional select options used when `hint === 'select'`. */
    options?: FlowConfigOption[];

    /** Whether the node must provide a non-empty string value for this config entry. */
    required?: boolean;

    /** Optional default string value stored on newly created nodes. */
    defaultValue?: string;
}

/**
 * Defines one port on a reusable block template.
 *
 * Block definitions describe ports abstractly. Concrete node ports are
 * materialized from these templates when a node is created from a block.
 */
export interface FlowBlockPortDefinition {
    /** Stable local id unique within the owning block definition across both inputs and outputs. */
    localId: string;

    /** Human-friendly label shown in editors and inspectors. */
    label: string;

    /** Direction of the port on the block template. */
    direction: FlowPortDirection;

    /** Payload type accepted or emitted by the port. */
    dataType: FlowPortDataType;

    /** Optional free-form description for UI help text. */
    description?: string;
}

/**
 * Reusable block definition that explains how nodes based on the block behave.
 *
 * A block is the authoring-time unit used by the flow designer. Users can
 * create many nodes from the same block definition.
 */
export interface FlowBlockDefinition {
    /** Stable block id used when instantiating nodes. */
    id: string;

    /** Human-friendly block name shown in a palette or inspector. */
    label: string;

    /** Optional short description of the block's behavior. */
    description?: string;

    /** Optional preferred node-configuration strategy id for sub-agent orchestration. */
    nodeConfigStrategyId?: string;

    // TODO(flow): Let blocks optionally advertise multiple compatible strategy
    // ids or capability tags once node configuration needs layered behavior
    // such as prompt shaping + provider policy + output schema control.

    /** Config field definitions supported by nodes created from this block. */
    configs?: FlowBlockConfigDefinition[];

    /** Input port templates applied to all nodes created from this block. */
    inputs: FlowBlockPortDefinition[];

    /** Output port templates applied to all nodes created from this block. */
    outputs: FlowBlockPortDefinition[];

    // TODO(flow): Add optional block-level execution metadata such as timeout,
    // retry policy, and sandbox requirements when real production runtimes are wired in.
}

/**
 * Concrete port that belongs to a node instance.
 *
 * Ports are the actual endpoints that edges connect to in a flow graph.
 */
export interface FlowPort {
    /** Stable port id unique within the flow document. */
    id: string;

    /** Id of the node that owns this port. */
    nodeId: string;

    /** Stable local id copied from the originating block definition. */
    localId: string;

    /** Human-friendly label shown in editors. */
    label: string;

    /** Direction of the port relative to the node. */
    direction: FlowPortDirection;

    /** Payload type accepted or emitted by the port. */
    dataType: FlowPortDataType;

    /** Optional packet currently stored on the port. */
    packet?: FlowPacket;

    /** Optional free-form description for UI help text. */
    description?: string;
}

/**
 * Concrete node created from a block definition.
 *
 * Nodes carry the block id they were instantiated from together with the
 * materialized input and output ports derived from the block definition.
 */
export interface FlowNode {
    /** Stable node id unique within the flow document. */
    id: string;

    /** Block definition id used to create the node. */
    blockId: string;

    /** Human-friendly label shown in editors and graph views. */
    label: string;

    /** Input ports materialized from the block definition. */
    inputPorts: FlowPort[];

    /** Output ports materialized from the block definition. */
    outputPorts: FlowPort[];

    /** Per-node configuration payload stored as string values keyed by config id. */
    config?: Record<string, string>;

    // TODO(flow): Persist node-level runtime status and validation snapshots so
    // editors can resume incomplete runs and surface execution history.
}

/**
 * Directed connection between one output port and one input port.
 *
 * Edges describe the allowed data flow through the graph.
 */
export interface FlowEdge {
    /** Stable edge id unique within the flow document. */
    id: string;

    /** Source node id. */
    sourceNodeId: string;

    /** Source output port id. */
    sourcePortId: string;

    /** Target node id. */
    targetNodeId: string;

    /** Target input port id. */
    targetPortId: string;

    /** Optional human-friendly label for the connection. */
    label?: string;
}

/** In-memory flow document used by the editor and future execution layers. */
export interface FlowDocument {
    /** Registered block definitions available to the flow. */
    blocks: FlowBlockDefinition[];

    /** Nodes currently placed in the flow graph. */
    nodes: FlowNode[];

    /** Directed port-to-port connections. */
    edges: FlowEdge[];

    // TODO(flow): Introduce a document version and migration contract before
    // flow documents are stored long-term or exchanged with external services.
}

/** Options used when creating a node from a block definition. */
export interface CreateFlowNodeOptions {
    /** Optional explicit node id. When omitted, a deterministic id is generated. */
    nodeId?: string;

    /** Optional custom label for the node instance. */
    label?: string;

    /** Optional per-node configuration payload stored as string values. */
    config?: Record<string, string>;
}

/** Options used when connecting two flow ports. */
export interface ConnectFlowPortsOptions {
    /** Source node id. */
    sourceNodeId: string;

    /** Source output port local id or global id. */
    sourcePort: string;

    /** Target node id. */
    targetNodeId: string;

    /** Target input port local id or global id. */
    targetPort: string;

    /** Optional explicit edge id. When omitted, a deterministic id is generated. */
    edgeId?: string;

    /** Optional connection label. */
    label?: string;
}

/** Options used when writing a packet to a concrete flow port. */
export interface SetFlowPortPacketOptions {
    /** Target node id. */
    nodeId: string;

    /** Target port local id or global id. */
    port: string;

    /** Packet to write to the port after any required coercion. */
    packet: FlowPacket;
}

/** One validation issue discovered while checking a node against its block spec. */
export interface FlowNodeValidationIssue {
    /** Stable machine-readable issue code. */
    code: 'missing_required_config' | 'unknown_config' | 'invalid_select_option';

    /** Config id related to the issue when applicable. */
    configId?: string;

    /** Human-friendly explanation of the issue. */
    message: string;
}

/** Validation result for a node created from a block definition. */
export interface FlowNodeValidationResult {
    /** Whether the node currently satisfies the block's config requirements. */
    isValid: boolean;

    /** Validation issues discovered for the node. */
    issues: FlowNodeValidationIssue[];
}
