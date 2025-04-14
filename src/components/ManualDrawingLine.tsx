import React, { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DrawingWireState } from '../types';

interface ManualDrawingLineProps {
    drawingWire: DrawingWireState | null;
}

const ManualDrawingLine: React.FC<ManualDrawingLineProps> = ({ drawingWire }) => {
    const drawingLineRef = useRef<THREE.Line | null>(null);
    const drawingLineGeoRef = useRef<THREE.BufferGeometry | null>(null);
    const drawingLineMatRef = useRef<THREE.LineBasicMaterial | null>(null);
    const { scene } = useThree();

    useEffect(() => {
        // console.log("ManualDrawingLine: Mounting and creating line object.");
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(2 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        drawingLineGeoRef.current = geometry;

        const material = new THREE.LineBasicMaterial({ color: 'yellow', linewidth: 3 });
        drawingLineMatRef.current = material;

        const line = new THREE.Line(geometry, material);
        line.frustumCulled = false;
        line.visible = false;
        drawingLineRef.current = line;

        scene.add(line);
        // console.log(`ManualDrawingLine: Added line (UUID: ${line.uuid}) to scene.`);

        return () => {
            // console.log(`ManualDrawingLine: Unmounting. Removing line (UUID: ${drawingLineRef.current?.uuid})`);
            if (drawingLineRef.current) {
                scene.remove(drawingLineRef.current);
            }
            drawingLineGeoRef.current?.dispose();
            drawingLineMatRef.current?.dispose();
            // console.log("ManualDrawingLine: Disposed resources.");
            drawingLineRef.current = null;
            drawingLineGeoRef.current = null;
            drawingLineMatRef.current = null;
        };
    }, [scene]);

    useFrame((state, delta) => {
        // const logThisFrame = state.clock.elapsedTime % 0.2 < delta; // Remove log throttling

        if (!drawingLineRef.current || !drawingLineGeoRef.current) {
            // if (logThisFrame) console.log("ManualDrawingLine useFrame: Refs not ready yet.");
            return;
        }

        const line = drawingLineRef.current;
        const geometry = drawingLineGeoRef.current;
        const positions = geometry.attributes.position.array as Float32Array;

        // if (logThisFrame) {
        //     console.log(`ManualDrawingLine useFrame: drawingWire is ${drawingWire ? 'present' : 'null'}. Line visible: ${line.visible}`);
        // }

        if (drawingWire) {
            const { startX, startY, endX, endY } = drawingWire;
            const changed = positions[0] !== startX || positions[1] !== startY || positions[3] !== endX || positions[4] !== endY;

            if (changed) {
                positions[0] = startX;
                positions[1] = startY;
                positions[2] = 0.1;
                positions[3] = endX;
                positions[4] = endY;
                positions[5] = 0.1;
                geometry.attributes.position.needsUpdate = true;
                //  if (logThisFrame) {
                //     console.log(`ManualDrawingLine useFrame: Updating positions to [${startX.toFixed(1)}, ${startY.toFixed(1)}] -> [${endX.toFixed(1)}, ${endY.toFixed(1)}]`);
                // }
            }

            if (!line.visible) {
                // console.log("ManualDrawingLine useFrame: Setting line VISIBLE.");
                line.visible = true;
            }
        } else {
            if (line.visible) {
                // console.log("ManualDrawingLine useFrame: Setting line INVISIBLE.");
                line.visible = false;
            }
        }
    });

    return null;
};

export default ManualDrawingLine; 