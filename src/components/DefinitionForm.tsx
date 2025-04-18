import React, { useState, FormEvent } from 'react';
import './AtomicNodeForm.css'; // Reuse styles for simplicity

interface DefinitionFormProps {
  onSubmit: (name: string, color: string) => void;
}

const DefinitionForm: React.FC<DefinitionFormProps> = ({ onSubmit }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#eeeeee'); // Default slightly lighter grey

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Definition name cannot be empty.');
      return;
    }
    onSubmit(name.trim(), color);
  };

  return (
    <form onSubmit={handleSubmit} className="atomic-node-form definition-form"> {/* Add specific class? */}
      <div className="form-group">
        <label htmlFor="definition-name">Name:</label>
        <input
          id="definition-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="form-group">
        <label htmlFor="definition-color">Color:</label>
        <input
          id="definition-color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>

      <button type="submit" className="submit-button">Create Definition</button>
    </form>
  );
};

export default DefinitionForm; 