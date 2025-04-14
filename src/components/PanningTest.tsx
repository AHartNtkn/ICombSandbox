import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

export default function PanningTest() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0, 5] }}>
        <OrbitControls 
          enableZoom={true} 
          enableRotate={false} 
          enablePan={true} 
          makeDefault 
          panSpeed={2.0}
          zoomSpeed={1.0}
        />
        <ambientLight intensity={0.8} />
        <mesh>
          <boxGeometry />
          <meshStandardMaterial color="orange" />
        </mesh>
      </Canvas>
    </div>
  );
} 