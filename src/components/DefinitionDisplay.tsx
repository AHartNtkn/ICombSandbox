import React from 'react';
import { DefinitionDefinition } from '../types';
import './AtomicNodeDisplay.css'; // Reuse styles

interface DefinitionDisplayProps {
  definition: DefinitionDefinition;
  isSidebar?: boolean; // Optional flag for sidebar-specific styling
}

const DefinitionDisplay: React.FC<DefinitionDisplayProps> = ({ definition, isSidebar = false }) => {
  // Basic display for now, just name and color
  /* return (
    <div 
      className={`definition-display ${isSidebar ? 'sidebar-node' : ''}`} 
      style={{ 
        padding: '5px 10px',
        backgroundColor: definition.color,
        borderRadius: '3px',
        textAlign: 'center',
        color: '#333' 
      }}
    >
        {definition.name}
    </div>
  ); */

  // --- SVG Rendering Logic (similar to AtomicNodeDisplay) ---
  const radius = isSidebar ? 25 : 50;
  const strokeWidth = isSidebar ? 1 : 2;
  const portLineLength = isSidebar ? 8 : 15;
  // Definitions don't show principal markers in sidebar preview (yet)
  const principalPortRadius = isSidebar ? 4 : 6;
  const fontSize = isSidebar ? '0.6em' : '1em';

  // Calculate the actual center based on the viewbox size
  const viewboxPadding = portLineLength + strokeWidth;
  const centerX = radius + viewboxPadding;
  const centerY = radius + viewboxPadding;
  const viewboxSize = (radius + viewboxPadding) * 2;

  // Use externalPorts length for total ports
  const totalPorts = definition.externalPorts.length;
  const angleStep = totalPorts > 0 ? 360 / totalPorts : 0;

  // Use the stored angles from externalPorts for positioning
  const getPortCoords = (portIndex: number) => {
    if (portIndex < 0 || portIndex >= definition.externalPorts.length) {
        console.error("Invalid index for getPortCoords in DefinitionDisplay");
        return { startX: centerX, startY: centerY, endX: centerX, endY: centerY };
    }
    const angleRad = definition.externalPorts[portIndex].angle;
    // Adjust angle to match SVG coordinate system (-90 degrees offset)
    // const angleRad = definition.externalPorts[portIndex].angle - Math.PI / 2;
    
    // Calculate positions relative to the actual center (centerX, centerY)
    const startX = centerX + radius * Math.cos(angleRad);
    // Negate the Y component for SVG's coordinate system
    const startY = centerY - radius * Math.sin(angleRad);
    const endX = centerX + (radius + portLineLength) * Math.cos(angleRad);
    // Negate the Y component for SVG's coordinate system
    const endY = centerY - (radius + portLineLength) * Math.sin(angleRad);
    return { startX, startY, endX, endY };
  };

  return (
    <div className={`definition-display atomic-node-display ${isSidebar ? 'sidebar-node' : ''}`}> {/* Reuse atomic display class */} 
      <svg
        viewBox={`0 0 ${viewboxSize} ${viewboxSize}`}
        width={viewboxSize}
        height={viewboxSize}
      >
        {/* Port Lines - Use index from 0 to totalPorts-1 */}
        {Array.from({ length: totalPorts }).map((_, i) => {
          const { startX, startY, endX, endY } = getPortCoords(i);
          return (
            <line
              key={`port-${definition.externalPorts[i]?.id ?? i}`}
              x1={startX}
              y1={startY}
              x2={endX}
              y2={endY}
              stroke="#ccc"
              strokeWidth={strokeWidth}
            />
          );
        })}

        {/* Node Body */} 
        <circle
          cx={centerX} // Use calculated center
          cy={centerY} // Use calculated center
          r={radius}
          fill={definition.color}
          stroke="#888"
          strokeWidth={strokeWidth}
        />

        {/* Principal Port Markers - Based on externalPorts.isPrincipal */} 
        {definition.externalPorts.map((port, i) => {
            if (!port.isPrincipal) return null;

            const { startX, startY } = getPortCoords(i);
            return (
              <circle
                key={`principal-dot-${port.id}`}
                cx={startX}
                cy={startY}
                r={principalPortRadius}
                fill="black"
              />
            );
        })}

        {/* Node Name */} 
        <text
          x={centerX} // Use calculated center
          y={centerY} // Use calculated center
          textAnchor="middle"
          dominantBaseline="middle"
          fill="black"
          fontSize={fontSize}
          fontWeight="bold"
        >
          {definition.name}
        </text>
      </svg>
    </div>
  );
};

export default DefinitionDisplay; 