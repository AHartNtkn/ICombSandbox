import React, { useRef, useMemo, useCallback, useEffect } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { RigidBody, RapierRigidBody } from '@react-three/rapier';
import { BoundaryPort, NodeOrBoundaryId, PortIndexOrId, WireConnection } from '../types';
import Port from './Port';

// --- Constants ---
// Removed fixed BOUNDARY_RADIUS
const BOUNDARY_SEGMENTS = 64;
const BOUNDARY_COLOR = "#888";
const PORT_VISUAL_RADIUS = 0.15;
const PORT_COLOR = "#55f";
const PORT_HOVER_COLOR = "#aaf";
const PORT_PHYSICS_RADIUS = 0.01; // Tiny radius for anchor point
const PORT_LINE_RADIUS = 0.05;
const PORT_LENGTH = 0.5;
const PORT_DOT_RADIUS = 0.1;

interface BoundaryProps {
  ports: BoundaryPort[];
  wires: WireConnection[];
  onBoundaryClick: (event: ThreeEvent<MouseEvent>, radius: number) => void;
  onPortPointerDown?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, worldPos: THREE.Vector3, event: ThreeEvent<PointerEvent>) => void;
  onPortPointerEnter?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => void;
  onPortPointerLeave?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => void;
  onPortContextMenu?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<MouseEvent>) => void;
  cameraZoom: number;
  registerPortBodyRef: (portId: string, ref: React.RefObject<RapierRigidBody | null>) => void;
  unregisterPortBodyRef: (portId: string) => void;
}

const Boundary: React.FC<BoundaryProps> = ({
  ports,
  wires,
  onBoundaryClick,
  onPortPointerDown,
  onPortPointerEnter,
  onPortPointerLeave,
  onPortContextMenu,
  cameraZoom,
  registerPortBodyRef,
  unregisterPortBodyRef,
}) => {
  const { size } = useThree(); // Access viewport size

  // --- Calculate Dynamic Radius based on zoom and viewport size ---
  const dynamicRadius = useMemo(() => {
    const worldHeight = size.height / cameraZoom;
    const worldWidth = size.width / cameraZoom;
    // Use the smaller dimension to determine the radius
    return Math.min(worldWidth, worldHeight) / 2;
  }, [size.width, size.height, cameraZoom]);

  // --- Boundary Circle (Uses dynamicRadius) --- 
  const boundaryCirclePoints = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= BOUNDARY_SEGMENTS; i++) {
      const angle = (i / BOUNDARY_SEGMENTS) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * dynamicRadius, Math.sin(angle) * dynamicRadius, 0));
    }
    return points;
  }, [dynamicRadius]); // Dependency updated

  // --- Event Handlers (Boundary specific) ---
  const handleBoundaryClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // Pass event AND the current dynamicRadius up
    onBoundaryClick(event, dynamicRadius);
  }, [onBoundaryClick, dynamicRadius]);

  // --- Physics Body Refs Management ---
  // Store refs locally within the Boundary component
  // Allow null in ref type for initialization
  const portBodyRefs = useRef<Map<string, React.RefObject<RapierRigidBody | null>>>(new Map());

  // Ensure refs are created/updated when ports change
  ports.forEach(port => {
      if (!portBodyRefs.current.has(port.id)) {
          portBodyRefs.current.set(port.id, React.createRef<RapierRigidBody>());
      }
  });

  // Register refs with parent (CanvasArea) when they are created/updated
  useEffect(() => {
    portBodyRefs.current.forEach((ref, portId) => {
        registerPortBodyRef(portId, ref);
    });
    // Cleanup: Unregister refs for ports that no longer exist
    const currentPortIds = new Set(ports.map(p => p.id));
    portBodyRefs.current.forEach((_, portId) => {
        if (!currentPortIds.has(portId)) {
            unregisterPortBodyRef(portId);
            portBodyRefs.current.delete(portId); // Remove from local map
        }
    });
  // Re-run when ports array changes or handlers change
  }, [ports, registerPortBodyRef, unregisterPortBodyRef]);

  return (
    <group> 
      {/* Boundary Circle Mesh (use dynamicRadius for hit area) */}
      <mesh onClick={handleBoundaryClick} visible={false}> 
        {/* Adjust hit area based on dynamic radius */}
        <ringGeometry args={[dynamicRadius - 0.5, dynamicRadius + 0.5, BOUNDARY_SEGMENTS]} />
        <meshBasicMaterial side={THREE.DoubleSide} />
      </mesh>

      {/* Dashed Line Visual (uses dynamicRadius via points) */}
      <Line
        points={boundaryCirclePoints}
        color={BOUNDARY_COLOR}
        lineWidth={1}
        dashed={true}
        dashScale={10} // Adjust scale based on radius? Maybe not needed.
        gapSize={5}
      />

      {/* Render Ports with Physics Bodies */}
      {ports.map((port) => {
        const bodyRef = portBodyRefs.current.get(port.id)!;

        // Calculate if this specific port is connected
        const isPortConnected = wires.some(w =>
          (w.sourceNodeId === 'BOUNDARY' && w.sourcePortIndex === port.id) ||
          (w.targetNodeId === 'BOUNDARY' && w.targetPortIndex === port.id)
        );

        return (
          // Group for visual and physics body
          <group key={port.id}>
            {/* Fixed RigidBody to act as anchor */}
            <RigidBody
              ref={bodyRef} // Assign the ref
              type="fixed" // Make it static
              position={[port.x, port.y, 0]} // Position from port data
              colliders="ball" // Use a small ball collider
              args={[PORT_PHYSICS_RADIUS]} // Pass radius arg
              canSleep={false} // Keep it awake? Maybe not needed for fixed.
            >
              {/* Optional: Small visual mesh for debugging the anchor */}
              {/* <mesh visible={false}> 
                <sphereGeometry args={[PORT_PHYSICS_RADIUS, 8, 8]} />
                <meshBasicMaterial color="red" />
              </mesh> */}
            </RigidBody>

            {/* Render Generic Port Component */}
            <Port
              key={`${port.id}-port`}
              ownerId="BOUNDARY"
              portIdOrIndex={port.id}
              position={new THREE.Vector3(port.x, port.y, 0)} // Base position on the circle edge
              rotation={new THREE.Euler(0, 0, port.angle + Math.PI /2, 'XYZ')} // Point inwards (towards origin)
              length={PORT_LENGTH}
              lineRadius={PORT_LINE_RADIUS}
              dotRadius={PORT_DOT_RADIUS}
              isConnected={isPortConnected}
              isPrincipal={false} // Boundary ports are never principal
              // Pass unified handlers
              onPointerDown={onPortPointerDown}
              onPointerEnter={onPortPointerEnter}
              onPointerLeave={onPortPointerLeave}
              onContextMenu={onPortContextMenu}
            />
          </group>
        );
      })}
    </group>
  );
};

export default Boundary;
