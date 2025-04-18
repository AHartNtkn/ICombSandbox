import React, { useState, ChangeEvent, FormEvent, useCallback } from 'react';
import { AtomicNodeDefinition } from '../types';
import './MetadataPopup.css';

interface MetadataPopupProps {
  definition: AtomicNodeDefinition;
  initialValues: Record<string, any>;
  initialVisibility: Record<string, boolean>;
  screenX: number;
  screenY: number;
  onSave: (newValues: Record<string, any>, newVisibility: Record<string, boolean>) => void;
  onClose: () => void;
}

const MetadataPopup: React.FC<MetadataPopupProps> = ({ 
  definition, 
  initialValues, 
  initialVisibility,
  screenX, 
  screenY, 
  onSave, 
  onClose 
}) => {
  // Initialize state with initialValues, ensuring all schema fields are present
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initialData: Record<string, any> = { ...initialValues };
    definition.metadataSchema.forEach(key => {
      if (!(key in initialData)) {
        initialData[key] = ''; // Default to empty string if not present
      }
    });
    return initialData;
  });

  // ---> NEW: State for visibility toggles
  const [visibilityState, setVisibilityState] = useState<Record<string, boolean>>(() => {
    const initialData: Record<string, boolean> = { ...initialVisibility };
    // Default to true (visible) if not present in initialVisibility
    definition.metadataSchema.forEach(key => {
      if (!(key in initialData)) {
        initialData[key] = true; 
      }
    });
    return initialData;
  });
  // <--- END NEW

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData(prevData => ({
      ...prevData,
      [name]: value
    }));
  }, []);

  // ---> NEW: Handler for visibility checkboxes
  const handleVisibilityChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target;
    setVisibilityState(prevData => ({
      ...prevData,
      [name]: checked
    }));
  }, []);
  // <--- END NEW

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("Saving metadata:", formData, visibilityState);
    onSave(formData, visibilityState); // Pass both values and visibility
  }, [formData, visibilityState, onSave]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <div 
      className="metadata-popup-overlay" 
      onClick={handleCancel} // Close if clicking outside the popup area
    >
      <div 
        className="metadata-popup-content"
        style={{
          position: 'absolute',
          top: `${screenY}px`,
          left: `${screenX}px`,
        }}
        onClick={e => e.stopPropagation()} // Prevent overlay click when clicking inside popup
      >
        <h3>Edit {definition.name} Metadata</h3>
        <form onSubmit={handleSubmit}>
          {definition.metadataSchema.map(fieldName => (
            <div key={fieldName} className="metadata-field">
              <label htmlFor={`metadata_${fieldName}`}>{fieldName}:</label>
              <div className="metadata-input-row">
                <input
                  type="text" // Keep simple for now, could expand later
                  id={`metadata_${fieldName}`}
                  name={fieldName}
                  value={formData[fieldName] || ''} 
                  onChange={handleChange}
                />
                <input 
                  type="checkbox" 
                  id={`visibility_${fieldName}`}
                  name={fieldName} // Use fieldName for state mapping
                  checked={visibilityState[fieldName] ?? true} // Default to checked if undefined
                  onChange={handleVisibilityChange}
                  title="Toggle Visibility"
                  className="visibility-checkbox"
                />
              </div>
            </div>
          ))}
          <div className="metadata-popup-buttons">
            <button type="submit">Save</button>
            <button type="button" onClick={handleCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MetadataPopup; 