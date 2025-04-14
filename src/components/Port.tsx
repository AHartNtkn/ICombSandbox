import React, { useState, useCallback, useMemo } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Cylinder, Sphere } from '@react-three/drei'; // Use Cylinder for line, Sphere for dot
import { NodeOrBoundaryId, PortIndexOrId } from '../types';

// Default visual properties
const DEFAULT_PORT_LINE_RADIUS = 0.05;
const DEFAULT_PORT_LENGTH = 0.5; // Default length if not provided
const DEFAULT_DOT_RADIUS = 0.1;
const PORT_CYLINDER_COLOR = "#ccc"; // Consistent grey for the line
const DEFAULT_DOT_COLOR = "#888"; // Default for non-principal node dots
const HOVER_COLOR = "yellow"; // Hover color for cylinder (matches physics wires)
const PRINCIPAL_DOT_COLOR = "#000";
const BOUNDARY_DOT_COLOR = "#55f"; // Example color for boundary dots

export interface PortProps {
  ownerId: NodeOrBoundaryId;
  portIdOrIndex: PortIndexOrId;
  position: THREE.Vector3; // Base position (on node/boundary edge)
  rotation: THREE.Euler;   // Rotation of the line segment (Euler YXZ order usually works for Z-up)
  length?: number;
  lineRadius?: number;
  dotRadius?: number; // Corrected prop name for the end dot
  isConnected: boolean;
  isPrincipal?: boolean; // Optional: For node ports
  // Callbacks
  onPointerDown?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, worldPos: THREE.Vector3, event: ThreeEvent<PointerEvent>) => void;
  onPointerEnter?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => void;
  onPointerLeave?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => void;
  onContextMenu?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<MouseEvent>) => void;
}

const Port: React.FC<PortProps> = ({
  ownerId,
  portIdOrIndex,
  position,
  rotation,
  length = DEFAULT_PORT_LENGTH,
  lineRadius = DEFAULT_PORT_LINE_RADIUS,
  dotRadius = DEFAULT_DOT_RADIUS, // Corrected prop name for destructuring
  isConnected,
  isPrincipal = false, // Default to false
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onContextMenu,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation(); // Prevent events on parent (node/boundary)
    // Get world position directly from the event object if possible,
    // or use the passed position prop as a fallback.
    const worldPos = event.point || position;
    onPointerDown?.(ownerId, portIdOrIndex, worldPos, event);
  }, [onPointerDown, ownerId, portIdOrIndex, position]);

  const handlePointerEnter = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!isConnected) { // Only show hover if not connected
        setIsHovered(true);
        onPointerEnter?.(ownerId, portIdOrIndex, event);
        document.body.style.cursor = 'pointer';
    }
  }, [onPointerEnter, ownerId, portIdOrIndex, isConnected]);

  const handlePointerLeave = useCallback((event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!isConnected) {
        setIsHovered(false);
        onPointerLeave?.(ownerId, portIdOrIndex, event);
        document.body.style.cursor = 'auto';
    }
  }, [onPointerLeave, ownerId, portIdOrIndex, isConnected]);

  const handleContextMenu = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    onContextMenu?.(ownerId, portIdOrIndex, event);
  }, [onContextMenu, ownerId, portIdOrIndex]);

  // Determine dot color based on state and type
  const dotColor = isPrincipal 
          ? PRINCIPAL_DOT_COLOR 
          : (ownerId === 'BOUNDARY' ? BOUNDARY_DOT_COLOR : DEFAULT_DOT_COLOR);

  // Determine cylinder color based on hover state
  const cylinderColor = isHovered ? HOVER_COLOR : PORT_CYLINDER_COLOR;

  return (
    <group position={position} rotation={rotation}> 
      {/* Base Dot (Sphere) */}
      <Sphere
        args={[dotRadius, 16, 16]}
        position={[0, 0, 0.01]} // At the group origin, slightly offset Z
        // Events likely shouldn't trigger on the dot itself, but on the cylinder
      >
        <meshStandardMaterial color={dotColor} roughness={0.4} metalness={0.1} />
      </Sphere>

      {/* Dangling Line (Cylinder) - Only render if NOT connected */} 
      {!isConnected && (
        <Cylinder
          args={[lineRadius, lineRadius, length, 8]}
          position={[0, length / 2, 0]} // Position relative to the group origin (centered along local Y)
          // No extra rotation needed, group handles orientation
          // Event handlers attached here
          onPointerDown={handlePointerDown}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
        >
          <meshStandardMaterial color={cylinderColor} roughness={0.6} metalness={0.2} />
        </Cylinder>
      )}
    </group>
  );
};

export default Port; 