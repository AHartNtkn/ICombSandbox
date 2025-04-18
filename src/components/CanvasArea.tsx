import React, { useRef, Suspense, useEffect, useState, useCallback, MutableRefObject, Dispatch, SetStateAction, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Physics, RapierRigidBody } from '@react-three/rapier';
import { OrbitControls, Line } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { AtomicNodeDefinition, CanvasNodeInstance, WireConnection, DrawingWireState, BoundaryPort, NodeOrBoundaryId, PortIndexOrId, DefinitionDefinition } from '../types';
import { getPortBoundaryLocalOffset } from '../utils/geometry';
import PhysicsNode from './PhysicsNode';
import ManualDrawingLine from './ManualDrawingLine';
import PhysicsWire from './PhysicsWire';
import './CanvasArea.css';
import Boundary from './Boundary';
import { ThreeEvent } from '@react-three/fiber';
import MetadataPopup from './MetadataPopup';

interface CanvasAreaProps {
  atomicNodeDefs: AtomicNodeDefinition[];
  definitionDefs: DefinitionDefinition[];
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
  onAddDefinitionClick: () => void;
  onExpandDefinition?: (instanceId: string) => void;
  onUpdateInstanceMetadata: (instanceId: string, newValues: Record<string, string | number | boolean>, newVisibility: Record<string, boolean>) => void;
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

const CanvasArea: React.FC<CanvasAreaProps> = ({ atomicNodeDefs, definitionDefs, canvasNodes, wires, drawingWire, onAddNode, onDeleteNode, onStartWire, onUpdateWireEnd, onFinishWire, onDeleteWire, onUpdateWireLength, onUpdateNodePhysicsData, isBoundaryActive, boundaryPorts, addBoundaryPort, deleteBoundaryPort, setWires, onAddDefinitionClick, onExpandDefinition, onUpdateInstanceMetadata }) => {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const wireTargetRef = useRef<{ nodeId: NodeOrBoundaryId; portIndex: PortIndexOrId } | null>(null);

  const r3fStateRef = useRef<{ camera: THREE.OrthographicCamera, raycaster: THREE.Raycaster } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(50);

  // Store refs to the PhysicsNode components using a ref map
  const nodeRefs = useRef<Map<string, React.RefObject<RapierRigidBody>>>(new Map());
  // ---> NEW: Store refs for boundary port physics bodies
  const boundaryPortBodyRefs = useRef<Map<string, React.RefObject<RapierRigidBody | null>>>(new Map());
  // <--- END NEW

  // ---> NEW: State to trigger re-renders when refs become ready/destroyed
  const [refsReadyTrigger, setRefsReadyTrigger] = useState(0);

  const handleRefReady = useCallback((instanceId: string, ref: React.RefObject<RapierRigidBody | null>) => {
    if (ref.current) { // Only store if the ref.current is valid
        console.log(`[CanvasArea handleRefReady] Ref ready for ${instanceId}`);
        nodeRefs.current.set(instanceId, ref as React.RefObject<RapierRigidBody>); // Cast is safe here
        // Trigger re-render to ensure components using the ref update
        setRefsReadyTrigger(prev => prev + 1);
    } else {
        console.warn(`[CanvasArea handleRefReady] Received ready signal for ${instanceId}, but ref.current is null.`);
    }
  }, []);

  const handleRefDestroyed = useCallback((instanceId: string) => {
    console.log(`[CanvasArea handleRefDestroyed] Ref destroyed for ${instanceId}`);
    const deleted = nodeRefs.current.delete(instanceId);
    if (deleted) {
         // Optionally trigger re-render if deletion needs to reflect immediately
         // setRefsReadyTrigger(prev => prev + 1);
    }
  }, []);
  // <--- END NEW

  // ---> NEW: Metadata Popup State and Handlers
  const [metadataPopupState, setMetadataPopupState] = useState<{ instanceId: string, screenX: number, screenY: number } | null>(null);

  const handleOpenMetadataPopup = useCallback((instanceId: string, event: ThreeEvent<MouseEvent>) => {
      // Make sure the event has client coordinates
      if (event.clientX && event.clientY) {
        console.log(`Opening metadata popup for ${instanceId} at (${event.clientX}, ${event.clientY})`);
        setMetadataPopupState({ instanceId, screenX: event.clientX, screenY: event.clientY });
      } else {
        console.warn("Could not open metadata popup: Event missing client coordinates.");
      }
  }, []);

  const handleCloseMetadataPopup = useCallback(() => {
      setMetadataPopupState(null);
  }, []);

  const handleSaveMetadata = useCallback((instanceId: string, newValues: Record<string, string | number | boolean>, newVisibility: Record<string, boolean>) => {
      onUpdateInstanceMetadata(instanceId, newValues, newVisibility);
      handleCloseMetadataPopup();
  }, [onUpdateInstanceMetadata, handleCloseMetadataPopup]);
  // <--- END NEW

  const getMousePlanePosFromEvent = useCallback((event: MouseEvent | PointerEvent): THREE.Vector3 | null => {
    // Log available refs at the start of render
    console.log("[CanvasArea Render Start] nodeRefs keys:", Array.from(nodeRefs.current.keys()), "boundaryPortBodyRefs keys:", Array.from(boundaryPortBodyRefs.current.keys()));

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

  const findAtomicDef = useCallback((defId: string): AtomicNodeDefinition | undefined => {
    return atomicNodeDefs.find(def => def.id === defId);
  }, [atomicNodeDefs]);

  // ---> NEW: Find definition definition
  const findDefinitionDef = useCallback((defId: string): DefinitionDefinition | undefined => {
    return definitionDefs.find(def => def.id === defId);
  }, [definitionDefs]);
  // --- <------

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

  // ---> NEW: Callbacks for Boundary to register/unregister its port body refs
  const registerBoundaryPortBodyRef = useCallback((portId: string, ref: React.RefObject<RapierRigidBody | null>) => {
      // console.log(`CanvasArea: Registering boundary port ref ${portId}`);
      boundaryPortBodyRefs.current.set(portId, ref);
  }, []);

  const unregisterBoundaryPortBodyRef = useCallback((portId: string) => {
      boundaryPortBodyRefs.current.delete(portId);
  }, []);

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
              const definition = instance.isDefinitionInstance
                ? findDefinitionDef(instance.definitionId)
                : findAtomicDef(instance.definitionId);

              if (!definition) {
                console.warn(`Could not find definition (atomic or definition) for instance ${instance.instanceId} with defId ${instance.definitionId}`);
                return null;
              }
              // No need to pre-create refs here, handleRefReady manages the map
              return (
                <PhysicsNode
                  key={instance.instanceId}
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
                  onDoubleClick={onExpandDefinition}
                  onRefReady={handleRefReady}
                  onRefDestroyed={handleRefDestroyed}
                  onOpenMetadataPopup={handleOpenMetadataPopup}
                />
              );
            })}
            {wires.map(wire => {
                let sourceRef: React.RefObject<RapierRigidBody | null> | undefined = undefined;
                let targetRef: React.RefObject<RapierRigidBody | null> | undefined = undefined;
                let sourceDef: AtomicNodeDefinition | DefinitionDefinition | undefined = undefined;
                let targetDef: AtomicNodeDefinition | DefinitionDefinition | undefined = undefined;
                let sourcePortIdx: number = 0; // Default, will be overwritten
                let targetPortIdx: number = 0; // Default, will be overwritten

                // --- Determine Source Ref and Definition ---
                console.log(`[CanvasArea Render] Processing wire ${wire.id} (${wire.sourceNodeId} -> ${wire.targetNodeId})`);
                if (wire.sourceNodeId === 'BOUNDARY') {
                    sourceRef = boundaryPortBodyRefs.current.get(wire.sourcePortIndex as string);
                    sourceDef = DUMMY_BOUNDARY_DEFINITION;
                    // sourcePortIdx remains 0 (not used for boundary dummy)
                } else {
                    // Find the instance first
                    const sourceInstance = canvasNodes.find(n => n.instanceId === wire.sourceNodeId);
                    console.log(`[CanvasArea Render] Wire ${wire.id}: Found source instance ${wire.sourceNodeId}?`, !!sourceInstance);
                    sourceRef = nodeRefs.current.get(wire.sourceNodeId as string);
                    if (sourceInstance) {
                        sourceDef = sourceInstance.isDefinitionInstance
                            ? findDefinitionDef(sourceInstance.definitionId)
                            : findAtomicDef(sourceInstance.definitionId);
                    } else {
                        console.warn(`Wire ${wire.id} source instance ${wire.sourceNodeId} not found.`);
                    }
                    sourcePortIdx = wire.sourcePortIndex as number; // Is a number for nodes
                }

                // --- Determine Target Ref and Definition ---
                if (wire.targetNodeId === 'BOUNDARY') {
                    targetRef = boundaryPortBodyRefs.current.get(wire.targetPortIndex as string);
                    targetDef = DUMMY_BOUNDARY_DEFINITION;
                    // targetPortIdx remains 0 (not used for boundary dummy)
                } else {
                    // Find the instance first
                    const targetInstance = canvasNodes.find(n => n.instanceId === wire.targetNodeId);
                    console.log(`[CanvasArea Render] Wire ${wire.id}: Found target instance ${wire.targetNodeId}?`, !!targetInstance);
                    targetRef = nodeRefs.current.get(wire.targetNodeId as string);
                    if (targetInstance) {
                        targetDef = targetInstance.isDefinitionInstance
                            ? findDefinitionDef(targetInstance.definitionId)
                            : findAtomicDef(targetInstance.definitionId);
                    } else {
                        console.warn(`Wire ${wire.id} target instance ${targetInstance} not found.`);
                    }
                    targetPortIdx = wire.targetPortIndex as number; // Is a number for nodes
                }

                // --- NEW CHECK: Ensure refs are populated before rendering wire ---
                // Re-lookup refs based on IDs determined above
                console.log(`[CanvasArea Render Wire ${wire.id}] Checking refs. Source expects: ${wire.sourceNodeId}, Target expects: ${wire.targetNodeId}`);
                const currentSourceRef = wire.sourceNodeId === 'BOUNDARY'
                    ? boundaryPortBodyRefs.current.get(wire.sourcePortIndex as string)
                    : nodeRefs.current.get(wire.sourceNodeId as string);
                const currentTargetRef = wire.targetNodeId === 'BOUNDARY'
                    ? boundaryPortBodyRefs.current.get(wire.targetPortIndex as string)
                    : nodeRefs.current.get(wire.targetNodeId as string);
                
                // Check if refs *and* their .current property are valid *before* rendering PhysicsWire
                if (!currentSourceRef?.current || !currentTargetRef?.current) {
                    console.warn(`[CanvasArea Render] Delaying wire ${wire.id} render: Refs not yet available. Source valid: ${!!currentSourceRef?.current}, Target valid: ${!!currentTargetRef?.current}`);
                    // Return null to skip rendering this wire in this cycle.
                    // It should render correctly in the next cycle once refs are populated.
                    return null;
                }
                // --- END NEW CHECK ---

                // --- Validation (definition and port index checks remain) ---
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

                // --- Render PhysicsWire (Refs are now confirmed valid) ---
                return (
                  <PhysicsWire
                    key={wire.id}
                    wireId={wire.id}
                    sourceNodeRef={currentSourceRef as React.RefObject<RapierRigidBody>} // Cast is safe now
                    targetNodeRef={currentTargetRef as React.RefObject<RapierRigidBody>} // Cast is safe now
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
      
      {/* Metadata Popup Rendering */}
      {metadataPopupState && (() => {
          const instance = canvasNodes.find(n => n.instanceId === metadataPopupState.instanceId);
          // Ensure it's an atomic node instance
          const definition = instance && !instance.isDefinitionInstance 
              ? findAtomicDef(instance.definitionId) 
              : undefined; 
          
          if (!instance || !definition) {
              // This might happen briefly if the node is deleted while popup is open
              // Or if somehow it was opened for a non-atomic node. Close it.
              if (metadataPopupState) { // Avoid potential loop if already null
                  handleCloseMetadataPopup();
              }
              return null;
          }

          return (
              <MetadataPopup
                  key={instance.instanceId} // Ensure re-render if instance changes
                  definition={definition}
                  initialValues={instance.metadataValues || {}} // Pass current or empty values
                  initialVisibility={instance.metadataVisibility || {}} // Pass current or empty visibility
                  screenX={metadataPopupState.screenX}
                  screenY={metadataPopupState.screenY}
                  onSave={(newValues, newVisibility) => handleSaveMetadata(instance.instanceId, newValues, newVisibility)}
                  onClose={handleCloseMetadataPopup}
              />
          );
      })()}
    </div>
  );
};

export default CanvasArea;