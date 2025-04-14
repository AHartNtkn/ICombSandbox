import React, { useRef, Suspense, useEffect, useState, useCallback, MutableRefObject } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Physics, RapierRigidBody } from '@react-three/rapier';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { AtomicNodeDefinition, CanvasNodeInstance, WireConnection, DrawingWireState } from '../types';
import PhysicsNode from './PhysicsNode';
import ManualDrawingLine from './ManualDrawingLine';
import PhysicsWire from './PhysicsWire';
import './CanvasArea.css';

interface CanvasAreaProps {
  atomicNodeDefs: AtomicNodeDefinition[];
  canvasNodes: CanvasNodeInstance[];
  wires: WireConnection[];
  drawingWire: DrawingWireState | null;
  onAddNode: (definitionId: string, x: number, y: number) => void;
  onDeleteNode: (instanceId: string) => void;
  onStartWire: (sourceNodeId: string, sourcePortIndex: number, startX: number, startY: number, currentMouseX: number, currentMouseY: number) => void;
  onUpdateWireEnd: (currentMouseX: number, currentMouseY: number) => void;
  onFinishWire: (targetNodeId: string | null, targetPortIndex: number | null) => void;
  onDeleteWire?: (wireId: string) => void;
  onUpdateWireLength?: (wireId: string, newLength: number) => void;
  onUpdateNodePhysicsData?: (instanceId: string, position: THREE.Vector3, rotation: THREE.Quaternion) => void;
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

const CanvasArea: React.FC<CanvasAreaProps> = ({ atomicNodeDefs, canvasNodes, wires, drawingWire, onAddNode, onDeleteNode, onStartWire, onUpdateWireEnd, onFinishWire, onDeleteWire, onUpdateWireLength, onUpdateNodePhysicsData }) => {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const wireTargetRef = useRef<{ nodeId: string; portIndex: number } | null>(null);

  const r3fStateRef = useRef<{ camera: THREE.Camera, raycaster: THREE.Raycaster } | null>(null);
  const R3FStateUpdater = () => {
    const { camera, raycaster } = useThree();
    useEffect(() => {
      r3fStateRef.current = { camera, raycaster };
    });
    return null;
  };

  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));

  // Store refs to the PhysicsNode components (forwarded ref)
  const nodeRefs = useRef<Map<string, React.RefObject<RapierRigidBody>>>(new Map());

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

  const getMousePlanePosFromEvent = useCallback((event: MouseEvent | PointerEvent): THREE.Vector3 | null => {
    if (!r3fStateRef.current || !canvasContainerRef.current) return null;
    const { camera, raycaster } = r3fStateRef.current;
    const bounds = canvasContainerRef.current.getBoundingClientRect();
    const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const ndcY = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    const mouseNdc = new THREE.Vector2(ndcX, ndcY);
    raycaster.setFromCamera(mouseNdc, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(planeRef.current, point)) {
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
    console.log("Global Mouse Up - Finishing Wire (physics wire)");
    const target = wireTargetRef.current;
    onFinishWire(target?.nodeId ?? null, target?.portIndex ?? null);
    wireTargetRef.current = null;
  }, [drawingWire, onFinishWire]);

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

  const handlePortDown = (instanceId: string, portIndex: number, portWorldPos: THREE.Vector3) => {
    console.log(`Port Down: ${instanceId} Port ${portIndex}`);
    wireTargetRef.current = null;
    onStartWire(instanceId, portIndex, portWorldPos.x, portWorldPos.y, portWorldPos.x, portWorldPos.y);
  };

  const handlePortEnter = (instanceId: string, portIndex: number) => {
    // console.log(`Port Enter: Node ${instanceId}, Port ${portIndex}`);
    if (drawingWire && drawingWire.sourceNodeId !== instanceId) {
      wireTargetRef.current = { nodeId: instanceId, portIndex };
    } else {
      wireTargetRef.current = null;
    }
  };

  const handlePortLeave = () => {
    // console.log("Port Leave");
    wireTargetRef.current = null;
  };

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
    if (rayFromRef.ray.intersectPlane(planeRef.current, point)) return point;
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

  const orbitControlsRef = useRef(null);

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
          enableZoom={true}
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
                  onPortPointerDown={handlePortDown}
                  onPortPointerEnter={handlePortEnter}
                  onPortPointerLeave={handlePortLeave}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onUpdatePhysicsData={onUpdateNodePhysicsData}
                />
              );
            })}
            {wires.map(wire => {
                 const sourceDef = findDefinition(canvasNodes.find(n => n.instanceId === wire.sourceNodeId)?.definitionId ?? '');
                 const targetDef = findDefinition(canvasNodes.find(n => n.instanceId === wire.targetNodeId)?.definitionId ?? '');
                 // Get refs directly from the map
                 const sourceNodeRef = nodeRefs.current.get(wire.sourceNodeId);
                 const targetNodeRef = nodeRefs.current.get(wire.targetNodeId);

                 // Check definitions and refs
                 if (!sourceDef || !targetDef || !sourceNodeRef || !targetNodeRef) {
                     // console.warn(`PhysicsWire ${wire.id}: Missing def or ref for source/target node.`);
                     return null;
                 }

                 return (
                    <PhysicsWire
                        key={wire.id}
                        wireId={wire.id}
                        sourcePortIndex={wire.sourcePortIndex}
                        targetPortIndex={wire.targetPortIndex}
                        sourceDefinition={sourceDef}
                        targetDefinition={targetDef}
                        // Pass the refs
                        sourceNodeRef={sourceNodeRef}
                        targetNodeRef={targetNodeRef}
                        onDeleteWire={onDeleteWire}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        targetLength={wire.targetLength}
                        onUpdateWireLength={onUpdateWireLength}
                    />
                 );
            })}
          </Physics>
        </Suspense>
        <ManualDrawingLine drawingWire={drawingWire} />
      </Canvas>
    </div>
  );
};

export default CanvasArea; 