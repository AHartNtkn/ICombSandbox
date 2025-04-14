import React, { useRef, Suspense, useEffect, useState, useCallback, MutableRefObject, Dispatch, SetStateAction, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Physics, RapierRigidBody } from '@react-three/rapier';
import { OrbitControls, Line } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { AtomicNodeDefinition, CanvasNodeInstance, WireConnection, DrawingWireState, BoundaryPort, NodeOrBoundaryId, PortIndexOrId } from '../types';
import { getPortBoundaryLocalOffset } from '../utils/geometry';
import PhysicsNode from './PhysicsNode';
import ManualDrawingLine from './ManualDrawingLine';
import PhysicsWire from './PhysicsWire';
import './CanvasArea.css';
import Boundary from './Boundary';
import { ThreeEvent } from '@react-three/fiber';

interface CanvasAreaProps {
  atomicNodeDefs: AtomicNodeDefinition[];
  canvasNodes: CanvasNodeInstance[];
  wires: WireConnection[];
  drawingWire: DrawingWireState | null;
  onAddNode: (definitionId: string, x: number, y: number) => void;
  onDeleteNode: (instanceId: string) => void;
  onStartWire: (sourceNodeId: NodeOrBoundaryId, sourcePortIndex: PortIndexOrId, startX: number, startY: number, currentMouseX: number, currentMouseY: number) => void;
  onUpdateWireEnd: (currentMouseX: number, currentMouseY: number) => void;
  onFinishWire: (targetNodeId: string | null, targetPortIndex: number | null) => void;
  onDeleteWire?: (wireId: string) => void;
  onUpdateWireLength?: (wireId: string, newLength: number) => void;
  onUpdateNodePhysicsData?: (instanceId: string, position: THREE.Vector3, rotation: THREE.Quaternion) => void;
  isBoundaryActive: boolean;
  boundaryPorts: BoundaryPort[];
  addBoundaryPort: (port: BoundaryPort) => void;
  deleteBoundaryPort: (portId: string) => void;
  setWires: Dispatch<SetStateAction<WireConnection[]>>;
}

// Helper function to manage orbit controls enabling/disabling
const useDragControls = (setControlsEnabled: React.Dispatch<React.SetStateAction<boolean>>) => {
  const handleDragStart = useCallback(() => {
    console.log("Drag Start detected, disabling controls");
    setControlsEnabled(false);
  }, [setControlsEnabled]);

  const handleDragEnd = useCallback(() => {
    console.log("Drag End detected, enabling controls");
    setControlsEnabled(true);
  }, [setControlsEnabled]);

  return { handleDragStart, handleDragEnd };
};

const CanvasArea: React.FC<CanvasAreaProps> = ({ atomicNodeDefs, canvasNodes, wires, drawingWire, onAddNode, onDeleteNode, onStartWire, onUpdateWireEnd, onFinishWire, onDeleteWire, onUpdateWireLength, onUpdateNodePhysicsData, isBoundaryActive, boundaryPorts, addBoundaryPort, deleteBoundaryPort, setWires }) => {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const wireTargetRef = useRef<{ nodeId: NodeOrBoundaryId; portIndex: PortIndexOrId } | null>(null);

  const r3fStateRef = useRef<{ camera: THREE.OrthographicCamera, raycaster: THREE.Raycaster } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(50);

  // Store refs to the PhysicsNode components
  const nodeRefs = useRef<Map<string, React.RefObject<RapierRigidBody>>>(new Map());
  // ---> NEW: Store refs for boundary port physics bodies
  const boundaryPortBodyRefs = useRef<Map<string, React.RefObject<RapierRigidBody | null>>>(new Map());
  // <--- END NEW

  // Callback to store/remove node refs
  const handleNodeRefUpdate = useCallback((instanceId: string, ref: React.RefObject<RapierRigidBody>) => {
    // console.log(`CanvasArea: Updating ref for node ${instanceId}`, ref);
    nodeRefs.current.set(instanceId, ref);
    // Trigger a re-render if needed, maybe via state, though passing refs directly might suffice
  }, []);

  // Cleanup ref when node is deleted
  useEffect(() => {
      const currentKeys = new Set(canvasNodes.map(n => n.instanceId));
      const refsToDelete: string[] = [];
      nodeRefs.current.forEach((_, key) => {
          if (!currentKeys.has(key)) {
              refsToDelete.push(key);
          }
      });
      if (refsToDelete.length > 0) {
          // console.log("CanvasArea: Cleaning up refs for nodes:", refsToDelete);
          refsToDelete.forEach(key => nodeRefs.current.delete(key));
          // Force update if necessary, maybe not needed if PhysicsWire only depends on props
      }
  }, [canvasNodes]);

  // ---> NEW: Callbacks for Boundary to register/unregister its port body refs
  const registerBoundaryPortBodyRef = useCallback((portId: string, ref: React.RefObject<RapierRigidBody | null>) => {
      // console.log(`CanvasArea: Registering boundary port ref ${portId}`);
      boundaryPortBodyRefs.current.set(portId, ref);
  }, []);

  const unregisterBoundaryPortBodyRef = useCallback((portId: string) => {
      // console.log(`CanvasArea: Unregistering boundary port ref ${portId}`);
      boundaryPortBodyRefs.current.delete(portId);
  }, []);
  // <--- END NEW

  const getMousePlanePosFromEvent = useCallback((event: MouseEvent | PointerEvent): THREE.Vector3 | null => {
    if (!r3fStateRef.current || !canvasContainerRef.current) return null;
    const { camera, raycaster } = r3fStateRef.current;
    const bounds = canvasContainerRef.current.getBoundingClientRect();
    const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ndcY = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    const mouseNdc = new THREE.Vector2(ndcX, ndcY);
    raycaster.setFromCamera(mouseNdc, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), point)) {
      return point;
    }
    return null;
  }, []);

  const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
    const worldPos = getMousePlanePosFromEvent(event);
    if (worldPos) {
      onUpdateWireEnd(worldPos.x, worldPos.y);
    }
  }, [getMousePlanePosFromEvent, onUpdateWireEnd]);

  const handleGlobalMouseUp = useCallback((event: MouseEvent) => {
    if (!drawingWire) return;
    console.log("CanvasArea: Global Mouse Up");
    const target = wireTargetRef.current;
    
    if (target && target.nodeId === 'BOUNDARY' && typeof target.portIndex === 'string') {
        console.log("CanvasArea: Finishing wire to BOUNDARY port:", target.portIndex);
        // Directly add the wire connection to the boundary
        const sourceNodeId = drawingWire.sourceNodeId;
        const sourcePortIndex = drawingWire.sourcePortIndex;

        // Validate source port is not already occupied (using wires prop)
        const isSourceOccupied = wires.some(w =>
            (w.sourceNodeId === sourceNodeId && w.sourcePortIndex === sourcePortIndex) ||
            (w.targetNodeId === sourceNodeId && w.targetPortIndex === sourcePortIndex)
        );

        if (isSourceOccupied) {
            console.log("Wire connection failed: Source port already connected.");
        } else {
            // ---> NEW: Check if target boundary port is already connected
            const isBoundaryPortOccupied = wires.some(w => 
                (w.sourceNodeId === 'BOUNDARY' && w.sourcePortIndex === target.portIndex) ||
                (w.targetNodeId === 'BOUNDARY' && w.targetPortIndex === target.portIndex)
            );
            if (isBoundaryPortOccupied) {
                console.log("Wire connection failed: Target boundary port already connected.");
            } else {
            // <--- END NEW
                const newWire: WireConnection = {
                    id: `wire_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                    sourceNodeId: sourceNodeId,
                    sourcePortIndex: sourcePortIndex,
                    targetNodeId: 'BOUNDARY',
                    targetPortIndex: target.portIndex, // Boundary port ID
                    targetLength: null, // No physics length
                };
                console.log("Creating wire to boundary:", newWire);
                setWires(currentWires => [...currentWires, newWire]);
                // Call finishWire with null target to clear the drawing state in App
                onFinishWire(null, null);
            }
        }
    } else if (target && target.nodeId !== 'BOUNDARY' && typeof target.portIndex === 'number') {
        console.log("CanvasArea: Finishing wire to NODE:", target.nodeId, "Port:", target.portIndex);
        // Call App's handler for node-to-node connection
        // Assign to a number variable to satisfy type checker
        const numericPortIndex: number = target.portIndex;
        onFinishWire(target.nodeId as string, numericPortIndex);
    } else {
        console.log("CanvasArea: Finishing wire with no valid target.");
        // No target, call App's handler with null to potentially cancel
        onFinishWire(null, null);
    }
    
    wireTargetRef.current = null; // Clear target ref
    // App's finishWire handles clearing drawingWire state (called above for both node and boundary targets now).
  }, [drawingWire, onFinishWire, setWires, wires]);

  useEffect(() => {
    if (drawingWire) {
      // console.log("Adding global listeners for wire draw (manual line)");
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        // console.log("Removing global listeners for wire draw (manual line)");
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [drawingWire, handleGlobalMouseMove, handleGlobalMouseUp]);

  // ---> UNIFIED Port Event Handlers <---

  // Handles PointerDown on ANY port (Node or Boundary)
  const handlePortPointerDown = useCallback((ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, worldPos: THREE.Vector3, event: ThreeEvent<PointerEvent>) => {
    console.log(`CanvasArea: Port Down on ${ownerId} Port ${portIdOrIndex}`);
    wireTargetRef.current = null; // Clear potential target
    // Call App's startWire - it now handles both source types
    onStartWire(ownerId, portIdOrIndex, worldPos.x, worldPos.y, worldPos.x, worldPos.y);
  }, [onStartWire]);

  // Handles PointerEnter on ANY port
  const handlePortPointerEnter = useCallback((ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => {
    // Only set target if drawing wire
    if (drawingWire) {
      console.log(`CanvasArea: Port Enter on ${ownerId} Port ${portIdOrIndex}`);
      wireTargetRef.current = { nodeId: ownerId, portIndex: portIdOrIndex };
    } else {
      wireTargetRef.current = null;
    }
  }, [drawingWire]);

  // Handles PointerLeave on ANY port
  const handlePortPointerLeave = useCallback((ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<PointerEvent>) => {
    // Clear target only if it matches the port we are leaving
    if (wireTargetRef.current?.nodeId === ownerId && wireTargetRef.current?.portIndex === portIdOrIndex) {
        console.log(`CanvasArea: Port Leave from ${ownerId} Port ${portIdOrIndex}`);
        wireTargetRef.current = null;
    }
  }, []); // drawingWire is implicitly captured

  // Handles ContextMenu on ANY port
  const handlePortContextMenu = useCallback((ownerId: NodeOrBoundaryId, portIdOrIndex: PortIndexOrId, event: ThreeEvent<MouseEvent>) => {
    console.log(`CanvasArea: Port Context Menu on ${ownerId} Port ${portIdOrIndex}`);
    if (ownerId === 'BOUNDARY' && typeof portIdOrIndex === 'string') {
      // If it's a boundary port, delete it
      deleteBoundaryPort(portIdOrIndex);
    } else if (ownerId !== 'BOUNDARY' && typeof ownerId === 'string' && typeof portIdOrIndex === 'number') {
        // If it's a node port, delete the node instance
        console.log(`CanvasArea: Deleting node ${ownerId} via port context menu.`);
        onDeleteNode(ownerId);
    }
    // Add logic for deleting individual wires later if needed
  }, [deleteBoundaryPort, onDeleteNode]);

  // Boundary Click handler remains for creating NEW ports on the boundary circle
  const handleBoundaryClick = useCallback((event: ThreeEvent<MouseEvent>, radius: number) => {
    if (!isBoundaryActive) return;
    
    // Calculate angle from world coordinates of the click
    const point = event.point; 
    const angle = Math.atan2(point.y, point.x);
    
    // Calculate the precise position ON the circle using the angle and radius
    const portX = Math.cos(angle) * radius;
    const portY = Math.sin(angle) * radius;

    // Create unique ID for the new port
    const newPortId = `bport_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    
    const newPort: BoundaryPort = {
        id: newPortId,
        // Use calculated coordinates
        x: portX, 
        y: portY,
        angle: angle // Store calculated angle
    };
    console.log("CanvasArea: Boundary clicked, adding port:", newPort);
    addBoundaryPort(newPort);
  }, [isBoundaryActive, addBoundaryPort]);

  // Set controls enabled state based on wire drawing or node/wire dragging
  const [areControlsEnabled, setAreControlsEnabled] = useState(true);
  const { handleDragStart, handleDragEnd } = useDragControls(setAreControlsEnabled);

  // Effect to update controls enabled based on drawingWire state
  useEffect(() => {
      setAreControlsEnabled(!drawingWire);
      // When drawing stops (drawingWire becomes null), controls are enabled.
      // If a drag starts immediately after (e.g., node drag), handleDragStart will disable them again.
  }, [drawingWire]);

  const findDefinition = useCallback((defId: string): AtomicNodeDefinition | undefined => {
    return atomicNodeDefs.find(def => def.id === defId);
  }, [atomicNodeDefs]);

  // --- Drag and Drop Handler --- // Moved setup outside return
  const getDropWorldPos = useCallback((event: React.DragEvent<HTMLDivElement>): THREE.Vector3 | null => {
    if (!r3fStateRef.current || !canvasContainerRef.current) return null;
    const { camera: camFromRef, raycaster: rayFromRef } = r3fStateRef.current;
    const bounds = canvasContainerRef.current.getBoundingClientRect();
    const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ndcY = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    const mouseNdc = new THREE.Vector2(ndcX, ndcY);
    rayFromRef.setFromCamera(mouseNdc, camFromRef);
    const point = new THREE.Vector3();
    if (rayFromRef.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), point)) return point;
    return null;
  }, [r3fStateRef, canvasContainerRef]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const definitionId = event.dataTransfer?.getData('text/plain');
      if (!definitionId) return;

      const worldPos = getDropWorldPos(event);
      if (worldPos) {
          onAddNode(definitionId, worldPos.x, worldPos.y);
      }
  }, [getDropWorldPos, onAddNode]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
      }
  }, []);
  // --- End Drag and Drop Handler ---

  const orbitControlsRef = useRef<OrbitControlsImpl>(null);

  // Disable OrbitControls zoom when boundary is active
  useEffect(() => {
    if (orbitControlsRef.current) {
      (orbitControlsRef.current as any).enableZoom = !isBoundaryActive;
    }
  }, [isBoundaryActive]);

  // --- R3F State and Camera Updates ---
  const R3FStateUpdater = () => {
    const state = useThree();
    useEffect(() => {
      if (state.camera instanceof THREE.OrthographicCamera) {
        r3fStateRef.current = { camera: state.camera, raycaster: state.raycaster };
        setCurrentZoom(state.camera.zoom);
      } else {
        console.error("Camera is not an OrthographicCamera!");
      }
    }, [state.camera, state.raycaster]);

    useFrame(() => {
      if (orbitControlsRef.current && r3fStateRef.current?.camera) {
        const newZoom = r3fStateRef.current.camera.zoom;
        if (newZoom !== currentZoom) {
          setCurrentZoom(newZoom);
        }
      }
    });

    return null;
  };
  // --- End R3F State ---

  // ---> NEW: Dummy Boundary Node Definition for PhysicsWire
  const DUMMY_BOUNDARY_DEFINITION: AtomicNodeDefinition = {
      id: "__BOUNDARY__",
      name: "Boundary",
      color: "#000000", // Not used visually by PhysicsWire
      principalPorts: 0,
      nonPrincipalPorts: 0,
      metadataSchema: []
  };
  // <--- END NEW

  return (
    <div
      id="canvas-area"
      ref={canvasContainerRef}
      className="canvas-container"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      // Comment out logging that could be flooding the console
      /*
      onMouseDown={(e) => {
        console.log('Canvas container mouse down', e);
      }}
      onMouseMove={(e) => {
        console.log('Canvas container mouse move', { x: e.clientX, y: e.clientY });
      }}
      */
    >
      <Canvas 
        orthographic 
        camera={{ zoom: 50, position: [0, 0, 100] }}
        /*
        onPointerDown={(e) => {
          console.log('Canvas pointer down', e);
        }}
        onPointerMove={(e) => {
          // Only log occasionally to avoid flooding the console
          if (Math.random() < 0.05) {
            console.log('Canvas pointer move', { x: e.clientX, y: e.clientY });
          }
        }}
        onPointerMissed={(e) => {
          console.log('Canvas pointer missed', e);
        }}
        */
      >
        <R3FStateUpdater />
        <OrbitControls
          ref={orbitControlsRef}
          enableZoom={!isBoundaryActive}
          enableRotate={false}
          enablePan={areControlsEnabled}
          makeDefault
          panSpeed={1.5}
          zoomSpeed={1.0}
          minPolarAngle={Math.PI / 2}
          maxPolarAngle={Math.PI / 2}
          mouseButtons={{ 
            LEFT: 2,  // Map left mouse button to panning
            MIDDLE: 1,
            RIGHT: 0 
          }}
          screenSpacePanning={true}
        />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <Suspense fallback={null}>
          <Physics gravity={[0, 0, 0]}>
            {canvasNodes.map(instance => {
              const definition = findDefinition(instance.definitionId);
              if (!definition) return null;
              // Ensure a ref exists for each node
              if (!nodeRefs.current.has(instance.instanceId)) {
                   nodeRefs.current.set(instance.instanceId, React.createRef<RapierRigidBody>() as React.RefObject<RapierRigidBody>);
              }
              const nodeRef = nodeRefs.current.get(instance.instanceId)!;
              return (
                <PhysicsNode
                  key={instance.instanceId}
                  ref={nodeRef}
                  instance={instance}
                  definition={definition}
                  wires={wires}
                  onDelete={onDeleteNode}
                  onPortPointerDown={handlePortPointerDown}
                  onPortPointerEnter={handlePortPointerEnter}
                  onPortPointerLeave={handlePortPointerLeave}
                  onPortContextMenu={handlePortContextMenu}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onUpdatePhysicsData={onUpdateNodePhysicsData}
                />
              );
            })}
            {wires.map(wire => {
                let sourceRef: React.RefObject<RapierRigidBody | null> | undefined = undefined;
                let targetRef: React.RefObject<RapierRigidBody | null> | undefined = undefined;
                let sourceDef: AtomicNodeDefinition | undefined = undefined;
                let targetDef: AtomicNodeDefinition | undefined = undefined;
                let sourcePortIdx: number = 0; // Default, will be overwritten
                let targetPortIdx: number = 0; // Default, will be overwritten
                let skip = false;

                // --- Determine Source Ref and Definition ---
                if (wire.sourceNodeId === 'BOUNDARY') {
                    sourceRef = boundaryPortBodyRefs.current.get(wire.sourcePortIndex as string);
                    sourceDef = DUMMY_BOUNDARY_DEFINITION;
                    // sourcePortIdx remains 0 (not used for boundary dummy)
                } else {
                    sourceRef = nodeRefs.current.get(wire.sourceNodeId as string);
                    sourceDef = findDefinition(canvasNodes.find(n => n.instanceId === wire.sourceNodeId)?.definitionId ?? '');
                    sourcePortIdx = wire.sourcePortIndex as number; // Is a number for nodes
                }

                // --- Determine Target Ref and Definition ---
                if (wire.targetNodeId === 'BOUNDARY') {
                    targetRef = boundaryPortBodyRefs.current.get(wire.targetPortIndex as string);
                    targetDef = DUMMY_BOUNDARY_DEFINITION;
                    // targetPortIdx remains 0 (not used for boundary dummy)
                } else {
                    targetRef = nodeRefs.current.get(wire.targetNodeId as string);
                    targetDef = findDefinition(canvasNodes.find(n => n.instanceId === wire.targetNodeId)?.definitionId ?? '');
                    targetPortIdx = wire.targetPortIndex as number; // Is a number for nodes
                }

                // --- Validation --- 
                if (!sourceRef || !sourceRef.current || !targetRef || !targetRef.current) {
                    // console.warn(`Skipping wire ${wire.id}: Missing physics body refs.`);
                    return null;
                }
                
                // Check definitions (TypeScript should narrow types after this)
                if (!sourceDef || !targetDef) {
                    // console.warn(`Skipping wire ${wire.id}: Missing node definitions.`);
                    return null;
                }
                
                // Check port indices validity for non-boundary
                if ((wire.sourceNodeId !== 'BOUNDARY' && typeof wire.sourcePortIndex !== 'number') ||
                    (wire.targetNodeId !== 'BOUNDARY' && typeof wire.targetPortIndex !== 'number')) {
                    // console.warn(`Skipping wire ${wire.id}: Invalid port index types.`);
                    return null;
                }

                // --- Render PhysicsWire --- 
                // Refs, Defs, and Port Indices are validated and non-null/correct type here
                return (
                  <PhysicsWire
                    key={wire.id}
                    wireId={wire.id}
                    sourceNodeRef={sourceRef as React.RefObject<RapierRigidBody>} // Cast safe after check
                    targetNodeRef={targetRef as React.RefObject<RapierRigidBody>} // Cast safe after check
                    sourceDefinition={sourceDef}
                    targetDefinition={targetDef}
                    // Pass the numeric index for nodes, 0 for boundary
                    sourcePortIndex={sourcePortIdx}
                    targetPortIndex={targetPortIdx}
                    targetLength={wire.targetLength}
                    onDeleteWire={onDeleteWire}
                    onUpdateWireLength={onUpdateWireLength}
                    onDragStart={handleDragStart} // Pass drag handlers if wire is draggable
                    onDragEnd={handleDragEnd}
                  />
                );
            })}
            {isBoundaryActive && (
                <Boundary
                    wires={wires}
                    ports={boundaryPorts}
                    onBoundaryClick={handleBoundaryClick}
                    onPortPointerDown={handlePortPointerDown}
                    onPortPointerEnter={handlePortPointerEnter}
                    onPortPointerLeave={handlePortPointerLeave}
                    onPortContextMenu={handlePortContextMenu}
                    cameraZoom={currentZoom}
                    registerPortBodyRef={registerBoundaryPortBodyRef}
                    unregisterPortBodyRef={unregisterBoundaryPortBodyRef}
                />
            )}
          </Physics>
        </Suspense>

        <ManualDrawingLine drawingWire={drawingWire} />
      </Canvas>
    </div>
  );
};

export default CanvasArea; 