export interface AtomicNodeDefinition {
  id: string; // Unique ID for the definition
  name: string;
  color: string;
  principalPorts: number;
  nonPrincipalPorts: number;
  metadataSchema: string[]; // Array of metadata field names
}

export interface CanvasNodeInstance {
  instanceId: string; // Unique ID for this specific instance on canvas
  definitionId: string; // ID linking to the AtomicNodeDefinition
  x: number;
  y: number;
  // Add metadata values state later
}

export interface WireConnection {
  id: string;
  sourceNodeId: string;
  sourcePortIndex: number;
  targetNodeId: string;
  targetPortIndex: number;
  targetLength?: number | null; // Add optional target length
}

// Add and export DrawingWireState
// Represents the *intent* to draw a wire, starting from a specific port.
// Coordinates are no longer needed as the physics engine handles the connection.
// ^^^ REVERTING THIS: Coordinates *are* needed for visual feedback line
export interface DrawingWireState {
    sourceNodeId: string;
    sourcePortIndex: number;
    // Add back coordinates needed for the temporary drawing line
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}

export interface WorkspaceData {
  title: string;
  atomicNodes: AtomicNodeDefinition[];
  canvasNodes: CanvasNodeInstance[]; // Add canvas nodes
  wires: WireConnection[]; // Add wires array
  // Add other state properties here later (definitions, axioms, etc.)
} 