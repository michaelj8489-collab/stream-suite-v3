import React, { useRef, useMemo, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

const RenderManager = ({ ecoMode }) => {
  const { gl, scene, camera } = useThree();
  const lastRender = useRef(0);
  
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (ecoMode) {
       if (now - lastRender.current < 1/30) return;
    }
    lastRender.current = now;
    gl.render(scene, camera);
  }, 1); // Take over the render loop

  return null;
};

const ParticleField = () => {
  const meshRef = useRef();
  const materialRef = useRef();
  
  const count = 10000;
  const gridSize = Math.ceil(Math.sqrt(count));
  const spacing = 0.3;
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const audioTexture = useMemo(() => {
    const data = new Uint8Array(256);
    const tex = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.UnsignedByteType);
    tex.needsUpdate = true;
    return tex;
  }, []);

  useEffect(() => {
    let i = 0;
    const offset = (gridSize * spacing) / 2;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        if (i >= count) break;
        dummy.position.set(
          x * spacing - offset,
          0,
          z * spacing - offset
        );
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [dummy, gridSize, spacing, count]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uAudio: { value: audioTexture }
  }), [audioTexture]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      
      // Tap the Web Audio API securely without rerouting it
      if (window.visualizerDataArray && window.streamAnalyser) {
        window.streamAnalyser.getByteFrequencyData(window.visualizerDataArray);
        audioTexture.image.data.set(window.visualizerDataArray);
        audioTexture.needsUpdate = true;
      }
    }
    
    // Rotate the entire field slowly
    if (meshRef.current) {
        meshRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
  });

  const vertexShader = `
    uniform float uTime;
    uniform sampler2D uAudio;
    
    varying float vAudioValue;
    
    void main() {
      vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      
      float dist = length(instPos.xz);
      float audioIndex = fract(dist * 0.05); // Map distance to 0-1 texture bounds
      
      float audioVal = texture2D(uAudio, vec2(audioIndex, 0.0)).r;
      vAudioValue = audioVal;
      
      float wave = sin(instPos.x * 0.5 + uTime) * cos(instPos.z * 0.5 + uTime) * 1.5;
      float displacement = wave + (audioVal * 8.0 * exp(-dist * 0.15));
      
      vec3 finalPos = position + instPos;
      finalPos.y += displacement;
      
      vec4 mvPosition = viewMatrix * modelMatrix * vec4(finalPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    uniform float uTime;
    varying float vAudioValue;
    
    void main() {
      vec3 baseColor = vec3(0.0, 0.1, 0.3); // Deep blue
      vec3 activeColor = vec3(1.0, 0.33, 0.0); // Stream Suite Orange
      
      vec3 finalColor = mix(baseColor, activeColor, vAudioValue * 1.5);
      
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <sphereGeometry args={[0.08, 4, 4]} />
      <shaderMaterial 
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

const App = () => {
  const [ecoMode, setEcoMode] = useState(window.visualizerEcoMode || false);
  const [disabled, setDisabled] = useState(window.visualizerDisabled || false);

  useEffect(() => {
    const handleConfigChange = () => {
      setEcoMode(window.visualizerEcoMode || false);
      setDisabled(window.visualizerDisabled || false);
    };
    window.addEventListener('visualizer-config-changed', handleConfigChange);
    return () => window.removeEventListener('visualizer-config-changed', handleConfigChange);
  }, []);

  if (disabled) {
    return null; // Free GPU completely
  }

  return (
    <Canvas 
        camera={{ position: [0, 8, 15], fov: 45 }} 
        gl={{ antialias: !ecoMode, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={0.5} />
      <ParticleField />
      <OrbitControls enableZoom={false} autoRotate={false} />
      <RenderManager ecoMode={ecoMode} />
    </Canvas>
  );
};

export function mountVisualizer(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        const root = createRoot(container);
        root.render(<App />);
    }
}

// Auto-mount if the container exists
document.addEventListener('DOMContentLoaded', () => {
    mountVisualizer('react-visualizer-root');
});
