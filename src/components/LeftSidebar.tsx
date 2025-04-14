import React, { useState, DragEvent } from 'react';
import { AtomicNodeDefinition, WireConnection } from '../types';
import AtomicNodeForm from './AtomicNodeForm'; // We'll create this next
import Modal from './Modal'; // We'll create this utility component too
import AtomicNodeDisplay from './AtomicNodeDisplay'; // Import the display component

interface LeftSidebarProps {
  atomicNodes: AtomicNodeDefinition[];
  wires: WireConnection[];
  onAddAtomicNode: (newNode: AtomicNodeDefinition) => void;
  onDeleteAtomicNode: (definitionId: string) => void;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({ atomicNodes, wires, onAddAtomicNode, onDeleteAtomicNode }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  const handleFormSubmit = (newNodeData: Omit<AtomicNodeDefinition, 'id'>) => {
    const newNode: AtomicNodeDefinition = {
      ...newNodeData,
      id: Date.now().toString(), // Simple unique ID generation
    };
    onAddAtomicNode(newNode);
    closeModal();
  };

  // --- Drag Handler ---
  const handleDragStart = (event: DragEvent<HTMLLIElement>, nodeId: string) => {
    event.dataTransfer.setData('text/plain', nodeId); // Change to text/plain
    event.dataTransfer.effectAllowed = 'move';
    // Optional: You could add a drag image here if desired
  };
  // --- End Drag Handler ---

  return (
    <div id="left-sidebar">
      <button onClick={openModal} className="add-button">
        Create Atomic Node
      </button>

      {/* Use AtomicNodeDisplay in the list */}
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

      {isModalOpen && (
        <Modal title="Create Atomic Node" onClose={closeModal}>
          <AtomicNodeForm onSubmit={handleFormSubmit} />
        </Modal>
      )}
    </div>
  );
};

export default LeftSidebar; 