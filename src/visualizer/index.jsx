import React, { useRef, useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

const Lantern = () => {
  const coreRef = useRef();
  const wireRef = useRef();
  const hueRef = useRef(0);
  const scaleRef = useRef(1);

  useFrame(() => {
    if (coreRef.current && wireRef.current) {
      coreRef.current.rotation.x += 0.004;
      coreRef.current.rotation.y += 0.006;
      wireRef.current.rotation.x -= 0.003;
      wireRef.current.rotation.y -= 0.005;
    }

    if (window.streamAnalyser && window.visualizerDataArray) {
      // The streamAnalyser is now actually getting data since we fixed studio.js
      window.streamAnalyser.getByteFrequencyData(window.visualizerDataArray);

      let bassSum = 0;
      for (let i = 0; i < 10; i++) {
        bassSum += window.visualizerDataArray[i] || 0;
      }
      let bassAvg = bassSum / 10;

      // Make bass hit harder but not grow too massive
      let targetScale = 1 + Math.pow(bassAvg / 255, 2) * 0.8;
      scaleRef.current += (targetScale - scaleRef.current) * 0.25;

      if (coreRef.current && wireRef.current) {
        coreRef.current.scale.set(scaleRef.current, scaleRef.current, scaleRef.current);
        wireRef.current.scale.set(scaleRef.current * 1.15, scaleRef.current * 1.15, scaleRef.current * 1.15);
      }

      hueRef.current += 0.003 + (bassAvg / 255) * 0.01;
      if (hueRef.current > 1) hueRef.current -= 1;

      if (coreRef.current.material) {
        let lightness = 0.2 + Math.pow(bassAvg / 255, 2) * 0.4;
        coreRef.current.material.color.setHSL(hueRef.current, 1, 0.3);
        coreRef.current.material.emissive.setHSL(hueRef.current, 1, lightness);
      }
    }
  });

  return (
    <group>
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1.5, 2]} /> {/* High detail restored */}
        <meshStandardMaterial
          color={0xff0055}
          emissive={0xff0055}
          emissiveIntensity={1.2}
          flatShading={true}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>
      <mesh ref={wireRef}>
        <icosahedronGeometry args={[1.5, 2]} /> {/* High detail restored */}
        <meshBasicMaterial
          color={0xffffff}
          wireframe={true}
          transparent={true}
          opacity={0.25}
        />
      </mesh>
    </group>
  );
};

const Streaks = () => {
  const meshRef = useRef();
  const count = 150; // Increased count for better particle streaks
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();
      
      const dist = Math.random() * 20 + 3;
      const pos = dir.clone().multiplyScalar(dist);
      
      temp.push({ dir, pos, speed: Math.random() * 0.6 + 0.2, length: Math.random() * 4 + 1 });
    }
    return temp;
  }, [count]);

  useFrame(() => {
    let audioSpeed = 1;
    let audioHue = 0.8;
    let midAvg = 0;
    
    if (window.streamAnalyser && window.visualizerDataArray) {
      let midSum = 0;
      for (let i = 15; i < 80; i++) {
          midSum += window.visualizerDataArray[i] || 0;
      }
      midAvg = midSum / 65;
      
      audioSpeed = 1 + Math.pow(midAvg / 255, 2) * 50; 
      audioHue = (Date.now() % 4000) / 4000;
    }

    particles.forEach((p, i) => {
      p.pos.addScaledVector(p.dir, p.speed * audioSpeed * 0.05);
      
      if (p.pos.length() > 50) {
        p.pos.copy(p.dir).multiplyScalar(2 + Math.random() * 2);
      }
      
      dummy.position.copy(p.pos);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.dir);
      dummy.scale.set(0.04 + (midAvg / 255) * 0.04, p.length * audioSpeed * 0.3, 0.04 + (midAvg / 255) * 0.04);
      dummy.updateMatrix();
      
      if (meshRef.current) {
        meshRef.current.setMatrixAt(i, dummy.matrix);
        
        const color = new THREE.Color();
        color.setHSL((audioHue + (i / count) * 0.5) % 1.0, 1, 0.4 + (midAvg / 255) * 0.5); 
        meshRef.current.setColorAt(i, color);
      }
    });
    
    if (meshRef.current) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <cylinderGeometry args={[1, 1, 1, 4]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
};

const SceneRotator = ({ children }) => {
  const groupRef = useRef();
  
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.002;
      groupRef.current.rotation.x += 0.001;
    }
  });

  return <group ref={groupRef}>{children}</group>;
};

const CameraController = () => {
  const { camera } = useThree();
  const angleRef = useRef(0);
  const dirRef = useRef(1);
  const cooldownRef = useRef(0);
  const currentSpeed = useRef(0.005);
  
  useFrame(() => {
    let targetSpeed = 0.005; // Base idle speed
    
    if (window.streamAnalyser && window.visualizerDataArray) {
      let bassSum = 0;
      let totalSum = 0;
      const dataLen = window.visualizerDataArray.length;
      for (let i = 0; i < dataLen; i++) {
        if (i < 10) bassSum += window.visualizerDataArray[i] || 0;
        totalSum += window.visualizerDataArray[i] || 0;
      }
      let bassAvg = bassSum / 10;
      let totalAvg = totalSum / dataLen;
      
      // Speed up circling based on overall track energy (like BPM/intensity)
      targetSpeed = 0.002 + (totalAvg / 255) * 0.035; 
      
      // Shift directions on heavy bass hits
      if (bassAvg > 230 && cooldownRef.current <= 0) {
        dirRef.current *= -1;
        cooldownRef.current = 80; 
      }
      if (cooldownRef.current > 0) cooldownRef.current--;
    }
    
    // Smooth transition to target speed
    currentSpeed.current += (targetSpeed - currentSpeed.current) * 0.05;
    
    angleRef.current += currentSpeed.current * dirRef.current;
    
    const radius = 7;
    // Add a gentle bob up and down based on the angle
    const yOffset = Math.sin(angleRef.current * 1.5) * 1.5;
    
    // Orbit camera around 0,0,0
    camera.position.x = Math.sin(angleRef.current) * radius;
    camera.position.z = Math.cos(angleRef.current) * radius;
    camera.position.y = yOffset;
    
    camera.lookAt(0, 0, 0);
  });

  return null;
};

const LightReactor = () => {
  const lightRef = useRef();
  const ambientRef = useRef();
  const targetIntensity = useRef(2);

  useFrame(() => {
    if (window.streamAnalyser && window.visualizerDataArray) {
      let highSum = 0;
      let bassSum = 0;
      for (let i = 150; i < 220; i++) {
        highSum += window.visualizerDataArray[i] || 0;
      }
      for (let i = 0; i < 10; i++) {
        bassSum += window.visualizerDataArray[i] || 0;
      }
      let highAvg = highSum / 70;
      let bassAvg = bassSum / 10;
      
      let flash = Math.pow(highAvg / 255, 2) * 2 + Math.pow(bassAvg / 255, 3) * 1.5;
      targetIntensity.current = 0.5 + flash;
    }

    if (lightRef.current) {
      lightRef.current.intensity += (targetIntensity.current * 1.5 - lightRef.current.intensity) * 0.4;
    }
    if (ambientRef.current) {
      ambientRef.current.intensity = 0.2 + targetIntensity.current * 0.15;
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.5} />
      <pointLight ref={lightRef} position={[0, 0, 0]} intensity={2} distance={30} />
    </>
  );
};

const App = () => {
  const [disabled, setDisabled] = useState(window.visualizerDisabled || false);

  useEffect(() => {
    const handleConfigChange = () => {
      setDisabled(window.visualizerDisabled || false);
    };
    window.addEventListener('visualizer-config-changed', handleConfigChange);
    return () => window.removeEventListener('visualizer-config-changed', handleConfigChange);
  }, []);

  if (disabled) {
    return null;
  }

  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 75 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      dpr={[1, 2]}
    >
      
      <CameraController />
      <LightReactor />
      
      <SceneRotator>
        <Streaks />
        <Lantern />
      </SceneRotator>
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    mountVisualizer('react-visualizer-root');
  });
} else {
  mountVisualizer('react-visualizer-root');
}
