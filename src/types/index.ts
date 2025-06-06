import * as THREE from 'three';

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
  definitionId: string; // ID linking to the AtomicNodeDefinition OR DefinitionDefinition
  x: number;
  y: number;
  isDefinitionInstance?: boolean; // Flag to differentiate instance types
  metadataValues?: Record<string, string | number | boolean>; // Values for metadata fields defined in AtomicNodeDefinition
  metadataVisibility?: Record<string, boolean>; // Visibility state for metadata fields
  // Add metadata values state later
}

// ---> NEW: Boundary Types
export interface BoundaryPort {
  id: string; // Unique ID, e.g., "boundary_port_123"
  x: number; // Position on the boundary circle (world coords)
  y: number;
  angle: number; // Angle on the circle (radians) - relative to positive x-axis
}

export type NodeOrBoundaryId = string | 'BOUNDARY';
export type PortIndexOrId = number | string; // Number for node port index, string for boundary port ID
// <--- END NEW

export interface WireConnection {
  id: string;
  sourceNodeId: NodeOrBoundaryId;     // Updated
  sourcePortIndex: PortIndexOrId;    // Updated
  targetNodeId: NodeOrBoundaryId;     // Updated
  targetPortIndex: PortIndexOrId;    // Updated
  targetLength?: number | null;
}

// Add and export DrawingWireState
// Represents the *intent* to draw a wire, starting from a specific port.
// Coordinates are no longer needed as the physics engine handles the connection.
// ^^^ REVERTING THIS: Coordinates *are* needed for visual feedback line
export interface DrawingWireState {
    sourceNodeId: NodeOrBoundaryId;    // Updated
    sourcePortIndex: PortIndexOrId;   // Updated
    // Coordinates for the visual line remain the same
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
  definitions: DefinitionDefinition[]; // Add definitions
  // Add other state properties here later (axioms, etc.)
}

export interface ExternalPort {
    id: string; // Corresponds to the original BoundaryPort ID
    angle: number; // Store the angle for consistent layout later
    isPrincipal: boolean; // Was the connected internal port principal?
}

export interface DefinitionDefinition {
    id: string;
    name: string;
    color: string;
    internalNodes: CanvasNodeInstance[]; // Nodes inside the definition
    internalWires: WireConnection[];   // Wires connecting internal nodes/ports
    externalPorts: ExternalPort[];     // Ports connecting to the outside world
} 