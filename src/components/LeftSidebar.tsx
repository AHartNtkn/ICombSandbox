import React, { useState, DragEvent } from 'react';
import { AtomicNodeDefinition, WireConnection, DefinitionDefinition } from '../types';
import AtomicNodeForm from './AtomicNodeForm'; // We'll create this next
import Modal from './Modal'; // We'll create this utility component too
import AtomicNodeDisplay from './AtomicNodeDisplay'; // Import the display component
// Import DefinitionDisplay (we'll create this next)
import DefinitionDisplay from './DefinitionDisplay';

interface LeftSidebarProps {
  atomicNodes: AtomicNodeDefinition[];
  onAddAtomicNode: (newNode: AtomicNodeDefinition) => void;
  onDeleteAtomicNode: (definitionId: string) => void;
  // New props for definitions
  definitions: DefinitionDefinition[];
  onDeleteDefinition: (definitionId: string) => void;
  // New props for tabs
  activeTab: 'atomic' | 'definitions';
  onSetTab: (tab: 'atomic' | 'definitions') => void;
  // Handler for Add Definition button
  onAddDefinitionClick: () => void;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({ 
  atomicNodes, 
  onAddAtomicNode, 
  onDeleteAtomicNode, 
  definitions, 
  onDeleteDefinition, 
  activeTab, 
  onSetTab, 
  onAddDefinitionClick 
}) => {
  const [isAtomicModalOpen, setIsAtomicModalOpen] = useState(false);

  const openAtomicModal = () => setIsAtomicModalOpen(true);
  const closeAtomicModal = () => setIsAtomicModalOpen(false);

  const handleAtomicFormSubmit = (newNodeData: Omit<AtomicNodeDefinition, 'id'>) => {
    const newNode: AtomicNodeDefinition = {
      ...newNodeData,
      id: Date.now().toString(), // Simple unique ID generation
    };
    onAddAtomicNode(newNode);
    closeAtomicModal();
  };

  // --- Drag Handler ---
  const handleDragStart = (event: DragEvent<HTMLLIElement>, nodeId: string) => {
    event.dataTransfer.setData('text/plain', nodeId); // Change to text/plain
    event.dataTransfer.effectAllowed = 'move';
    // Optional: You could add a drag image here if desired
  };
  // --- End Drag Handler ---

  // --- Definition Drag Handler ---
  const handleDefinitionDragStart = (event: DragEvent<HTMLLIElement>, definitionId: string) => {
    event.dataTransfer.setData('text/plain', `definition:${definitionId}`); // Prefix to identify type
    event.dataTransfer.effectAllowed = 'move';
  };
  // --- End Definition Drag Handler ---

  return (
    <div id="left-sidebar">
      {/* Tab Buttons */}
      <div className="sidebar-tabs">
          <button 
              onClick={() => onSetTab('atomic')} 
              className={`tab-button ${activeTab === 'atomic' ? 'active' : ''}`}
          >
              Atomic Nodes
          </button>
          <button 
              onClick={() => onSetTab('definitions')} 
              className={`tab-button ${activeTab === 'definitions' ? 'active' : ''}`}
          >
              Definitions
          </button>
      </div>

      {/* Conditional Content based on activeTab */}
      {activeTab === 'atomic' && (
        <>
          <button onClick={openAtomicModal} className="add-button">
            Create Atomic Node
          </button>
          <ul className="library-list">
            {atomicNodes.map((node) => (
              <li
                key={node.id}
                draggable
                onDragStart={(event) => handleDragStart(event, node.id)}
                className="library-item"
              >
                <AtomicNodeDisplay node={node} isSidebar={true} />
                <button
                  className="delete-node-button"
                  onClick={() => onDeleteAtomicNode(node.id)}
                  title={`Delete ${node.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {activeTab === 'definitions' && (
        <>
          <button onClick={onAddDefinitionClick} className="add-button">
            Add Current Canvas as Definition
          </button>
          <ul className="library-list">
            {definitions.map((def) => (
              <li
                key={def.id}
                draggable // Make definitions draggable
                onDragStart={(event) => handleDefinitionDragStart(event, def.id)} // Use specific handler
                className="library-item definition-item" // Add specific class
              >
                 {/* TODO: Replace with DefinitionDisplay component */}
                <DefinitionDisplay definition={def} isSidebar={true} /> 
                {/* <div style={{ padding: '5px 10px', backgroundColor: def.color, borderRadius: '3px', textAlign: 'center', color: '#333' }}> 
                    {def.name}
                </div> */}
                <button
                  className="delete-node-button"
                  onClick={() => onDeleteDefinition(def.id)}
                  title={`Delete ${def.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Atomic Node Creation Modal */}
      {isAtomicModalOpen && (
        <Modal title="Create Atomic Node" onClose={closeAtomicModal}>
          <AtomicNodeForm onSubmit={handleAtomicFormSubmit} />
        </Modal>
      )}
    </div>
  );
};

export default LeftSidebar; 