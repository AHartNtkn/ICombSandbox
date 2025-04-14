import React from 'react';
import { AtomicNodeDefinition } from '../types';
import './AtomicNodeDisplay.css'; // Styles for the display

interface AtomicNodeDisplayProps {
  node: AtomicNodeDefinition;
  isSidebar?: boolean; // Optional flag for sidebar-specific scaling/layout
}

const AtomicNodeDisplay: React.FC<AtomicNodeDisplayProps> = ({ node, isSidebar = false }) => {
  const radius = isSidebar ? 25 : 50;
  const strokeWidth = isSidebar ? 1 : 2;
  const portLineLength = isSidebar ? 8 : 15;
  const principalPortRadius = isSidebar ? 4 : 6;
  const fontSize = isSidebar ? '0.6em' : '1em';

  // Calculate the actual center based on the viewbox size
  const viewboxPadding = portLineLength + strokeWidth;
  const centerX = radius + viewboxPadding;
  const centerY = radius + viewboxPadding;
  const viewboxSize = (radius + viewboxPadding) * 2;

  const totalPorts = node.principalPorts + node.nonPrincipalPorts;
  const angleStep = totalPorts > 0 ? 360 / totalPorts : 0;

  const getPortCoords = (index: number) => {
    const angle = -90 - index * angleStep; // Reversed step direction
    const angleRad = angle * (Math.PI / 180);
    // Calculate positions relative to the actual center (centerX, centerY)
    const startX = centerX + radius * Math.cos(angleRad);
    const startY = centerY + radius * Math.sin(angleRad);
    const endX = centerX + (radius + portLineLength) * Math.cos(angleRad);
    const endY = centerY + (radius + portLineLength) * Math.sin(angleRad);
    return { startX, startY, endX, endY };
  };

  return (
    <div className={`atomic-node-display ${isSidebar ? 'sidebar-node' : ''}`}>
      <svg
        viewBox={`0 0 ${viewboxSize} ${viewboxSize}`}
        width={viewboxSize}
        height={viewboxSize}
      >
        {/* Port Lines */}
        {Array.from({ length: totalPorts }).map((_, i) => {
          const { startX, startY, endX, endY } = getPortCoords(i);
          return (
            <line
              key={`port-${i}`}
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
          fill={node.color}
          stroke="#888"
          strokeWidth={strokeWidth}
        />

        {/* Principal Port Markers */}
        {Array.from({ length: node.principalPorts }).map((_, i) => {
          const angle = -90 - i * angleStep; // Reversed step direction
          const angleRad = angle * (Math.PI / 180);
          const markerX = centerX + radius * Math.cos(angleRad);
          const markerY = centerY + radius * Math.sin(angleRad);

          return (
            <circle
              key={`principal-dot-${i}`}
              cx={markerX}
              cy={markerY}
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
          {node.name}
        </text>
      </svg>
    </div>
  );
};

export default AtomicNodeDisplay; 