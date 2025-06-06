import React, { useRef, useState, useEffect, useMemo, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useFrame, ThreeEvent, useThree } from '@react-three/fiber';
import {
  RigidBody,
  BallCollider,
  RapierRigidBody,
  useRapier,
  interactionGroups,
} from '@react-three/rapier';
import * as THREE from 'three';
import { Billboard, Text } from "@react-three/drei";
import { AtomicNodeDefinition, CanvasNodeInstance, WireConnection, NodeOrBoundaryId, PortIndexOrId, DefinitionDefinition } from '../types';
import RAPIER from '@dimforge/rapier3d-compat';
import Port from './Port';
import { getPortBoundaryLocalOffset } from '../utils/geometry'; // Import the geometry util

// --- Constants for Visuals ---
const NODE_RADIUS = 1.15;
const PORT_LINE_LENGTH = 0.5;
const PORT_LINE_RADIUS = 0.05;
const PRINCIPAL_MARKER_RADIUS = 0.1;
const LABEL_FONT_SIZE = 0.4;
// --- ---

// --- Collision Groups ---
export const NODE_GROUP = interactionGroups(1, [1]); // Group 1, collides with group 1

interface PhysicsNodeProps {
  instance: CanvasNodeInstance;
  definition: AtomicNodeDefinition | DefinitionDefinition;
  wires: WireConnection[];
  onDelete: (instanceId: string) => void;
  onPortPointerDown?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, worldPos: THREE.Vector3, event: ThreeEvent<PointerEvent>) => void;
  onPortPointerEnter?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => void;
  onPortPointerLeave?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => void;
  onPortContextMenu?: (ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<MouseEvent>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onUpdatePhysicsData?: (instanceId: string, position: THREE.Vector3, rotation: THREE.Quaternion) => void;
  onDoubleClick?: (instanceId: string) => void;
  onRefReady?: (instanceId: string, ref: React.RefObject<RapierRigidBody | null>) => void;
  onRefDestroyed?: (instanceId: string) => void;
  onOpenMetadataPopup?: (instanceId: string, event: ThreeEvent<MouseEvent>) => void;
}

// Define a type for the active joint state
interface ActiveJoint {
    joint: RAPIER.ImpulseJoint;
    anchorBody: RAPIER.RigidBody; // Store the RAPIER.RigidBody for easier access/removal
}

const getNodeRadius = (definition: AtomicNodeDefinition): number => {
    const visualRadius = 50;
    const portLineLength = 15;
    const calculatedRadius = (visualRadius + portLineLength / 2) / 50;
    return calculatedRadius;
};

// Debug flags
const DEBUG_PHYSICS = false;

// Joint visualizer component (moved outside of PhysicsNode)
interface JointVisualizerProps {
  activeJoint: { joint: RAPIER.ImpulseJoint; anchorBodyHandle: number } | null;
  world: RAPIER.World;
}

const JointVisualizer: React.FC<JointVisualizerProps> = ({ activeJoint, world }) => {
  if (!activeJoint || !DEBUG_PHYSICS) return null;
  
  const [position, setPosition] = useState(new THREE.Vector3(0, 0, 0));
  
  useFrame(() => {
    try {
      const anchorBody = world.bodies.get(activeJoint.anchorBodyHandle);
      if (anchorBody) {
        const pos = anchorBody.translation();
        setPosition(new THREE.Vector3(pos.x, pos.y, pos.z));
      }
    } catch (e) {
      // Silently ignore errors during frame updates
    }
  });
  
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial color="red" opacity={0.5} transparent />
    </mesh>
  );
};

// Wrap component with forwardRef
const PhysicsNode = forwardRef<RapierRigidBody, PhysicsNodeProps>(({
    instance,
    definition,
    wires,
    onDelete,
    onPortPointerDown,
    onPortPointerEnter,
    onPortPointerLeave,
    onPortContextMenu,
    onDragStart,
    onDragEnd,
    onUpdatePhysicsData,
    onDoubleClick,
    onRefReady,
    onRefDestroyed,
    onOpenMetadataPopup
}, ref) => {

  // Create a local ref for internal use
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  // Track dragging states
  const isDraggingRef = useRef(false);
  const isShiftDraggingRef = useRef(false);
  // Ref to store joint and anchor body for non-shift drag
  const activeJointRef = useRef<ActiveJoint | null>(null);
  
  // Use useImperativeHandle to connect the forwarded ref to the local ref
  useImperativeHandle(ref, () => rigidBodyRef.current!);

  const { camera, gl } = useThree();
  const { world } = useRapier();
  const [isShiftDragging, setIsShiftDragging] = useState(false); // Keep for visual state if needed, but logic relies on ref
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredPortIndex, setHoveredPortIndex] = useState<number | null>(null);
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));

  const radius = getNodeRadius(definition as AtomicNodeDefinition);

  // Function to get mouse position on the Z=0 plane from Three.js event
  const getMousePlanePos = (event: ThreeEvent<PointerEvent | MouseEvent>): THREE.Vector3 => {
    const point = new THREE.Vector3();
    event.ray.intersectPlane(planeRef.current, point);
    return point;
  };

  // Global mouse move handler
  const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
    // Skip if not dragging
    if (!isDraggingRef.current) return;

    // Convert window coords to world space
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Create a ray from the camera through the mouse position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    
    // Find intersection with Z=0 plane
    const mousePos = new THREE.Vector3();
    const didIntersect = raycaster.ray.intersectPlane(planeRef.current, mousePos);
    
    if (!didIntersect || !mousePos) return;

    // Handle shift-dragging (direct control)
    if (isShiftDraggingRef.current && rigidBodyRef.current) {
      const targetX = mousePos.x - dragOffset.current.x;
      const targetY = mousePos.y - dragOffset.current.y;

      rigidBodyRef.current.setTranslation({ x: targetX, y: targetY, z: 0 }, true);
      rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    // Handle non-shift dragging (update joint anchor)
    else if (activeJointRef.current) {
        // Update the fixed anchor body's position
        try {
            // Added existence check for safety
            if (activeJointRef.current.anchorBody && world.bodies.get(activeJointRef.current.anchorBody.handle)) {
                activeJointRef.current.anchorBody.setTranslation(new RAPIER.Vector3(mousePos.x, mousePos.y, 0), true);
            } else {
                console.warn(`[PhysicsNode ${instance.instanceId} MouseMove] Anchor body missing or invalid.`);
                // Anchor body might have been removed unexpectedly, clean up
                console.warn("Anchor body not found during mouse move, cleaning up joint.");
                if (activeJointRef.current.joint) {
                    world.removeImpulseJoint(activeJointRef.current.joint, true);
                }
                activeJointRef.current = null;
                // Potentially stop drag here as well? Or let mouse up handle it.
                // For now, just nullify the ref. Mouse up will handle listener removal.
            }
        } catch (e) {
            console.error("Error setting anchor body translation:", e);
            // Attempt cleanup on error
             if (activeJointRef.current?.joint) {
                 world.removeImpulseJoint(activeJointRef.current.joint, true);
             }
             if (activeJointRef.current?.anchorBody && world.bodies.get(activeJointRef.current.anchorBody.handle)) {
                 world.removeRigidBody(activeJointRef.current.anchorBody);
             }
             activeJointRef.current = null;
        }
    }
  }, [camera, gl, world, instance.instanceId]); // Add world dependency

  // Global mouse up handler
  const handleGlobalMouseUp = useCallback(() => {
    // Skip if not dragging
    if (!isDraggingRef.current) return;

    console.log("Global Mouse Up - Drag End");

    // Reset dragging state immediately
    isDraggingRef.current = false;
    let needsDragEndCallback = false; // Track if onDragEnd should be called

    try {
      // Handle shift dragging cleanup
      if (isShiftDraggingRef.current) {
        console.log("Ending shift drag");
        needsDragEndCallback = true;
        isShiftDraggingRef.current = false;
        if (rigidBodyRef.current) {
          rigidBodyRef.current.setBodyType(0, true); // Reset to dynamic
          rigidBodyRef.current.wakeUp(); // Ensure it can move after being kinematic
          rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        setIsShiftDragging(false); // Update state if needed for visuals
      }
      // Handle non-shift dragging cleanup (joint)
      else if (activeJointRef.current) {
        console.log("Ending joint drag");
        needsDragEndCallback = true;
        try {
            console.log(`[PhysicsNode ${instance.instanceId} MouseUp] Removing joint.`);
            world.removeImpulseJoint(activeJointRef.current.joint, true);
             // Check if anchorBody exists and is still valid before removing
             if (activeJointRef.current.anchorBody && world.bodies.get(activeJointRef.current.anchorBody.handle)) {
                 console.log(`[PhysicsNode ${instance.instanceId} MouseUp] Removing anchor body.`);
                 console.log(`[PhysicsNode ${instance.instanceId} MouseUp] >>> Removing anchor body handle: ${activeJointRef.current.anchorBody.handle}`);
                 world.removeRigidBody(activeJointRef.current.anchorBody);
             } else {
                 console.log(`[PhysicsNode ${instance.instanceId} MouseUp] Anchor body already removed or invalid.`);
             }
        } catch (e) {
            console.error("Error removing joint/anchor body on mouse up:", e);
        } finally {
             activeJointRef.current = null;
             rigidBodyRef.current?.wakeUp(); // Wake up the main body
        }
      }

    } catch (err) {
      console.error("Error in handleGlobalMouseUp:", err);
    } finally {
      // ALWAYS remove event listeners to prevent leaks
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      
      // Call drag end AFTER listeners are removed and state is cleaned
      if (needsDragEndCallback) {
          onDragEnd?.();
      }
    }
  }, [onDragEnd, handleGlobalMouseMove, instance.instanceId, world]); // Add world dependency

  // --- Report physics state on change ---
  useFrame(() => {
      if (rigidBodyRef.current && onUpdatePhysicsData) {
          const pos = rigidBodyRef.current.translation();
          const rot = rigidBodyRef.current.rotation();
          // Check if data actually changed?
          // For now, call it every frame, App level can optimize if needed
          onUpdatePhysicsData(
              instance.instanceId,
              new THREE.Vector3(pos.x, pos.y, pos.z),
              new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
          );
      }
  });

  // --- Port Calculation Logic ---
  const portData = useMemo(() => {
      const results = [];
      const isAtomic = 'principalPorts' in definition;
      const totalPorts = isAtomic 
          ? definition.principalPorts + definition.nonPrincipalPorts 
          : definition.externalPorts.length;

      if (totalPorts === 0) return [];

      for (let i = 0; i < totalPorts; i++) {
          // Use the updated geometry function which handles both types
          const portOffset = getPortBoundaryLocalOffset(definition, i);
          const basePosition = portOffset; // Offset is the position
          
          // Calculate rotation based on the offset angle
          const angleRad = Math.atan2(portOffset.y, portOffset.x);
          const rotation = new THREE.Euler(0, 0, angleRad - Math.PI / 2, 'XYZ');

          // Base position on the node's circumference
          const baseX = NODE_RADIUS * Math.cos(angleRad);
          const baseY = NODE_RADIUS * Math.sin(angleRad);

          // Check if this port is connected
          const isConnected = wires.some((w: WireConnection) =>
              (w.sourceNodeId === instance.instanceId && w.sourcePortIndex === i) ||
              (w.targetNodeId === instance.instanceId && w.targetPortIndex === i)
          );

          results.push({
              id: `port-${i}`,
              isPrincipal: isAtomic 
                  ? (i < definition.principalPorts) 
                  : definition.externalPorts[i].isPrincipal,
              basePosition: new THREE.Vector3(baseX, baseY, 0), // Base position on the node edge
              rotation: rotation, // Euler rotation object
              isConnected: isConnected
          });
      }
      return results;
  }, [definition, wires, instance.instanceId]);
  // --- ---

  // Cleanup global listeners on unmount (belt-and-braces)
  useEffect(() => {
    const cleanup = () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      // Also clean up joint if component unmounts unexpectedly during drag
      if (activeJointRef.current) {
        try {
            console.log(`[PhysicsNode ${instance.instanceId} Cleanup] Removing joint (Joint Handle: ${activeJointRef.current.joint.handle}).`);
            world.removeImpulseJoint(activeJointRef.current.joint, true);
            // Check if anchorBody exists and is still valid before removing
            if (activeJointRef.current.anchorBody && world.bodies.get(activeJointRef.current.anchorBody.handle)) {
                console.log(`[PhysicsNode ${instance.instanceId} Cleanup] Removing anchor body (Body Handle: ${activeJointRef.current.anchorBody.handle}).`);
                console.log(`[PhysicsNode ${instance.instanceId} Cleanup] >>> Removing anchor body handle: ${activeJointRef.current.anchorBody.handle}`);
                world.removeRigidBody(activeJointRef.current.anchorBody);
            } else {
                console.log(`[PhysicsNode ${instance.instanceId} Cleanup] Anchor body already removed or invalid.`);
            }
        } catch (e) {
            console.error(`[PhysicsNode ${instance.instanceId} Cleanup] Error cleaning up joint:`, e);
        }
        activeJointRef.current = null;
      }
    };
    return cleanup;
    // Add world to dependencies as it's used in cleanup
  }, [world, handleGlobalMouseMove, handleGlobalMouseUp, instance.instanceId]); // Ensure handleGlobalMouseMove/Up refs are stable + instanceId for logging

  // --- Log Mount/Unmount --- 
  useEffect(() => {
      console.log(`[PhysicsNode ${instance.instanceId}] Mounted.`);
      return () => {
          console.log(`[PhysicsNode ${instance.instanceId}] Unmounting.`);
      };
  }, [instance.instanceId]);
  // --- --- 

  // --- Effect to report ref readiness --- 
  useEffect(() => {
      if (rigidBodyRef.current) {
          console.log(`[PhysicsNode ${instance.instanceId}] Ref ready, reporting.`);
          onRefReady?.(instance.instanceId, rigidBodyRef);
      }
      // Cleanup function to report destruction
      return () => {
          console.log(`[PhysicsNode ${instance.instanceId}] Ref destroyed, reporting.`);
          onRefDestroyed?.(instance.instanceId);
      };
  // Trigger when the ref's current value *might* change (mount/unmount) 
  // or when callbacks change (though unlikely)
  }, [instance.instanceId, onRefReady, onRefDestroyed]);
  // --- --- 

  // Handle pointer down
  const handlePointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
    // Prevent starting a new drag if one is already active
    if (isDraggingRef.current) return;

    // Ensure the event target is the mesh itself, not a child (like text)
    // This prevents accidental drags when clicking the label
    if (event.object !== event.eventObject) {
        console.log("Pointer down ignored, target was not the primary mesh.");
        return;
    }

    event.stopPropagation();

    // Bail if no rigidbody
    if (!rigidBodyRef.current) return;

    console.log("Pointer Down on node", instance.instanceId, "Shift:", event.shiftKey);

    // Clean up any existing global listeners first (safety check)
    window.removeEventListener('mousemove', handleGlobalMouseMove);
    window.removeEventListener('mouseup', handleGlobalMouseUp);

    // Tell parent dragging has started
    onDragStart?.();

    // Set master dragging flag
    isDraggingRef.current = true;

    // Wake up the body
    rigidBodyRef.current.wakeUp();

    // Get click position on the Z=0 plane
    const clickPos = getMousePlanePos(event);

    if (event.shiftKey) {
        // --- SHIFT Drag Start ---
        console.log("Pointer Down with SHIFT - Starting Kinematic Drag");
        isShiftDraggingRef.current = true;
        setIsShiftDragging(true); // For potential visual state

        const bodyPos = rigidBodyRef.current.translation();
        dragOffset.current = {
            x: clickPos.x - bodyPos.x,
            y: clickPos.y - bodyPos.y,
        };

        rigidBodyRef.current.setBodyType(1, true); // Set to kinematic
        rigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

    } else {
        // --- Normal Drag Start (Joint) ---
        console.log("Pointer Down (no shift) - Starting Joint Drag");
        isShiftDraggingRef.current = false;
        setIsShiftDragging(false);

        try {
            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] Creating anchor body at`, clickPos);
            // Create a fixed anchor body at the click position
            const anchorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(clickPos.x, clickPos.y, 0);
            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] >>> Creating anchor body...`);
            const anchorBody = world.createRigidBody(anchorDesc);
            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] Anchor body created, handle:`, anchorBody?.handle);

            // Calculate joint anchor points
            const bodyPosVec = rigidBodyRef.current.translation();
            const bodyRotQuat = rigidBodyRef.current.rotation();
            const clickPosTHREE = clickPos;
            const bodyPositionTHREE = new THREE.Vector3(bodyPosVec.x, bodyPosVec.y, bodyPosVec.z);
            const bodyRotationTHREE = new THREE.Quaternion(bodyRotQuat.x, bodyRotQuat.y, bodyRotQuat.z, bodyRotQuat.w);
            const worldOffset = new THREE.Vector3().subVectors(clickPosTHREE, bodyPositionTHREE);
            const inverseBodyRotation = bodyRotationTHREE.clone().invert();
            const localAnchorA_THREE = worldOffset.clone().applyQuaternion(inverseBodyRotation);

            const anchorA = new RAPIER.Vector3(localAnchorA_THREE.x, localAnchorA_THREE.y, localAnchorA_THREE.z); // Anchor on the dragged body (local coords)
            const anchorB = new RAPIER.Vector3(0, 0, 0); // Anchor on the fixed body (local coords - origin)

            // Create the joint
            const jointParams = RAPIER.JointData.revolute(anchorA, anchorB, new RAPIER.Vector3(0, 0, 1)); // Revolute around Z

            // Configure motor properties directly on the params object
            // Suppress TS errors as direct assignment might be necessary depending on version/bindings
            // @ts-ignore
            jointParams.motorEnabled = true;
            // @ts-ignore
            jointParams.motorTargetVel = 0;
            // @ts-ignore
            jointParams.motorMaxForce = 50; // Adjust force as needed
            // @ts-ignore
            jointParams.motorModel = RAPIER.MotorModel.ForceBased;

            const bodyA = world.bodies.get(rigidBodyRef.current.handle); // The node being dragged
            const bodyB = anchorBody; // The fixed anchor

            if (!bodyA || !bodyB) throw new Error("Could not get bodies for joint creation");

            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] Creating joint between body ${bodyA.handle} and anchor ${bodyB.handle}.`);
            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] >>> Creating impulse joint...`);
            const joint = world.createImpulseJoint(jointParams, bodyA, bodyB, true);
            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] Joint created.`);

            activeJointRef.current = { joint, anchorBody }; // Store joint and anchor body API

        } catch (e) {
            console.error("Failed to create revolute joint:", e);
            // Clean up if joint creation failed
            console.log(`[PhysicsNode ${instance.instanceId} PointerDown] Cleaning up anchor body due to joint creation failure.`);
            if (activeJointRef.current?.anchorBody) {
                try {
                    console.log(`[PhysicsNode ${instance.instanceId} PointerDown Error Cleanup] >>> Removing anchor body handle: ${activeJointRef.current.anchorBody.handle}`);
                    world.removeRigidBody(activeJointRef.current.anchorBody);
                } catch (cleanupError) {
                    console.error("[PhysicsNode PointerDown] Error during anchor body cleanup:", cleanupError);
                }
            }
            activeJointRef.current = null;
            isDraggingRef.current = false; // Reset dragging state
            onDragEnd?.(); // Notify drag ended prematurely
            return; // Don't attach listeners if setup failed
        }
    }

    // CRITICAL: Attach global event listeners for EITHER type of drag
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

  }, [getMousePlanePos, handleGlobalMouseMove, handleGlobalMouseUp, onDragStart, onDragEnd, instance.instanceId, world]); // Add world, onDragEnd

  const handleContextMenu = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation(); // Prevent canvas context menu
    // Implement custom context menu logic later if needed
    console.log("Node context menu");
    // Example: Delete on right click for now
    onDelete(instance.instanceId);
  };

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
       // Only trigger if clicking the main body, not text/ports
       // if (event.object !== event.eventObject) return; // This check might be too strict, let's test without it first.
       event.stopPropagation();
       console.log("Node double-clicked:", instance.instanceId);
       // --- UPDATED --- 
       // If it's an atomic node, open the metadata popup
       if (!instance.isDefinitionInstance && onOpenMetadataPopup) {
           console.log("-> Atomic node, calling onOpenMetadataPopup");
           onOpenMetadataPopup(instance.instanceId, event);
       } 
       // If it's a definition instance, call the expansion handler
       else if (instance.isDefinitionInstance && onDoubleClick) {
           console.log("-> Definition node, calling onDoubleClick (for expansion)");
           onDoubleClick(instance.instanceId);
       } else {
           console.log("-> Double click condition not met (isDefinitionInstance:", instance.isDefinitionInstance, ", has onOpenMetadataPopup:", !!onOpenMetadataPopup, ", has onDoubleClick:", !!onDoubleClick, ")");
       }
       // --- END UPDATED ---
  };

  const handlePortPointerDown = (event: ThreeEvent<PointerEvent>, portIndex: number) => {
    event.stopPropagation();
    const portMesh = event.object as THREE.Mesh;
    const worldPos = new THREE.Vector3();
    portMesh.getWorldPosition(worldPos);
    // Call unified handler with node ownerId and numeric portIndex
    onPortPointerDown?.(instance.instanceId, portIndex, worldPos, event);
  };

  const handlePortPointerEnter = (event: ThreeEvent<PointerEvent>, portIndex: number) => {
    event.stopPropagation();
    setHoveredPortIndex(portIndex);
    // Call unified handler
    onPortPointerEnter?.(instance.instanceId, portIndex, event);
  };

  const handlePortPointerLeave = (event: ThreeEvent<PointerEvent>, portIndex: number) => {
    event.stopPropagation();
    setHoveredPortIndex(null);
    // Call unified handler
    onPortPointerLeave?.(instance.instanceId, portIndex, event);
  };

  return (
    <RigidBody
      ref={rigidBodyRef}
      userData={{ instanceId: instance.instanceId }}
      colliders={false}
      position={[instance.x, instance.y, 0]}
      type="dynamic"
      linearDamping={0.8}
      angularDamping={0.8}
      canSleep={false}
      ccd={true}
      mass={0.01}
      gravityScale={0}
      lockRotations={false}
      collisionGroups={NODE_GROUP}
    >
      {/* Group for elements that rotate with the body */}
      <group>
        {/* Main Circle (receives input) */}
        <mesh
            onPointerDown={handlePointerDown}
            onContextMenu={handleContextMenu}
            onDoubleClick={handleDoubleClick}
        >
             <circleGeometry args={[NODE_RADIUS, 32]} />
             <meshStandardMaterial color={definition.color} emissive={definition.color} emissiveIntensity={0.2} side={THREE.DoubleSide} />
        </mesh>

        {/* Ports (Now render generic Port component) */}
        {portData.map((portInfo, originalIndex) => (
            <Port
                key={portInfo.id}
                ownerId={instance.instanceId}
                portIdOrIndex={originalIndex}
                position={portInfo.basePosition} // Base position relative to node center
                rotation={portInfo.rotation}    // Rotation object
                length={PORT_LINE_LENGTH}     // Use constant length for now
                lineRadius={PORT_LINE_RADIUS} // Use constant radius
                dotRadius={PRINCIPAL_MARKER_RADIUS} // Use principal marker radius for dot
                isConnected={portInfo.isConnected}
                isPrincipal={portInfo.isPrincipal} // Pass principal status
                // Pass unified handlers down
                onPointerDown={onPortPointerDown}
                onPointerEnter={onPortPointerEnter}
                onPointerLeave={onPortPointerLeave}
                onContextMenu={onPortContextMenu} 
            />
        ))}
      </group>

      {/* Non-rotating Label and Metadata */}
      <Billboard position={[0, 0, 0.1]}> 
        {(() => { // Use a function to calculate positions based on metadata
          const visibleMetadataFields = !instance.isDefinitionInstance 
            ? (definition as AtomicNodeDefinition).metadataSchema?.filter(
                (fieldName: string) => instance.metadataVisibility?.[fieldName] && instance.metadataValues?.[fieldName] != null
              ) || [] 
            : [];
          const numVisibleMetadata = visibleMetadataFields.length;
          
          // Calculate vertical offset to center the block
          // Approximate total lines = 1 (name) + numVisibleMetadata
          // Approximate height per line = LABEL_FONT_SIZE
          // Approximate spacing = LABEL_FONT_SIZE * 0.2
          // Offset shifts the center up by roughly half the metadata height
          const verticalOffset = (numVisibleMetadata * LABEL_FONT_SIZE * 0.95) / 2; // Adjust 0.95 multiplier for spacing

          return (
            <> {/* Use Fragment to return multiple elements */}
              <Text
                position={[0, verticalOffset, 0]} // Apply vertical offset to name
                fontSize={LABEL_FONT_SIZE}
                color="#ffffff" // White color for better contrast on dark nodes
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.02}
                outlineColor="#000000"
              >
                {definition.name}
              </Text>
              
              {/* Render Visible Metadata relative to the shifted name */}
              {visibleMetadataFields.map((fieldName: string, index: number) => (
                <Text
                  key={fieldName}
                  // Position below the name, accounting for offset and index
                  position={[0, verticalOffset - LABEL_FONT_SIZE * (1.1 + index * 0.9), 0]} 
                  fontSize={LABEL_FONT_SIZE * 0.75} // Smaller font for metadata
                  color="#abb2bf" // Light grey for metadata
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.01}
                  outlineColor="#000000"
                >
                  {`${fieldName}: ${instance.metadataValues?.[fieldName]}`}
                </Text>
              ))}
            </>
          );
        })()}
      </Billboard>

      {/* Explicit Collider */}
      <BallCollider
        args={[NODE_RADIUS]}
        collisionGroups={NODE_GROUP}
      />
    </RigidBody>
  );
});

export default PhysicsNode; 