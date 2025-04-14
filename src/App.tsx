import React, { useState, ChangeEvent, KeyboardEvent, FocusEvent, useRef, useCallback } from 'react';
import * as THREE from 'three'; // Import THREE
import './App.css'
import { WorkspaceData, AtomicNodeDefinition, CanvasNodeInstance, WireConnection, DrawingWireState } from './types'; // Import WireConnection
import LeftSidebar from './components/LeftSidebar'; // Import new component
import CanvasArea from './components/CanvasArea'; // Import new component
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
  const addNodeToCanvas = useCallback((definitionId: string, x: number, y: number) => {
    const newNodeInstance: CanvasNodeInstance = {
      instanceId: `inst_${Date.now()}_${Math.random().toString(16).slice(2)}`, // Unique instance ID
      definitionId,
      x,
      y,
    };
    setCanvasNodes((prevCanvasNodes) => [...prevCanvasNodes, newNodeInstance]);
  }, []);

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

  // --- Wire Handling ---
  // Need startX/Y and currentMouseX/Y again for the visual line
  const startWire = useCallback((sourceNodeId: string, sourcePortIndex: number, startX: number, startY: number, currentMouseX: number, currentMouseY: number) => {
    console.log(`Start wire from ${sourceNodeId} port ${sourcePortIndex}`);
    // Store all coordinates in state again
    setDrawingWire({
        sourceNodeId,
        sourcePortIndex,
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

  const finishWire = useCallback((targetNodeId: string | null, targetPortIndex: number | null) => {
    // Prevent re-entry flag check
    if (isFinishingWire.current) {
      console.log("finishWire called while already finishing. Skipping.");
      return;
    }
    isFinishingWire.current = true;

    const currentDrawingWire = drawingWire;
    setDrawingWire(null); // Clear drawing state immediately

    if (!currentDrawingWire) {
      console.log("finishWire called but drawingWire was already null. Skipping.");
      isFinishingWire.current = false; // Reset flag
      return;
    }
    console.log(`Finish wire. Target: ${targetNodeId} port ${targetPortIndex}`);

    const sourceNodeId = currentDrawingWire.sourceNodeId;
    const sourcePortIndex = currentDrawingWire.sourcePortIndex;

    // --- Perform Validation BEFORE setWires ---
    let isValidTarget = targetNodeId !== null && targetPortIndex !== null && targetNodeId !== sourceNodeId;
    let isSourcePortOccupied = false;
    let isTargetPortOccupied = false;

    if (isValidTarget) {
      // Use the component's `wires` state for validation
      isSourcePortOccupied = wires.some(w =>
        (w.sourceNodeId === sourceNodeId && w.sourcePortIndex === sourcePortIndex) ||
        (w.targetNodeId === sourceNodeId && w.targetPortIndex === sourcePortIndex)
      );
      isTargetPortOccupied = wires.some(w =>
        (w.sourceNodeId === targetNodeId && w.sourcePortIndex === targetPortIndex) ||
        (w.targetNodeId === targetNodeId && w.targetPortIndex === targetPortIndex)
      );
    }

    // Log validation results *before* setWires
    console.log(`finishWire Validation BEFORE setWires: isValidTarget=${isValidTarget}, isSourceOccupied=${isSourcePortOccupied}, isTargetOccupied=${isTargetPortOccupied}`);

    // --- Update State ONLY if Validation Passes ---
    if (isValidTarget && !isSourcePortOccupied && !isTargetPortOccupied) {
      // --- Calculate Initial Length ---
      let initialLength: number | null = null;
      const sourceNodeDef = atomicNodes.find(def => canvasNodes.find(cn => cn.instanceId === sourceNodeId)?.definitionId === def.id);
      const targetNodeDef = atomicNodes.find(def => canvasNodes.find(cn => cn.instanceId === targetNodeId)?.definitionId === def.id);
      const sourcePhysData = nodePhysicsData.current.get(sourceNodeId);
      const targetPhysData = nodePhysicsData.current.get(targetNodeId!);

      if (sourceNodeDef && targetNodeDef && sourcePhysData && targetPhysData) {
          const sourceLocalOffset = getPortBoundaryLocalOffset(sourceNodeDef, sourcePortIndex);
          const targetLocalOffset = getPortBoundaryLocalOffset(targetNodeDef, targetPortIndex!);

          const sourcePos = sourcePhysData.position.clone()
              .add(sourceLocalOffset.clone().applyQuaternion(sourcePhysData.rotation));
          const targetPos = targetPhysData.position.clone()
              .add(targetLocalOffset.clone().applyQuaternion(targetPhysData.rotation));

          initialLength = sourcePos.distanceTo(targetPos);
          console.log("Calculated initial wire length:", initialLength);
      } else {
          console.warn("Could not get all data needed to calculate initial wire length.");
      }
      // --- End Calculate Initial Length ---

      const newWire: WireConnection = {
        id: `wire_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        sourceNodeId: sourceNodeId,
        sourcePortIndex: sourcePortIndex,
        targetNodeId: targetNodeId!,
        targetPortIndex: targetPortIndex!,
        targetLength: initialLength, // Set initial length
      };
      console.log("Wire created:", newWire);
      setWires(currentWires => [...currentWires, newWire]);
    } else {
       // Log failure reason based on the validation done above
       let reason = "Cancelled or invalid target.";
       if (!isValidTarget) reason = `Invalid target: ${targetNodeId}, ${targetPortIndex}`;
       else if (isSourcePortOccupied) reason = "Source port already connected.";
       else if (isTargetPortOccupied) reason = "Target port already connected.";
       console.log(`Wire connection failed: ${reason}`);
       // No state update needed if validation failed
    }

    // Reset the re-entry flag
    setTimeout(() => {
      isFinishingWire.current = false;
    }, 0);

  }, [drawingWire, wires, setWires, setDrawingWire, atomicNodes, canvasNodes]); // Added atomicNodes, canvasNodes dependencies

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
  // --- End Import/Export Handlers ---

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
          wires={wires}
        />
        <CanvasArea
          atomicNodeDefs={atomicNodes}
          canvasNodes={canvasNodes}
          wires={wires}
          onAddNode={addNodeToCanvas}
          onDeleteNode={deleteCanvasNode}
          drawingWire={drawingWire}
          onStartWire={startWire}
          onUpdateWireEnd={updateWireEnd}
          onFinishWire={finishWire}
          onDeleteWire={deleteWire}
          onUpdateWireLength={handleUpdateWireLength} // Pass down the handler
          // Pass down node physics update handler
          onUpdateNodePhysicsData={updateNodePhysicsData}
        />
      </div>
    </div>
  )
}

export default App
