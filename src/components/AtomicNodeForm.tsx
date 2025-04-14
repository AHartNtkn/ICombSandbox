import React, { useState, FormEvent } from 'react';
import { AtomicNodeDefinition } from '../types';
import './AtomicNodeForm.css'; // Styles for the form

interface AtomicNodeFormProps {
  onSubmit: (newNodeData: Omit<AtomicNodeDefinition, 'id'>) => void;
}

const AtomicNodeForm: React.FC<AtomicNodeFormProps> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#cccccc'); // Default color
  const [principalPorts, setPrincipalPorts] = useState(1);
  const [nonPrincipalPorts, setNonPrincipalPorts] = useState(0);
  const [metadataInput, setMetadataInput] = useState(''); // Temp input for metadata keys
  const [metadataSchema, setMetadataSchema] = useState<string[]>([]);

  const handleAddMetadataField = () => {
    const fieldName = metadataInput.trim();
    if (fieldName && !metadataSchema.includes(fieldName)) {
      setMetadataSchema([...metadataSchema, fieldName]);
      setMetadataInput(''); // Clear input after adding
    }
  };

  const handleRemoveMetadataField = (fieldToRemove: string) => {
    setMetadataSchema(metadataSchema.filter(field => field !== fieldToRemove));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Node name cannot be empty.');
      return;
    }
    onSubmit({
      name: name.trim(),
      color,
      principalPorts: Number(principalPorts) || 0,
      nonPrincipalPorts: Number(nonPrincipalPorts) || 0,
      metadataSchema,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="atomic-node-form">
      <div className="form-group">
        <label htmlFor="node-name">Name:</label>
        <input
          id="node-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="node-color">Color:</label>
        <input
          id="node-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>

      <div className="form-group port-group">
        <label htmlFor="principal-ports">Principal Ports:</label>
        <input
          id="principal-ports"
          type="number"
          min="0"
          value={principalPorts}
          onChange={(e) => setPrincipalPorts(parseInt(e.target.value, 10))}
        />
      </div>

       <div className="form-group port-group">
        <label htmlFor="non-principal-ports">Non-Principal Ports:</label>
        <input
          id="non-principal-ports"
          type="number"
          min="0"
          value={nonPrincipalPorts}
          onChange={(e) => setNonPrincipalPorts(parseInt(e.target.value, 10))}
        />
      </div>

      <div className="form-group metadata-group">
        <label htmlFor="metadata-input">Metadata Fields:</label>
        <div className="metadata-input-row">
          <input
            id="metadata-input"
            type="text"
            value={metadataInput}
            onChange={(e) => setMetadataInput(e.target.value)}
            placeholder="label, size, etc."
          />
          <button type="button" onClick={handleAddMetadataField} className="add-metadata-button">
            Add
          </button>
        </div>
        <ul className="metadata-list">
          {metadataSchema.map((field) => (
            <li key={field}>
              {field}
              <button type="button" onClick={() => handleRemoveMetadataField(field)} className="remove-metadata-button">
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <button type="submit" className="submit-button">Create Node</button>
    </form>
  );
};

export default AtomicNodeForm; 