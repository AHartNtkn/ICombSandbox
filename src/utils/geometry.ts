import * as THREE from 'three';
import { AtomicNodeDefinition, DefinitionDefinition } from '../types';

// --- Constants (should match PhysicsNode) ---
const NODE_RADIUS = 1.15;
// --- ---

/**
 * Calculates the local offset vector for a port on the node's boundary circle.
 * @param definition The node definition containing port counts.
 * @param portIndex The index of the port.
 * @returns A THREE.Vector3 representing the local offset from the node center.
 */
export const getPortBoundaryLocalOffset = (
    definition: AtomicNodeDefinition | DefinitionDefinition, 
    portIndex: number
): THREE.Vector3 => {

    // Handle Atomic Nodes (original logic)
    if ('principalPorts' in definition) { 
        const totalPorts = definition.principalPorts + definition.nonPrincipalPorts;
        if (totalPorts === 0) return new THREE.Vector3(0, 0, 0); // Avoid division by zero

        const angleStep = 360 / totalPorts;
        // Start angle adjusted to match PhysicsNode visual port layout (top is 90 degrees)
        const angle = 90 + portIndex * angleStep;
        const angleRad = angle * (Math.PI / 180);

        // Position directly on the boundary circle
        const localX = NODE_RADIUS * Math.cos(angleRad);
        const localY = NODE_RADIUS * Math.sin(angleRad);
        return new THREE.Vector3(localX, localY, 0);
    } 
    // Handle Definition Nodes
    else if ('externalPorts' in definition) {
        if (portIndex < 0 || portIndex >= definition.externalPorts.length) {
            console.error(`Invalid port index ${portIndex} for definition ${definition.name}`);
            return new THREE.Vector3(0, 0, 0); // Return zero vector on error
        }
        // Use the pre-calculated angle from the sorted externalPorts array
        // IMPORTANT: Assumes externalPorts is sorted by angle!
        const angleRad = definition.externalPorts[portIndex].angle;

        // Position directly on the boundary circle using the stored angle
        const localX = NODE_RADIUS * Math.cos(angleRad);
        const localY = NODE_RADIUS * Math.sin(angleRad);
        return new THREE.Vector3(localX, localY, 0);
    }
    // Fallback for unknown type (shouldn't happen with TypeScript)
    else {
        console.error("Unknown definition type passed to getPortBoundaryLocalOffset");
        return new THREE.Vector3(0, 0, 0);
    }
}; 