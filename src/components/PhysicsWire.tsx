import React, { useRef, useMemo, useState, useEffect, createRef, useCallback } from 'react';
import {
    RigidBody,
    CapsuleCollider,
    useSphericalJoint,
    useFixedJoint,
    RapierRigidBody,
    interactionGroups,
    useRapier,
} from '@react-three/rapier';
import * as THREE from 'three';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { AtomicNodeDefinition, DefinitionDefinition } from '../types';
import { getPortBoundaryLocalOffset } from '../utils/geometry';
import RAPIER from '@dimforge/rapier3d-compat';

// --- Constants ---
const WIRE_SEGMENT_LENGTH = 0.2;
const WIRE_SEGMENT_RADIUS = 0.05;
const NUM_SEGMENTS = 10;
const SEGMENT_DENSITY = 0.1;
const SEGMENT_LINEAR_DAMPING = 0.8;
const SEGMENT_ANGULAR_DAMPING = 0.8;
const SEGMENT_COLOR = "#ccc";

// --- Collision Groups ---
const WIRE_GROUP = interactionGroups(2, []); // Group 2, collides with nothing
// --- ---

// Helper to get world position
const getWorldPositionFromRef = (bodyRef: React.RefObject<RapierRigidBody | null>, localPoint: THREE.Vector3): THREE.Vector3 | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const bodyPosVec = body.translation();
    const bodyRotQuat = body.rotation();
    const bodyPositionTHREE = new THREE.Vector3(bodyPosVec.x, bodyPosVec.y, bodyPosVec.z);
    const bodyRotationTHREE = new THREE.Quaternion(bodyRotQuat.x, bodyRotQuat.y, bodyRotQuat.z, bodyRotQuat.w);
    const worldOffset = localPoint.clone().applyQuaternion(bodyRotationTHREE);
    return new THREE.Vector3().addVectors(bodyPositionTHREE, worldOffset);
};

interface PhysicsWireProps {
    wireId: string;
    sourcePortIndex: number;
    targetPortIndex: number;
    sourceDefinition: AtomicNodeDefinition | DefinitionDefinition;
    targetDefinition: AtomicNodeDefinition | DefinitionDefinition;
    sourceNodeRef: React.RefObject<RapierRigidBody>;
    targetNodeRef: React.RefObject<RapierRigidBody>;
    onDeleteWire?: (wireId: string) => void;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    targetLength?: number | null;
    onUpdateWireLength?: (wireId: string, newLength: number) => void;
}

// Define SegmentData interface
interface SegmentData {
    key: string;
    initialPosition: THREE.Vector3;
    initialRotation: THREE.Quaternion;
    length: number;
    radius: number;
}

const PhysicsWire: React.FC<PhysicsWireProps> = ({
    wireId,
    sourcePortIndex,
    targetPortIndex,
    sourceDefinition,
    targetDefinition,
    sourceNodeRef,
    targetNodeRef,
    onDeleteWire,
    onDragStart,
    onDragEnd,
    targetLength,
    onUpdateWireLength
}) => {

    // --- NEW: Explicit check for refs before proceeding ---
    if (!sourceNodeRef.current || !targetNodeRef.current) {
        console.warn(`[PhysicsWire ${wireId}] Render cancelled: sourceRef or targetRef is null.`);
        return null;
    }
    console.log(`[PhysicsWire ${wireId}] Rendering. Source ref handle: ${sourceNodeRef.current?.handle}, Target ref handle: ${targetNodeRef.current?.handle}`);
    // --- END NEW ---

    // Keep refs for segments
    const segmentRefs = useRef<React.RefObject<RapierRigidBody>[]>([]); // Refs for segment bodies
    // Dragging refs
    const isDraggingRef = useRef(false);
    const draggedSegmentIndexRef = useRef<number>(-1);
    const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)); // For mouse projection

    // R3F and Rapier hooks
    const { camera, gl } = useThree();
    const { world } = useRapier();

    // State to delay joint creation until refs are likely populated
    const [jointsReady, setJointsReady] = useState(false);
    // State for hover effect for the entire wire
    const [isWireHovered, setIsWireHovered] = useState<boolean>(false);

    const segmentData = useMemo<SegmentData[]>(() => {
        // console.log(`PhysicsWire ${wireId}: useMemo for segmentData running.`);
        // Check if passed node refs are current
        // console.log(`[PhysicsWire ${wireId}] segmentData: sourceNodeRef.current exists?`, !!sourceNodeRef.current);
        // console.log(`[PhysicsWire ${wireId}] segmentData: targetNodeRef.current exists?`, !!targetNodeRef.current);
        const sourceBody = sourceNodeRef.current;
        const targetBody = targetNodeRef.current;
        // Removed null check here - handled at the start of the component
        // console.log(`PhysicsWire ${wireId}: useMemo - Refs are current.`);

        // Calculate directly using the current bodies from refs
        const sourceBodyPos = sourceBody.translation();
        const sourceBodyRot = sourceBody.rotation();
        const targetBodyPos = targetBody.translation();
        const targetBodyRot = targetBody.rotation();

        const sourceLocalOffset = getPortBoundaryLocalOffset(sourceDefinition, sourcePortIndex);
        const targetLocalOffset = getPortBoundaryLocalOffset(targetDefinition, targetPortIndex);

        // Calculate world positions from bodies and offsets
        const sourcePos = new THREE.Vector3(sourceBodyPos.x, sourceBodyPos.y, sourceBodyPos.z)
            .add(sourceLocalOffset.clone().applyQuaternion(new THREE.Quaternion(sourceBodyRot.x, sourceBodyRot.y, sourceBodyRot.z, sourceBodyRot.w)));
        const targetPos = new THREE.Vector3(targetBodyPos.x, targetBodyPos.y, targetBodyPos.z)
            .add(targetLocalOffset.clone().applyQuaternion(new THREE.Quaternion(targetBodyRot.x, targetBodyRot.y, targetBodyRot.z, targetBodyRot.w)));

        // console.log(`PhysicsWire ${wireId}: useMemo - Calculated world positions.`);

        const wireVector = new THREE.Vector3().subVectors(targetPos, sourcePos);
        const currentDistance = wireVector.length();

        // Determine the length to use for segment calculation
        const lengthToUse = targetLength ?? currentDistance;

        if (lengthToUse < 0.01) {
             segmentRefs.current = []; // Clear refs too
             return [];
        }

        // ... calculate numActualSegments, actualSegmentLength ...
        const numActualSegments = Math.max(1, Math.min(NUM_SEGMENTS, Math.floor(lengthToUse / WIRE_SEGMENT_LENGTH)));
        const actualSegmentLength = lengthToUse / numActualSegments;
        wireVector.normalize();

        const newSegmentData: SegmentData[] = [];
        const segmentRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), wireVector);

        // Ensure segmentRefs array is correctly sized
        if (segmentRefs.current.length !== numActualSegments) {
             // Explicitly cast the created array to satisfy the linter
             segmentRefs.current = Array.from({ length: numActualSegments }, () => createRef<RapierRigidBody>()) as React.RefObject<RapierRigidBody>[];
        }

        // ... loop to create newSegmentData ...
        for (let i = 0; i < numActualSegments; i++) {
            const segmentCenterPos = new THREE.Vector3()
                .copy(sourcePos)
                .addScaledVector(wireVector, (i + 0.5) * actualSegmentLength);

            newSegmentData.push({
                key: `${wireId}-seg-${i}`,
                initialPosition: segmentCenterPos,
                initialRotation: segmentRotation.clone(),
                length: actualSegmentLength,
                radius: WIRE_SEGMENT_RADIUS,
            });
        }
        // console.log(`PhysicsWire ${wireId}: useMemo - Calculated ${numActualSegments} segments.`);
        return newSegmentData;

    // Depend on the passed refs' current values implicitly via source/targetBody
    // Also depend on definitions/ports/id
    }, [sourceDefinition, targetDefinition, sourcePortIndex, targetPortIndex, wireId, targetLength]); // Removed sourceNodeRef, targetNodeRef deps

    // Effect to enable joints shortly after mount
    useEffect(() => {
        // console.log(`PhysicsWire ${wireId}: Mount effect, setting jointsReady timer.`);
        const timer = setTimeout(() => {
            // console.log(`PhysicsWire ${wireId}: Timer fired, setting jointsReady to true.`);
            setJointsReady(true);
        }, 0); // Minimal delay, just allows one render cycle for refs
        return () => clearTimeout(timer); // Cleanup timer
    }, [wireId]); // Run only once when the wire mounts

    // --- Drag Logic ---

    // Function to get mouse position on the Z=0 plane from a MouseEvent
    const getMousePlanePosFromMouseEvent = useCallback((event: MouseEvent): THREE.Vector3 | null => {
        const rect = gl.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

        const mousePos = new THREE.Vector3();
        const didIntersect = raycaster.ray.intersectPlane(planeRef.current, mousePos);

        return didIntersect ? mousePos : null;
    }, [camera, gl]);


    const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
        if (!isDraggingRef.current || draggedSegmentIndexRef.current < 0) return;

        const mousePos = getMousePlanePosFromMouseEvent(event);
        if (!mousePos) return;

        const segmentIndex = draggedSegmentIndexRef.current;
        const segmentBodyRef = segmentRefs.current[segmentIndex];

        if (segmentBodyRef?.current) {
            const targetX = mousePos.x - dragOffsetRef.current.x;
            const targetY = mousePos.y - dragOffsetRef.current.y;

            segmentBodyRef.current.setTranslation({ x: targetX, y: targetY, z: 0 }, true);
            segmentBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
            segmentBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
    }, [getMousePlanePosFromMouseEvent]);


    const handleGlobalMouseUp = useCallback(() => {
        if (!isDraggingRef.current) return;

        const segmentIndex = draggedSegmentIndexRef.current;
        const segmentBodyRef = segmentRefs.current[segmentIndex];

        // Reset state immediately
        isDraggingRef.current = false;
        draggedSegmentIndexRef.current = -1;

        // Clean up physics state
        if (segmentBodyRef?.current) {
            try {
                 segmentBodyRef.current.setBodyType(RAPIER.RigidBodyType.Dynamic, true); // Reset to dynamic
                 segmentBodyRef.current.wakeUp();
                 // Optionally reset velocities again, though kinematic should have kept them 0
                 segmentBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
                 segmentBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
            } catch (e) {
                console.error(`Error resetting body type for wire ${wireId} segment ${segmentIndex}:`, e);
            }
        }

        // Remove listeners and notify parent AFTER state cleanup
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
        onDragEnd?.();

    }, [onDragEnd, handleGlobalMouseMove, wireId]); // Add wireId for logging


    const handleSegmentPointerDown = useCallback((event: ThreeEvent<PointerEvent>, index: number) => {
        // Prevent starting a new drag if one is already active
        if (isDraggingRef.current) return;

        event.stopPropagation(); // Stop propagation to prevent canvas-level events

        const segmentBodyRef = segmentRefs.current[index];
        if (!segmentBodyRef?.current) {
             console.warn(`Pointer down on segment ${index} but ref is not current.`);
             return;
        }

        console.log(`Pointer Down on wire ${wireId} segment ${index}`);

        // Clean up any stray listeners (safety check)
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);

        isDraggingRef.current = true;
        draggedSegmentIndexRef.current = index;
        onDragStart?.(); // Notify parent

        segmentBodyRef.current.wakeUp();

        // Get click position on the Z=0 plane from the R3F event
        const clickPos = new THREE.Vector3();
        if (!event.ray.intersectPlane(planeRef.current, clickPos)) {
             console.error("Could not intersect click ray with plane.");
             isDraggingRef.current = false; // Abort drag
             draggedSegmentIndexRef.current = -1;
             onDragEnd?.(); // Notify drag ended prematurely
             return;
        }

        const bodyPos = segmentBodyRef.current.translation();
        dragOffsetRef.current = {
            x: clickPos.x - bodyPos.x,
            y: clickPos.y - bodyPos.y,
        };

        // Set segment to kinematic
        segmentBodyRef.current.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        segmentBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        segmentBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Attach global listeners
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

    }, [onDragStart, onDragEnd, handleGlobalMouseMove, handleGlobalMouseUp, wireId]); // Add dependencies

    // Effect for drag cleanup on unmount
    useEffect(() => {
        return () => {
            // If component unmounts while dragging, clean up
            if (isDraggingRef.current) {
                console.warn(`PhysicsWire ${wireId} unmounted while dragging segment ${draggedSegmentIndexRef.current}. Cleaning up.`);
                window.removeEventListener('mousemove', handleGlobalMouseMove);
                window.removeEventListener('mouseup', handleGlobalMouseUp);
                 // Attempt to reset body type if possible - might fail if world is gone
                 try {
                    const segmentIndex = draggedSegmentIndexRef.current;
                    if (segmentIndex >= 0) {
                        const segmentBodyRef = segmentRefs.current[segmentIndex];
                        if (segmentBodyRef?.current) {
                            segmentBodyRef.current.setBodyType(RAPIER.RigidBodyType.Dynamic, false); // Use false for wakeUp as body might be invalid
                        }
                    }
                 } catch(e) {
                     console.error("Error resetting body type on unmount cleanup:", e);
                 }
                // No need to call onDragEnd as the parent likely caused the unmount
            }
        };
    }, [handleGlobalMouseMove, handleGlobalMouseUp, wireId]); // Add wireId

    // --- Hover Logic ---
    const handleWirePointerEnter = useCallback(() => {
        // This function will be called when the pointer enters ANY segment mesh
        setIsWireHovered(true);
    }, []);

    const handleWirePointerLeave = useCallback(() => {
        // This function will be called when the pointer leaves the GROUP containing all segments
        setIsWireHovered(false);
    }, []);

    // --- Joint Hooks (wrapped in helper components) ---
    const jointComponents = useMemo(() => {
        // Only calculate if joints are ready and segments exist
        if (!jointsReady || segmentRefs.current.length <= 1) {
            return [];
        }
        // console.log(`PhysicsWire ${wireId}: Calculating joint components.`);
        const components: React.ReactNode[] = [];
        for (let i = 0; i < segmentRefs.current.length - 1; i++) {
            const refA = segmentRefs.current[i];
            const refB = segmentRefs.current[i + 1];
            // Ensure refs are current before creating joint component
            if (!refA?.current || !refB?.current) {
                console.warn(`PhysicsWire ${wireId}: Missing refs for segment joint ${i}. Skipping.`);
                continue; // Skip if refs aren't ready (shouldn't happen with jointsReady state, but good check)
            }
            const segmentLength = segmentData[i]?.length ?? WIRE_SEGMENT_LENGTH;
            const anchorA: [number, number, number] = [0, segmentLength / 2, 0];
            const anchorB: [number, number, number] = [0, -segmentLength / 2, 0];
            components.push(<SegmentSphericalJoint key={`${wireId}-joint-${i}`} refA={refA} refB={refB} anchors={[anchorA, anchorB]} />);
        }
        return components;
    // Depend on jointsReady state now
    }, [segmentData, wireId, jointsReady]);

    const sourceLocalAnchor = useMemo(() => {
        const offset = getPortBoundaryLocalOffset(sourceDefinition, sourcePortIndex);
        return [offset.x, offset.y, offset.z] as [number, number, number];
    }, [sourceDefinition, sourcePortIndex]);
    const firstSegmentLocalAnchor = useMemo(() => {
        const segmentLength = segmentData[0]?.length ?? WIRE_SEGMENT_LENGTH;
        return [0, -segmentLength / 2, 0] as [number, number, number];
    }, [segmentData]);
    const targetLocalAnchor = useMemo(() => {
        const offset = getPortBoundaryLocalOffset(targetDefinition, targetPortIndex);
        return [offset.x, offset.y, offset.z] as [number, number, number];
    }, [targetDefinition, targetPortIndex]);
    const lastSegmentLocalAnchor = useMemo(() => {
        const lastIndex = segmentData.length - 1;
        const segmentLength = segmentData[lastIndex]?.length ?? WIRE_SEGMENT_LENGTH;
        return [0, segmentLength / 2, 0] as [number, number, number];
    }, [segmentData]);

    // --- Wheel Logic ---
    const handleWheel = useCallback((event: WheelEvent) => {
        if (!isWireHovered || !onUpdateWireLength) {
            return; // Only handle wheel if hovered and callback exists
        }

        event.preventDefault();
        event.stopPropagation();

        const scrollDelta = event.deltaY;
        const sensitivity = 0.005; // Adjust sensitivity as needed
        const minLength = 0.1; // Minimum wire length
        const maxLength = 50.0; // Maximum wire length (adjust as needed)

        // Calculate current length (use targetLength if available, else calculate)
        let currentLength = targetLength;
        if (currentLength == null) {
            const sourceBody = sourceNodeRef.current;
            const targetBody = targetNodeRef.current;
            if (sourceBody && targetBody) {
                const sourceBodyPos = sourceBody.translation();
                const sourceBodyRot = sourceBody.rotation();
                const targetBodyPos = targetBody.translation();
                const targetBodyRot = targetBody.rotation();
                const sourceLocalOffset = getPortBoundaryLocalOffset(sourceDefinition, sourcePortIndex);
                const targetLocalOffset = getPortBoundaryLocalOffset(targetDefinition, targetPortIndex);
                const sourcePos = new THREE.Vector3(sourceBodyPos.x, sourceBodyPos.y, sourceBodyPos.z).add(sourceLocalOffset.clone().applyQuaternion(new THREE.Quaternion(sourceBodyRot.x, sourceBodyRot.y, sourceBodyRot.z, sourceBodyRot.w)));
                const targetPos = new THREE.Vector3(targetBodyPos.x, targetBodyPos.y, targetBodyPos.z).add(targetLocalOffset.clone().applyQuaternion(new THREE.Quaternion(targetBodyRot.x, targetBodyRot.y, targetBodyRot.z, targetBodyRot.w)));
                currentLength = sourcePos.distanceTo(targetPos);
            } else {
                console.warn("Cannot calculate current length for wheel event.");
                return; // Cannot calculate length, abort
            }
        }

        const change = -scrollDelta * sensitivity;
        let newLength = Math.max(minLength, Math.min(maxLength, currentLength - change));

        // Only update if the length actually changes significantly (optional)
        if (Math.abs(newLength - currentLength) > 0.001) {
            // console.log(`Wheel event on wire ${wireId}: delta=${scrollDelta}, old=${currentLength}, new=${newLength}`);
            onUpdateWireLength(wireId, newLength);
        }

    }, [isWireHovered, onUpdateWireLength, targetLength, wireId, sourceNodeRef, targetNodeRef, sourceDefinition, targetDefinition, sourcePortIndex, targetPortIndex]);

    // Effect to add/remove wheel listener
    useEffect(() => {
        const currentGl = gl.domElement;
        if (isWireHovered) {
            // console.log(`Adding wheel listener for wire ${wireId}`);
            currentGl.addEventListener('wheel', handleWheel, { passive: false });
            return () => {
                // console.log(`Removing wheel listener for wire ${wireId}`);
                currentGl.removeEventListener('wheel', handleWheel);
            };
        }
         // Ensure cleanup if not hovered
         return () => {
             currentGl.removeEventListener('wheel', handleWheel);
         };
    }, [isWireHovered, handleWheel, gl.domElement]); // Depend on gl.domElement

    // --- Render ---
    if (segmentData.length === 0) {
        // Render nothing if refs weren't ready or wire too short
        return null;
    }
    // console.log(`PhysicsWire ${wireId}: Rendering ${segmentData.length} segments. Joints ready: ${jointsReady}`);

    // --- Context Menu Handler ---
    const handleContextMenu = (event: React.MouseEvent | ThreeEvent<MouseEvent>) => {
        // Check if event has nativeEvent (like from react-three-fiber pointer events)
        const nativeEvent = (event as any).nativeEvent || event; // Handle both event types
        nativeEvent.preventDefault(); // Prevent default browser context menu
        nativeEvent.stopPropagation(); // Stop event bubbling further

        // If dragging, cancel the drag first
        if (isDraggingRef.current) {
            handleGlobalMouseUp(); // Use the existing cleanup logic
        }

        if (onDeleteWire) {
            console.log(`Right-clicked wire ${wireId}. Deleting.`);
            onDeleteWire(wireId);
        }
    };

    return (
        <group
            key={`${wireId}-${targetLength ?? 'default'}`}
            onContextMenu={handleContextMenu}
            onPointerLeave={handleWirePointerLeave}
        >
            {/* Render Segments (assign segment refs here) */}
            {segmentData.map((seg, index) => (
                <RigidBody
                    key={seg.key}
                    ref={segmentRefs.current[index]}
                    position={seg.initialPosition}
                    rotation={new THREE.Euler().setFromQuaternion(seg.initialRotation)}
                    colliders={false}
                    linearDamping={SEGMENT_LINEAR_DAMPING}
                    angularDamping={SEGMENT_ANGULAR_DAMPING}
                    density={SEGMENT_DENSITY}
                    collisionGroups={WIRE_GROUP}
                    canSleep={false}
                >
                    <CapsuleCollider
                         args={[seg.length / 2, seg.radius]}
                    />
                    <mesh
                        castShadow
                        receiveShadow
                        onPointerDown={(e) => handleSegmentPointerDown(e, index)}
                        onPointerEnter={handleWirePointerEnter}
                    >
                        <capsuleGeometry args={[seg.radius, seg.length, 4, 8]} />
                        <meshStandardMaterial
                            color={isWireHovered ? 'yellow' : SEGMENT_COLOR}
                            metalness={0.2}
                            roughness={0.8}
                         />
                    </mesh>
                </RigidBody>
            ))}

             {/* Render Joints ONLY WHEN READY */}
             {segmentData.length > 1 && (
                 <>
                    {jointComponents}
                 </>
             )}
             {segmentData.length > 0 && sourceNodeRef.current && targetNodeRef.current && (
                 <>
                    <EndSphericalJoint
                        key={`${wireId}-joint-start-${targetLength ?? 'default'}`}
                        nodeRef={sourceNodeRef}
                        segmentRef={segmentRefs.current[0]}
                        nodeAnchor={sourceLocalAnchor}
                        segmentAnchor={firstSegmentLocalAnchor}
                    />
                    <EndSphericalJoint
                        key={`${wireId}-joint-end-${targetLength ?? 'default'}`}
                        nodeRef={targetNodeRef}
                        segmentRef={segmentRefs.current[segmentRefs.current.length - 1]}
                        nodeAnchor={targetLocalAnchor}
                        segmentAnchor={lastSegmentLocalAnchor}
                    />
                 </>
             )}
        </group>
    );
};

// Helper components to call joint hooks unconditionally
const SegmentSphericalJoint: React.FC<{
    refA: React.RefObject<RapierRigidBody>;
    refB: React.RefObject<RapierRigidBody>;
    anchors: [[number, number, number], [number, number, number]];
}> = ({ refA, refB, anchors }) => {
    const shouldCreateJoint = refA.current && refB.current;
    console.log(`[SegmentSphericalJoint] Checking refs before joint creation. RefA handle: ${refA.current?.handle}, RefB handle: ${refB.current?.handle}, Should create: ${shouldCreateJoint}`);
    if (shouldCreateJoint) {
        console.log(`[SegmentSphericalJoint] >>> Creating joint between ${refA.current.handle} and ${refB.current.handle}.`);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useSphericalJoint(refA, refB, anchors);
    }
    return null;
};

// Renamed from EndFixedJoint to EndSphericalJoint to use spherical (ball-and-socket) joints
// This allows the wire endpoints to rotate freely while staying attached to the node
const EndSphericalJoint: React.FC<{
    nodeRef: React.RefObject<RapierRigidBody>;
    segmentRef: React.RefObject<RapierRigidBody>;
    nodeAnchor: [number, number, number];
    segmentAnchor: [number, number, number];
}> = ({ nodeRef, segmentRef, nodeAnchor, segmentAnchor }) => {
    const shouldCreateJoint = nodeRef.current && segmentRef.current;
    console.log(`[EndSphericalJoint] Checking refs before joint creation. NodeRef handle: ${nodeRef.current?.handle}, SegmentRef handle: ${segmentRef.current?.handle}, Should create: ${shouldCreateJoint}`);
    // Check both refs before calling hook (still good practice)
    if (shouldCreateJoint) {
        // Use spherical joint to allow rotation at the endpoints
        console.log(`[EndSphericalJoint] >>> Creating joint between ${nodeRef.current.handle} and ${segmentRef.current.handle}.`);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useSphericalJoint(
            nodeRef,
            segmentRef,
            [nodeAnchor, segmentAnchor]
        );
    }
    return null;
};

export default PhysicsWire; 