import React, { useState, ChangeEvent, KeyboardEvent, FocusEvent, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three'; // Import THREE
import './App.css'
import { WorkspaceData, AtomicNodeDefinition, CanvasNodeInstance, WireConnection, DrawingWireState, NodeOrBoundaryId, PortIndexOrId, BoundaryPort, DefinitionDefinition, ExternalPort } from './types'; // Import WireConnection
import LeftSidebar from './components/LeftSidebar'; // Import new component
import CanvasArea from './components/CanvasArea'; // Import new component
import DefinitionForm from './components/DefinitionForm.tsx'; // Import form
import Modal from './components/Modal'; // Import modal
import { getPortBoundaryLocalOffset } from './utils/geometry'; // Import utility

function App() {
  const [title, setTitle] = useState<string>('Untitled');
  const [atomicNodes, setAtomicNodes] = useState<AtomicNodeDefinition[]>([]); // State for atomic nodes
  const [canvasNodes, setCanvasNodes] = useState<CanvasNodeInstance[]>([]); // State for canvas nodes
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for the hidden file input
  const [wires, setWires] = useState<WireConnection[]>([]); // State for wires
  const [drawingWire, setDrawingWire] = useState<DrawingWireState | null>(null); // State for temporary wire
  const isFinishingWire = useRef(false); // Add ref to prevent double execution
  const [isBoundaryActive, setIsBoundaryActive] = useState<boolean>(false);
  const [boundaryPorts, setBoundaryPorts] = useState<BoundaryPort[]>([]);
  // --- New State ---
  const [definitions, setDefinitions] = useState<DefinitionDefinition[]>([]);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'atomic' | 'definitions'>('atomic');
  const [isDefinitionModalOpen, setIsDefinitionModalOpen] = useState<boolean>(false);
  // Store canvas state at the time "Add Definition" was clicked
  const [definitionCandidate, setDefinitionCandidate] = useState<{ nodes: CanvasNodeInstance[], wires: WireConnection[], ports: BoundaryPort[] } | null>(null);

  // Ref to store node positions/rotations for length calculation
  // We might need a more robust way if nodes aren't rendered immediately
  const nodePhysicsData = useRef<Map<string, { position: THREE.Vector3, rotation: THREE.Quaternion }>>(new Map());

  // Callback passed to PhysicsNode to update its data
  // This is a bit complex, ideally physics state lives closer to physics components
  const updateNodePhysicsData = useCallback((instanceId: string, position: THREE.Vector3, rotation: THREE.Quaternion) => {
      nodePhysicsData.current.set(instanceId, { position, rotation });
  }, []);

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
  };

  const handleTitleBlur = (event: FocusEvent<HTMLInputElement>) => {
    // Check if relatedTarget is null or not part of the input itself
    // Prevents blur when focus momentarily leaves/returns during interaction
    if (!event.relatedTarget || event.relatedTarget !== event.target) {
        setIsEditingTitle(false);
        if (title.trim() === '') {
            setTitle('Untitled'); // Reset if empty
        }
    }
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      setIsEditingTitle(false);
      if (title.trim() === '') {
        setTitle('Untitled'); // Reset if empty
      }
    }
  };

  const handleDoubleClick = () => {
    setIsEditingTitle(true);
  };

  // --- Atomic Node Handling ---
  const addAtomicNode = useCallback((newNode: AtomicNodeDefinition) => {
    setAtomicNodes((prevNodes) => [...prevNodes, newNode]);
  }, []);

  const deleteAtomicNode = useCallback((definitionIdToDelete: string) => {
    setAtomicNodes((prevNodes) =>
      prevNodes.filter((node) => node.id !== definitionIdToDelete)
    );
    setCanvasNodes((prevCanvasNodes) =>
        prevCanvasNodes.filter((instance) => instance.definitionId !== definitionIdToDelete)
    );
  }, []);

  // --- Canvas Node Handling ---
  const addNodeToCanvas = useCallback((definitionOrAtomicId: string, x: number, y: number) => {
    let isDefinition = false;
    let actualId = definitionOrAtomicId;

    if (definitionOrAtomicId.startsWith('definition:')) {
        isDefinition = true;
        actualId = definitionOrAtomicId.substring('definition:'.length);
        // Optional: Verify actualId exists in definitions state
        if (!definitions.some(def => def.id === actualId)) {
            console.error(`Attempted to add definition instance with unknown ID: ${actualId}`);
            return;
        }
    } else {
        // Optional: Verify actualId exists in atomicNodes state
        if (!atomicNodes.some(def => def.id === actualId)) {
            console.error(`Attempted to add atomic node instance with unknown ID: ${actualId}`);
            return;
        }
    }

    const newNodeInstance: CanvasNodeInstance = {
      instanceId: `inst_${Date.now()}_${Math.random().toString(16).slice(2)}`, // Unique instance ID
      definitionId: actualId, // Use the extracted ID
      x,
      y,
      ...(isDefinition && { isDefinitionInstance: true }) // Add flag if it's a definition
    };
    setCanvasNodes((prevCanvasNodes) => [...prevCanvasNodes, newNodeInstance]);
  }, [definitions, atomicNodes]); // Add definitions and atomicNodes as dependencies

  const deleteCanvasNode = useCallback((instanceIdToDelete: string) => {
    // Delete the node instance
    setCanvasNodes((prevCanvasNodes) =>
      prevCanvasNodes.filter((instance) => instance.instanceId !== instanceIdToDelete)
    );
    // Also delete any wires connected to this node
    setWires((prevWires) =>
      prevWires.filter(w => w.sourceNodeId !== instanceIdToDelete && w.targetNodeId !== instanceIdToDelete)
    );
  }, [setCanvasNodes, setWires]); // Add setWires as dependency

  // --- Wire Handling (Updated for Boundary Source) ---
  // startWire now accepts boundary source types
  const startWire = useCallback((sourceNodeId: NodeOrBoundaryId, sourcePortIndex: PortIndexOrId, startX: number, startY: number, currentMouseX: number, currentMouseY: number) => {
    console.log(`Start wire from ${sourceNodeId} port ${sourcePortIndex}`);
    // Set state regardless of source type
    setDrawingWire({
        sourceNodeId: sourceNodeId,
        sourcePortIndex: sourcePortIndex,
        startX,
        startY,
        endX: currentMouseX,
        endY: currentMouseY
    });
  }, []);

  const updateWireEnd = useCallback((currentMouseX: number, currentMouseY: number) => {
    // Update end coordinates for the visual line
    if (!drawingWire) return;
    // console.log(`Update wire end to ${currentMouseX}, ${currentMouseY}`);
    setDrawingWire(prev => prev ? { ...prev, endX: currentMouseX, endY: currentMouseY } : null);
  }, [drawingWire]);

  // finishWire refactored for Boundary source/target
  const finishWire = useCallback((targetNodeId: NodeOrBoundaryId | null, targetPortIndex: PortIndexOrId | null) => {
    if (isFinishingWire.current) return;
    isFinishingWire.current = true;

    const currentDrawingWire = drawingWire;
    setDrawingWire(null);

    if (!currentDrawingWire) {
        console.log("finishWire called but drawingWire was null. Skipping.");
        isFinishingWire.current = false;
        return;
    }

    const { sourceNodeId, sourcePortIndex } = currentDrawingWire;
    console.log(`Finish wire. Source: ${sourceNodeId}:${sourcePortIndex}, Target: ${targetNodeId}:${targetPortIndex}`);

    // --- Rule out invalid combinations --- 
    if (targetNodeId === null || targetPortIndex === null) {
        console.log("Wire cancelled: No valid target.");
    } else if (sourceNodeId === targetNodeId && sourcePortIndex === targetPortIndex) {
        console.log("Wire connection failed: Cannot connect port to itself.");
    } else {
        // --- Check Port Occupancy --- 
        const isSourceOccupied = wires.some(w =>
            (w.sourceNodeId === sourceNodeId && w.sourcePortIndex === sourcePortIndex) ||
            (w.targetNodeId === sourceNodeId && w.targetPortIndex === sourcePortIndex)
        );
        const isTargetOccupied = wires.some(w =>
            (w.sourceNodeId === targetNodeId && w.sourcePortIndex === targetPortIndex) ||
            (w.targetNodeId === targetNodeId && w.targetPortIndex === targetPortIndex)
        );

        if (isSourceOccupied) {
            console.log("Wire connection failed: Source port already connected.");
        } else if (isTargetOccupied) {
            console.log("Wire connection failed: Target port already connected.");
        } else {
            // --- Create Wire (Validation passed) --- 
            let initialLength: number | null = null;
            // Calculate length ONLY for node-to-node connections
            if (sourceNodeId !== 'BOUNDARY' && targetNodeId !== 'BOUNDARY') {
                const sourceNodeDef = atomicNodes.find(def => canvasNodes.find(cn => cn.instanceId === sourceNodeId)?.definitionId === def.id);
                const targetNodeDef = atomicNodes.find(def => canvasNodes.find(cn => cn.instanceId === targetNodeId)?.definitionId === def.id);
                const sourcePhysData = nodePhysicsData.current.get(sourceNodeId as string); // Cast safe
                const targetPhysData = nodePhysicsData.current.get(targetNodeId as string); // Cast safe

                if (sourceNodeDef && targetNodeDef && sourcePhysData && targetPhysData) {
                    const sourceLocalOffset = getPortBoundaryLocalOffset(sourceNodeDef, sourcePortIndex as number); // Cast safe
                    const targetLocalOffset = getPortBoundaryLocalOffset(targetNodeDef, targetPortIndex as number); // Cast safe
                    const sourcePos = sourcePhysData.position.clone().add(sourceLocalOffset.clone().applyQuaternion(sourcePhysData.rotation));
                    const targetPos = targetPhysData.position.clone().add(targetLocalOffset.clone().applyQuaternion(targetPhysData.rotation));
                    initialLength = sourcePos.distanceTo(targetPos);
                    console.log("Calculated node-to-node wire length:", initialLength);
                }
            }

            const newWire: WireConnection = {
                id: `wire_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                sourceNodeId: sourceNodeId,
                sourcePortIndex: sourcePortIndex,
                targetNodeId: targetNodeId,
                targetPortIndex: targetPortIndex,
                targetLength: initialLength,
            };
            console.log("Wire created:", newWire);
            setWires(currentWires => [...currentWires, newWire]);
        }
    }

    // Reset the re-entry flag
    setTimeout(() => { isFinishingWire.current = false; }, 0);

  }, [drawingWire, wires, setWires, atomicNodes, canvasNodes]); // Removed setDrawingWire (handled internally)

  // deleteWire depends only on setWires (stable)
  const deleteWire = useCallback((wireIdToDelete: string) => {
    console.log(`Deleting wire ${wireIdToDelete}`);
    setWires(prev => prev.filter(w => w.id !== wireIdToDelete));
  }, [setWires]);

  // --- Add Wire Length Update Handler ---
  const handleUpdateWireLength = useCallback((wireId: string, newLength: number) => {
      setWires(currentWires =>
          currentWires.map(wire =>
              wire.id === wireId
                  ? { ...wire, targetLength: newLength }
                  : wire
          )
      );
  }, [setWires]);
  // --- End Wire Handling ---

  // --- Import/Export Handlers ---
  const handleExport = () => {
    const data: WorkspaceData = {
      title: title,
      atomicNodes: atomicNodes,
      canvasNodes: canvasNodes,
      wires: wires, // Include wires
      definitions: definitions, // Include definitions
    };

    const jsonString = JSON.stringify(data, null, 2); // Pretty print JSON
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = title.trim().replace(/\s+/g, '_') || 'untitled';
    link.download = `${filename}_workspace.json`; // Dynamic filename
    document.body.appendChild(link); // Required for Firefox
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click(); // Trigger the hidden file input
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') {
          throw new Error('Failed to read file content.');
        }
        const jsonData: WorkspaceData = JSON.parse(text);

        // --- Title Update ---
        if (typeof jsonData.title === 'string') {
          setTitle(jsonData.title || 'Untitled');
        } else {
          console.warn('Imported JSON missing or invalid title. Using default.');
          setTitle('Untitled');
        }

        // --- Atomic Nodes Update ---
        if (Array.isArray(jsonData.atomicNodes)) {
          // Add more robust validation later if needed
          setAtomicNodes(jsonData.atomicNodes);
        } else {
          console.warn('Imported JSON missing or invalid atomicNodes array. Resetting library.');
          setAtomicNodes([]);
        }

        // --- Canvas Nodes Update ---
        if (Array.isArray(jsonData.canvasNodes)) {
          // Add more robust validation later
          setCanvasNodes(jsonData.canvasNodes);
        } else {
          console.warn('Imported JSON missing or invalid canvasNodes array. Resetting canvas.');
          setCanvasNodes([]);
        }

        // --- Wires Update ---
        if (Array.isArray(jsonData.wires)) {
            // Add more robust validation later
            setWires(jsonData.wires);
        } else {
            console.warn('Imported JSON missing or invalid wires array. Clearing wires.');
            setWires([]);
        }

        // --- Definitions Update --- 
        if (Array.isArray(jsonData.definitions)) {
            // Add more robust validation later if needed
            setDefinitions(jsonData.definitions);
            console.log('Imported definitions:', jsonData.definitions.length);
        } else {
             console.warn('Imported JSON missing or invalid definitions array. Clearing definitions.');
             setDefinitions([]);
        }

        // Reset file input value to allow importing the same file again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }

        // Update other state based on jsonData here later

      } catch (error) {
        console.error('Failed to parse imported JSON:', error);
        alert('Error importing file. Please ensure it is a valid JSON workspace file.');
        // Reset file input value on error too
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.onerror = () => {
        console.error('Failed to read file:', reader.error);
        alert('Error reading file.');
        // Reset file input value on error too
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
    };
    reader.readAsText(file);
  };

  const toggleBoundary = useCallback(() => {
    setIsBoundaryActive(prev => {
      const becomingActive = !prev;
      if (!becomingActive) {
        const boundaryPortIds = new Set(boundaryPorts.map(p => p.id));
        setWires(currentWires =>
          currentWires.filter(w =>
            !(w.sourceNodeId === 'BOUNDARY' && boundaryPortIds.has(w.sourcePortIndex as string)) &&
            !(w.targetNodeId === 'BOUNDARY' && boundaryPortIds.has(w.targetPortIndex as string))
          )
        );
        setBoundaryPorts([]);
        console.log("Boundary deactivated, ports and wires cleared.");
      } else {
        console.log("Boundary activated.");
      }
      return becomingActive;
    });
  }, [boundaryPorts, setBoundaryPorts, setWires]);

  const addBoundaryPort = useCallback((newPort: BoundaryPort) => {
    if (!isBoundaryActive) {
        console.warn("Attempted to add boundary port while boundary is inactive.");
        return;
    }
    setBoundaryPorts(prev => [...prev, newPort]);
    console.log("Added boundary port:", newPort);
  }, [isBoundaryActive, setBoundaryPorts]);

  const deleteBoundaryPort = useCallback((portIdToDelete: string) => {
    setBoundaryPorts(prev => prev.filter(p => p.id !== portIdToDelete));
    setWires(currentWires =>
      currentWires.filter(w =>
        !(w.sourceNodeId === 'BOUNDARY' && w.sourcePortIndex === portIdToDelete) &&
        !(w.targetNodeId === 'BOUNDARY' && w.targetPortIndex === portIdToDelete)
      )
    );
    console.log("Deleted boundary port and connected wires:", portIdToDelete);
  }, [setBoundaryPorts, setWires]);

  // --- Definition Handlers ---
  const addDefinition = useCallback((name: string, color: string) => {
    if (!definitionCandidate) {
        console.error("Cannot add definition, candidate data is missing.");
        return;
    }

    const { nodes, wires: internalWires, ports } = definitionCandidate;

    // Transform BoundaryPorts to ExternalPorts, determining principal status
    const externalPorts: ExternalPort[] = ports.map(boundaryPort => {
        let isPrincipal = false;
        // Find the wire connected to this boundary port
        const connectedWire = internalWires.find(w => 
            (w.sourceNodeId === 'BOUNDARY' && w.sourcePortIndex === boundaryPort.id) || 
            (w.targetNodeId === 'BOUNDARY' && w.targetPortIndex === boundaryPort.id)
        );

        if (connectedWire) {
            // Determine the internal node and port it connects to
            const internalNodeId = connectedWire.sourceNodeId === 'BOUNDARY' ? connectedWire.targetNodeId : connectedWire.sourceNodeId;
            const internalPortIndex = connectedWire.sourceNodeId === 'BOUNDARY' ? connectedWire.targetPortIndex : connectedWire.sourcePortIndex;
            
            // Ensure it's an internal node (not another boundary port) and a valid port index
            if (internalNodeId !== 'BOUNDARY' && typeof internalPortIndex === 'number') {
                const internalNodeInstance = nodes.find(n => n.instanceId === internalNodeId);
                if (internalNodeInstance) {
                    // Find the definition of the internal atomic node
                    // Assuming definitions only contain atomic nodes for now
                    const atomicDef = atomicNodes.find(def => def.id === internalNodeInstance.definitionId);
                    if (atomicDef) {
                        // Check if the internal port index falls within the principal range
                        isPrincipal = internalPortIndex < atomicDef.principalPorts;
                    }
                }
            }
        }

        return {
            id: boundaryPort.id,
            angle: boundaryPort.angle,
            isPrincipal: isPrincipal // Set the determined status
        };
    });
    // Sort external ports by angle for consistent ordering
    externalPorts.sort((a, b) => a.angle - b.angle);

    const newDefinition: DefinitionDefinition = {
        id: `def_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        color,
        internalNodes: nodes, // Store the nodes that were inside
        internalWires: internalWires, // Store the wires connecting them/boundary
        externalPorts,
    };

    setDefinitions(prev => [...prev, newDefinition]);
    console.log("Definition created:", newDefinition);

    // Clear boundary and associated state after successful definition
    setIsBoundaryActive(false);
    setBoundaryPorts([]);
    // --- Corrected Wire Cleanup ---
    const removedNodeIds = new Set(nodes.map(n => n.instanceId));
    const removedBoundaryPortIds = new Set(ports.map(p => p.id));
    setWires(currentWires =>
        currentWires.filter(w => {
            // Check source
            const sourceIsRemovedNode = removedNodeIds.has(w.sourceNodeId as string);
            const sourceIsRemovedBoundaryPort = w.sourceNodeId === 'BOUNDARY' && removedBoundaryPortIds.has(w.sourcePortIndex as string);
            if (sourceIsRemovedNode || sourceIsRemovedBoundaryPort) return false;

            // Check target
            const targetIsRemovedNode = removedNodeIds.has(w.targetNodeId as string);
            const targetIsRemovedBoundaryPort = w.targetNodeId === 'BOUNDARY' && removedBoundaryPortIds.has(w.targetPortIndex as string);
            if (targetIsRemovedNode || targetIsRemovedBoundaryPort) return false;

            return true; // Keep the wire
        })
    );
    setCanvasNodes([]); // Clear canvas nodes that formed the definition
    setDefinitionCandidate(null); // Clear candidate data
    setIsDefinitionModalOpen(false); // Close modal

  }, [definitionCandidate, setDefinitions, setIsBoundaryActive, setBoundaryPorts, setWires, setCanvasNodes, atomicNodes]); // Added atomicNodes dependency


  const deleteDefinition = useCallback((definitionIdToDelete: string) => {
    setDefinitions((prev) =>
        prev.filter((def) => def.id !== definitionIdToDelete)
    );
    // Add logic here later to handle deleting instances of this definition on the canvas if needed
  }, [setDefinitions]);

  const handleAddDefinitionClick = useCallback(() => {
    // --- Validation ---
    if (!isBoundaryActive) {
        alert("Error: Boundary must be active to define a new node.");
        return;
    }
    if (boundaryPorts.length === 0) {
        alert("Error: Definition must have at least one external connection (boundary port).");
        return;
    }

    const allPorts = new Map<NodeOrBoundaryId, Set<PortIndexOrId>>();
    const connectedPorts = new Set<string>(); // Stores "nodeId:portIndexOrId"

    // Populate allPorts with internal node ports
    canvasNodes.forEach(node => {
        const definition = atomicNodes.find(def => def.id === node.definitionId);
        if (definition) {
            const ports = new Set<PortIndexOrId>();
            const totalPorts = definition.principalPorts + definition.nonPrincipalPorts;
            for (let i = 0; i < totalPorts; i++) {
                ports.add(i);
            }
            allPorts.set(node.instanceId, ports);
        }
    });

    // Populate allPorts with boundary ports
    const boundaryPortSet = new Set<PortIndexOrId>(boundaryPorts.map(p => p.id));
    allPorts.set('BOUNDARY', boundaryPortSet);

    // Mark connected ports based on wires
    wires.forEach(wire => {
        connectedPorts.add(`${wire.sourceNodeId}:${wire.sourcePortIndex}`);
        connectedPorts.add(`${wire.targetNodeId}:${wire.targetPortIndex}`);
    });

    // --- Check for dangling ports ---
    let danglingPortFound = false;
    let danglingDetails = "";

    allPorts.forEach((ports, nodeId) => {
        ports.forEach(portIndexOrId => {
            if (!connectedPorts.has(`${nodeId}:${portIndexOrId}`)) {
                danglingPortFound = true;
                danglingDetails += `\n - Node/Boundary: ${nodeId}, Port: ${portIndexOrId}`;
            }
        });
    });

    if (danglingPortFound) {
        alert(`Error: Cannot create definition. All internal and boundary ports must be connected. Dangling ports found:${danglingDetails}`);
        return;
    }

    // --- Validation Passed ---
    console.log("Validation passed. Opening definition modal.");
    // Store the current state needed to create the definition
    setDefinitionCandidate({
        nodes: [...canvasNodes], // Create copies
        wires: [...wires],
        ports: [...boundaryPorts],
    });
    setIsDefinitionModalOpen(true);

  }, [isBoundaryActive, boundaryPorts, canvasNodes, wires, atomicNodes]);


  const closeDefinitionModal = useCallback(() => {
    setIsDefinitionModalOpen(false);
    setDefinitionCandidate(null); // Clear candidate data if modal is closed
  }, []);

  const expandDefinitionInstance = useCallback((instanceIdToExpand: string) => {
    console.log(`Attempting to expand definition instance: ${instanceIdToExpand}`);

    // --- Find Instance and Definition ---
    const instanceToExpand = canvasNodes.find(n => n.instanceId === instanceIdToExpand);
    if (!instanceToExpand || !instanceToExpand.isDefinitionInstance) {
        console.log("Expansion skipped: Instance not found or not a definition.");
        return;
    }
    const definition = definitions.find(d => d.id === instanceToExpand.definitionId);
    if (!definition) {
        console.error(`Expansion failed: Definition ${instanceToExpand.definitionId} not found.`);
        return;
    }

    // --- Get Physics Data ---
    const physicsData = nodePhysicsData.current.get(instanceIdToExpand);
    if (!physicsData) {
        console.error(`Expansion failed: Physics data for ${instanceIdToExpand} not found.`);
        // Optionally try to use instanceToExpand.x, y as fallback, but rotation is lost
        alert("Cannot expand: Node physics data missing. Try moving the node slightly.");
        return;
    }
    const { position: parentPos, rotation: parentRot } = physicsData;

    // --- Prepare State Updates ---
    const newNodes: CanvasNodeInstance[] = [];
    const nodesToRemove: string[] = [instanceIdToExpand];
    const newWires: WireConnection[] = [];
    const wiresToModify: { 
        originalWireId: string; 
        newSourceId?: NodeOrBoundaryId; 
        newSourcePort?: PortIndexOrId;
        newTargetId?: NodeOrBoundaryId;
        newTargetPort?: PortIndexOrId;
     }[] = [];
    const wiresToRemove: string[] = [];

    // Indentify wires connected externally to the instance being expanded
    const externalWires = wires.filter(w => w.sourceNodeId === instanceIdToExpand || w.targetNodeId === instanceIdToExpand);

    const internalInstanceIdMap = new Map<string, string>(); // Map definition internal ID -> new canvas instance ID

    // --- 1. Create New Instances for Internal Nodes ---
    console.log(`[Expand ${instanceIdToExpand}] Creating internal node instances...`);
    definition.internalNodes.forEach(internalNode => {
        const newInstanceId = `inst_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        internalInstanceIdMap.set(internalNode.instanceId, newInstanceId); // Store mapping

        // Calculate world position for the new node
        const relativePos = new THREE.Vector3(internalNode.x, internalNode.y, 0);
        const worldOffset = relativePos.clone().applyQuaternion(parentRot);
        const newWorldPos = new THREE.Vector3().addVectors(parentPos, worldOffset);

        // Check if the internal node is atomic or another definition (recursive expansion not handled yet)
        const internalNodeDef = atomicNodes.find(ad => ad.id === internalNode.definitionId);
        if (!internalNodeDef) {
             console.warn(`Internal node ${internalNode.instanceId} definition ${internalNode.definitionId} not found or is not atomic. Skipping.`);
             // TODO: Handle nested definitions later if needed
             return;
        }

        newNodes.push({
            instanceId: newInstanceId,
            definitionId: internalNode.definitionId, // Uses the atomic definition ID
            x: newWorldPos.x,
            y: newWorldPos.y,
            isDefinitionInstance: false, // These are atomic instances now
        });
    });
    console.log(`[Expand ${instanceIdToExpand}] Internal instance map:`, internalInstanceIdMap);

    // --- 2. Process Wires --- 
    // Start with internal wires needing removal
    wiresToRemove.push(...definition.internalWires.map(w => w.id));

    // Process external wires to determine modifications or new boundary-boundary connections
    externalWires.forEach(externalWire => {
         const connectedPortIndex = externalWire.sourceNodeId === instanceIdToExpand 
             ? externalWire.sourcePortIndex
             : externalWire.targetPortIndex;

        if (typeof connectedPortIndex !== 'number') return; // Should not happen for external wires to definition

        const externalPort = definition.externalPorts[connectedPortIndex];
        if (!externalPort) {
            console.warn(`[Expand ${instanceIdToExpand}] Could not find external port definition for index ${connectedPortIndex}`);
            return;
        }

        // Find the internal wire connected to this external port's corresponding boundary port
        const internalWire = definition.internalWires.find(iw => 
            (iw.sourceNodeId === 'BOUNDARY' && iw.sourcePortIndex === externalPort.id) ||
            (iw.targetNodeId === 'BOUNDARY' && iw.targetPortIndex === externalPort.id)
        );

        if (internalWire) {
            const internalNodeOriginalId = internalWire.sourceNodeId === 'BOUNDARY' 
                ? internalWire.targetNodeId 
                : internalWire.sourceNodeId;
            const internalPortIndex = internalWire.sourceNodeId === 'BOUNDARY' 
                ? internalWire.targetPortIndex 
                : internalWire.sourcePortIndex;
            
            const newInternalInstanceId = internalInstanceIdMap.get(internalNodeOriginalId as string);

            if (newInternalInstanceId !== undefined && typeof internalPortIndex === 'number') {
                // Found connection: Mark the externalWire for modification, not removal
                const modifyIndex = wiresToRemove.indexOf(externalWire.id);
                if (modifyIndex > -1) wiresToRemove.splice(modifyIndex, 1);

                const modification = {
                    originalWireId: externalWire.id,
                    ...(externalWire.sourceNodeId === instanceIdToExpand
                        ? { newSourceId: newInternalInstanceId, newSourcePort: internalPortIndex }
                        : { newTargetId: newInternalInstanceId, newTargetPort: internalPortIndex })
                };
                wiresToModify.push(modification);
            } else {
                // This external wire connects to a boundary port that isn't connected internally? 
                // Or connected to a non-atomic node? Keep it marked for removal.
                console.warn(`[Expand ${instanceIdToExpand}] External wire ${externalWire.id} connects to boundary port ${externalPort.id}, but no valid internal connection found.`);
                if (!wiresToRemove.includes(externalWire.id)) wiresToRemove.push(externalWire.id); // Ensure removal
            }
        } else {
             // Handle cases where boundary ports were connected directly (Boundary <-> Boundary internal wires)
             const boundaryWire = definition.internalWires.find(iw => 
                 iw.sourceNodeId === 'BOUNDARY' && iw.targetNodeId === 'BOUNDARY' && 
                 (iw.sourcePortIndex === externalPort.id || iw.targetPortIndex === externalPort.id)
             );
             if (boundaryWire) {
                 // This external wire corresponds to one side of a boundary-to-boundary connection.
                 // It should remain marked for removal, and a new wire will be created later.
                 // Find the *other* external wire involved.
                 const otherBoundaryPortId = boundaryWire.sourcePortIndex === externalPort.id ? boundaryWire.targetPortIndex : boundaryWire.sourcePortIndex;
                 const otherExternalPortIndex = definition.externalPorts.findIndex(p => p.id === otherBoundaryPortId);
                 if (otherExternalPortIndex === -1) return; // Should find the other port

                 const otherExternalWire = externalWires.find(w => 
                    (w.sourceNodeId === instanceIdToExpand && w.sourcePortIndex === otherExternalPortIndex) ||
                    (w.targetNodeId === instanceIdToExpand && w.targetPortIndex === otherExternalPortIndex)
                 );

                 if (otherExternalWire && externalWire.id < otherExternalWire.id) { // Process each pair only once
                     const endpointA_NodeId = externalWire.sourceNodeId === instanceIdToExpand ? externalWire.targetNodeId : externalWire.sourceNodeId;
                     const endpointA_Port = externalWire.sourceNodeId === instanceIdToExpand ? externalWire.targetPortIndex : externalWire.sourcePortIndex;
                     const endpointB_NodeId = otherExternalWire.sourceNodeId === instanceIdToExpand ? otherExternalWire.targetNodeId : otherExternalWire.sourceNodeId;
                     const endpointB_Port = otherExternalWire.sourceNodeId === instanceIdToExpand ? otherExternalWire.targetPortIndex : otherExternalWire.sourcePortIndex;

                     newWires.push({
                        id: `wire_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                        sourceNodeId: endpointA_NodeId,
                        sourcePortIndex: endpointA_Port,
                        targetNodeId: endpointB_NodeId,
                        targetPortIndex: endpointB_Port,
                        targetLength: null, // Recalculate later
                    });

                    // Ensure BOTH original external wires are marked for removal
                    if (!wiresToRemove.includes(externalWire.id)) wiresToRemove.push(externalWire.id);
                    if (otherExternalWire && !wiresToRemove.includes(otherExternalWire.id)) wiresToRemove.push(otherExternalWire.id);
                 }
             } else {
                // External wire connected to a boundary port with no internal connection? Remove it.
                console.warn(`[Expand ${instanceIdToExpand}] External wire ${externalWire.id} connects to boundary port ${externalPort.id}, which has no internal connection.`);
                if (!wiresToRemove.includes(externalWire.id)) wiresToRemove.push(externalWire.id); // Ensure removal
             }
        }
    });

    // --- Add NEW wires for internal connections --- 
    console.log(`[Expand ${instanceIdToExpand}] Creating new internal wires...`);
    definition.internalWires.forEach(internalWire => {
        // Only create new wires for connections BETWEEN internal nodes
        if (internalWire.sourceNodeId !== 'BOUNDARY' && internalWire.targetNodeId !== 'BOUNDARY') {
            const newSourceId = internalInstanceIdMap.get(internalWire.sourceNodeId as string);
            const newTargetId = internalInstanceIdMap.get(internalWire.targetNodeId as string);

            if (newSourceId && newTargetId) {
                 // Calculate initial length based on new node positions (best effort)
                 const sourceInstance = newNodes.find(n => n.instanceId === newSourceId);
                 const targetInstance = newNodes.find(n => n.instanceId === newTargetId);
                 const sourceDef = sourceInstance ? atomicNodes.find(d => d.id === sourceInstance.definitionId) : undefined;
                 const targetDef = targetInstance ? atomicNodes.find(d => d.id === targetInstance.definitionId) : undefined;
                 let initialLength: number | null = null;

                 if (sourceInstance && targetInstance && sourceDef && targetDef && typeof internalWire.sourcePortIndex === 'number' && typeof internalWire.targetPortIndex === 'number') {
                     const sourceLocalOffset = getPortBoundaryLocalOffset(sourceDef, internalWire.sourcePortIndex);
                     const targetLocalOffset = getPortBoundaryLocalOffset(targetDef, internalWire.targetPortIndex);
                     // Assume initial rotation is identity for new nodes for length calc
                     const sourcePos = new THREE.Vector3(sourceInstance.x, sourceInstance.y, 0).add(sourceLocalOffset);
                     const targetPos = new THREE.Vector3(targetInstance.x, targetInstance.y, 0).add(targetLocalOffset);
                     initialLength = sourcePos.distanceTo(targetPos);
                 }

                newWires.push({
                    id: `wire_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                    sourceNodeId: newSourceId,
                    sourcePortIndex: internalWire.sourcePortIndex,
                    targetNodeId: newTargetId,
                    targetPortIndex: internalWire.targetPortIndex,
                    targetLength: initialLength, // Calculate initial length if possible
                });
            } else {
                 console.warn(`[Expand ${instanceIdToExpand}] Could not map internal wire endpoints for wire ${internalWire.id}. Source: ${internalWire.sourceNodeId}=>${newSourceId}, Target: ${internalWire.targetNodeId}=>${newTargetId}`);
             }
        }
    });

    console.log(`[Expand ${instanceIdToExpand}] Wires to remove FINAL:`, wiresToRemove);
    console.log(`[Expand ${instanceIdToExpand}] Wires to modify:`, wiresToModify);
    console.log(`[Expand ${instanceIdToExpand}] New boundary-to-boundary wires:`, newWires);

    // --- 3. Apply State Updates --- 
    console.log(`[Expand ${instanceIdToExpand}] BEFORE state update. Nodes to remove:`, nodesToRemove, "New nodes:", newNodes.length, "Wires to remove:", wiresToRemove.length, "Wires to modify:", wiresToModify.length, "New wires:", newWires.length);
    setCanvasNodes(prevNodes => [
        ...prevNodes.filter(n => !nodesToRemove.includes(n.instanceId)),
        ...newNodes
    ]);
    setWires(prevWires => {
        // 1. Filter out wires marked for complete removal
        let updatedWires = prevWires.filter(w => !wiresToRemove.includes(w.id));
        
        // 2. Modify wires connecting to the expanded node
        updatedWires = updatedWires.map(w => {
            const modification = wiresToModify.find(m => m.originalWireId === w.id);
            if (modification) {
                // Create a new wire object with the modified properties
                return { 
                    ...w, 
                    ...(modification.newSourceId && { sourceNodeId: modification.newSourceId }),
                    ...(modification.newSourcePort !== undefined && { sourcePortIndex: modification.newSourcePort }),
                    ...(modification.newTargetId && { targetNodeId: modification.newTargetId }),
                    ...(modification.newTargetPort !== undefined && { targetPortIndex: modification.newTargetPort }),
                 };
            }
            return w;
        });
        // 3. Add newly created wires
        return [...updatedWires, ...newWires]; // Add new wires immediately again
    });
    console.log(`[Expand ${instanceIdToExpand}] AFTER state update.`);

    // Optional: Clean up physics data ref for the removed node
    console.log(`[Expand ${instanceIdToExpand}] Cleaning up physics data ref.`);
    nodePhysicsData.current.delete(instanceIdToExpand);

    console.log("Expansion complete.");

  }, [canvasNodes, definitions, wires, setCanvasNodes, setWires, atomicNodes]); // Dependencies

  return (
    <div id="app-container">
      <div id="top-bar">
        {isEditingTitle ? (
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            autoFocus // Automatically focus the input when it appears
            className="title-input"
          />
        ) : (
          <h1 onDoubleClick={handleDoubleClick} className="title-display">
            {title}
          </h1>
        )}
        <div className="top-bar-controls">
          <button onClick={handleImportClick} className="control-button">Import</button>
          <button onClick={handleExport} className="control-button">Export</button>
          <button onClick={toggleBoundary} className="control-button">
            {isBoundaryActive ? 'Hide Boundary' : 'Show Boundary'}
          </button>
        </div>
        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".json"
          style={{ display: 'none' }}
        />
      </div>
      
      <div id="main-content">
        <LeftSidebar
          atomicNodes={atomicNodes}
          onAddAtomicNode={addAtomicNode}
          onDeleteAtomicNode={deleteAtomicNode}
          definitions={definitions} // Pass definitions
          onDeleteDefinition={deleteDefinition} // Pass delete handler
          activeTab={activeSidebarTab} // Pass active tab
          onSetTab={setActiveSidebarTab} // Pass tab setter
          onAddDefinitionClick={handleAddDefinitionClick} // Pass add definition handler
        />
        <CanvasArea
          atomicNodeDefs={atomicNodes}
          definitionDefs={definitions} // Pass definitions state
          canvasNodes={canvasNodes}
          wires={wires}
          drawingWire={drawingWire}
          onAddNode={addNodeToCanvas}
          onDeleteNode={deleteCanvasNode}
          onStartWire={startWire}
          onUpdateWireEnd={updateWireEnd}
          onFinishWire={finishWire}
          onDeleteWire={deleteWire}
          onUpdateWireLength={handleUpdateWireLength}
          onUpdateNodePhysicsData={updateNodePhysicsData}
          isBoundaryActive={isBoundaryActive}
          boundaryPorts={boundaryPorts}
          addBoundaryPort={addBoundaryPort}
          deleteBoundaryPort={deleteBoundaryPort}
          setWires={setWires}
          onAddDefinitionClick={handleAddDefinitionClick} // Pass handler
          onExpandDefinition={expandDefinitionInstance} // Pass expansion handler
        />
      </div>

      {/* Definition Creation Modal */} 
      {isDefinitionModalOpen && (
          <Modal title="Create Definition Node" onClose={closeDefinitionModal}>
              <DefinitionForm onSubmit={addDefinition} />
          </Modal>
      )}
    </div>
  )
}

export default App
