'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars, Float, Line } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import { Box, CircleDot, Cuboid, Download } from 'lucide-react'

type ColorSpaceLabProps = { request?: string }
type Mode = '2d' | '3d'
type ColorVisual = { kind: string; name: string; accent: string; secondary: string; bodies?: string[] }

function classifyRequest(request: string): ColorVisual {
  const lower = request.toLowerCase()
  const bodies = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].filter((body) => new RegExp(`\\b${body}\\b`).test(lower))
  if (bodies.length >= 1) return { kind: 'planet-comparison', name: bodies.map((body) => body[0].toUpperCase() + body.slice(1)).join(' + '), accent: '#38bdf8', secondary: '#fbbf24', bodies }
  if (/black\s*hole|accretion|event horizon/.test(lower)) return { kind: 'black-hole', name: 'Black hole', accent: '#ff6b9d', secondary: '#7c5cff' }
  if (/galaxy|milky way/.test(lower)) return { kind: 'galaxy', name: 'Galaxy', accent: '#c084fc', secondary: '#38bdf8' }
  if (/nebula|stellar nursery/.test(lower)) return { kind: 'nebula', name: 'Nebula', accent: '#fb7185', secondary: '#22d3ee' }
  if (/rocket|spacecraft|launch/.test(lower)) return { kind: 'rocket', name: 'Launch vehicle', accent: '#fbbf24', secondary: '#fb7185' }
  if (/moon|lunar|crater/.test(lower)) return { kind: 'moon', name: 'Lunar surface', accent: '#a5b4fc', secondary: '#67e8f9' }
  if (/star|supernova/.test(lower)) return { kind: 'star', name: 'Star', accent: '#facc15', secondary: '#fb7185' }
  if (/orbit|planet|solar system/.test(lower)) return { kind: 'orbit', name: 'Planetary motion', accent: '#34d399', secondary: '#60a5fa' }
  return { kind: 'concept', name: 'Space concept', accent: '#34d399', secondary: '#60a5fa' }
}

function Planet({ name, position, color, size }: { name: string; position: [number, number, number]; color: string; size: number }) {
  return <group position={position}><mesh><sphereGeometry args={[size, 40, 40]} /><meshStandardMaterial color={color} roughness={0.68} metalness={0.08} /></mesh><mesh scale={1.08}><sphereGeometry args={[size, 32, 32]} /><meshBasicMaterial color={color} transparent opacity={0.13} /></mesh></group>
}

function ColorScene({ visual }: { visual: ColorVisual }) {
  const colors = ['#a978ff', '#38bdf8', '#fbbf24', '#fb7185', '#34d399']
  return <>
    <color attach="background" args={['#050817']} />
    <ambientLight intensity={0.45} />
    <pointLight position={[0, 2, 2]} intensity={18} distance={16} color={visual.accent} />
    <Stars radius={28} depth={18} count={1500} factor={1.7} saturation={0.35} fade speed={0.35} />
    {visual.kind === 'planet-comparison' ? <>
      <pointLight position={[0, 0, 0]} intensity={8} color="#fff4c2" />
      <mesh><sphereGeometry args={[0.72, 48, 48]} /><meshStandardMaterial color="#ffd45a" emissive="#ff9e2c" emissiveIntensity={1.1} /></mesh>
      {visual.bodies?.map((body, index) => <group key={body} rotation={[0.12 * index, 0.18 * index, 0]}><Line points={[[-3.2 + index * 1.6, 0, 0], [-1.6 + index * 1.6, 0, 0]]} color="#64748b" transparent opacity={0.5} /><Planet name={body} position={[-2.8 + index * 1.6, 0.22 * (index % 2), 0.12 * index]} color={body === 'earth' ? '#3b82f6' : body === 'mercury' ? '#a8a29e' : colors[index % colors.length]} size={body === 'jupiter' || body === 'saturn' ? 0.38 : 0.25} /></group>)}
    </> : visual.kind === 'black-hole' ? <>
      <mesh><sphereGeometry args={[0.75, 48, 48]} /><meshBasicMaterial color="#010108" /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.25, 0.22, 32, 128]} /><meshBasicMaterial color="#ff7b45" /></mesh>
      <mesh rotation={[Math.PI / 2, 0.22, 0]}><torusGeometry args={[1.85, 0.12, 24, 128]} /><meshBasicMaterial color="#ffd166" transparent opacity={0.8} /></mesh>
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.08, 0.18, 4.6, 20]} /><meshBasicMaterial color={visual.secondary} transparent opacity={0.7} /></mesh>
    </> : visual.kind === 'galaxy' ? <Float speed={1.3} rotationIntensity={0.25}><mesh><sphereGeometry args={[0.42, 32, 32]} /><meshBasicMaterial color="#fff1b8" /></mesh>{[0, 1, 2, 3].map((arm) => <mesh key={arm} rotation={[0, arm * Math.PI / 2, arm * 0.28]}><torusGeometry args={[1.8, 0.14, 12, 128]} /><meshBasicMaterial color={arm % 2 ? visual.secondary : visual.accent} transparent opacity={0.82} /></mesh>)}</Float> : visual.kind === 'nebula' ? <><mesh scale={[2.6, 1.35, 1.5]}><sphereGeometry args={[1, 40, 40]} /><meshBasicMaterial color={visual.accent} transparent opacity={0.3} /></mesh><mesh scale={[1.6, 0.9, 1.8]}><sphereGeometry args={[1, 40, 40]} /><meshBasicMaterial color={visual.secondary} transparent opacity={0.3} /></mesh></> : visual.kind === 'rocket' ? <group rotation={[0, 0, -0.3]}><mesh><cylinderGeometry args={[0.34, 0.48, 2.3, 32]} /><meshStandardMaterial color="#e6edf7" metalness={0.55} roughness={0.3} /></mesh><mesh position={[0, 1.35, 0]}><coneGeometry args={[0.34, 0.7, 32]} /><meshStandardMaterial color="#f07b56" /></mesh><mesh position={[0, -1.65, 0]}><coneGeometry args={[0.28, 1.2, 24]} /><meshBasicMaterial color="#ffb347" /></mesh></group> : visual.kind === 'moon' ? <Planet name="Moon" position={[0, 0, 0]} color="#a7b0c2" size={1.08} /> : visual.kind === 'star' ? <mesh><sphereGeometry args={[1, 48, 48]} /><meshBasicMaterial color={visual.accent} /></mesh> : <><mesh><sphereGeometry args={[0.8, 40, 40]} /><meshStandardMaterial color={visual.accent} emissive={visual.secondary} emissiveIntensity={0.4} /></mesh><mesh rotation={[Math.PI / 2.6, 0, 0]}><torusGeometry args={[1.65, 0.035, 16, 128]} /><meshBasicMaterial color={visual.secondary} /></mesh></>}
    <OrbitControls enablePan={false} minDistance={4.5} maxDistance={11} enableDamping dampingFactor={0.08} />
  </>
}

function downloadColor2dJpg(request: string) {
  const safe = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'colorful-space-lab'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760"><defs><radialGradient id="bg"><stop stop-color="#3d236d"/><stop offset="1" stop-color="#070b20"/></radialGradient></defs><rect width="1200" height="760" fill="url(#bg)"/><circle cx="600" cy="380" r="62" fill="#c084fc"/><ellipse cx="600" cy="380" rx="220" ry="125" fill="none" stroke="#38bdf8" stroke-width="5" opacity=".8"/><ellipse cx="600" cy="380" rx="370" ry="215" fill="none" stroke="#f472b6" stroke-width="5" opacity=".65"/><text x="44" y="64" fill="white" font-family="sans-serif" font-size="30">Color Space Lab · 2D</text><text x="44" y="104" fill="#d9d6f5" font-family="sans-serif" font-size="17">${request.replace(/[&<>]/g, '')}</text></svg>`
  const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 760; const context = canvas.getContext('2d'); if (!context) return; context.drawImage(image, 0, 0); canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${safe}-2d.jpg`; link.click(); URL.revokeObjectURL(url) }, 'image/jpeg', 0.94) }; image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function downloadColor3d(format: 'glb' | 'gltf', request: string) {
  const safe = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'color-space-model'
  const content = format === 'gltf' ? JSON.stringify({ asset: { version: '2.0', generator: 'Color Space Lab' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], extras: { prompt: request } }, null, 2) : new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00])
  const url = URL.createObjectURL(new Blob([content], { type: format === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary' })); const link = document.createElement('a'); link.href = url; link.download = `${safe}.${format}`; link.click(); URL.revokeObjectURL(url)
}

function downloadColorfulSvg(request: string) {
  const safe = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'colorful-space-lab'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#080d27"/><circle cx="600" cy="350" r="110" fill="#c084fc"/><text x="48" y="78" fill="white" font-size="30" font-family="system-ui">Color Space Lab: ${request.replace(/[&<>]/g, '')}</text></svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); const link = document.createElement('a'); link.href = url; link.download = `${safe}-color.svg`; link.click(); URL.revokeObjectURL(url)
}

export default function ColorSpaceLab({ request = '' }: ColorSpaceLabProps) {
  const visual = useMemo(() => classifyRequest(request), [request])
  const requestedMode: Mode = /\b3d\b|three[- ]?dimensional/i.test(request) ? '3d' : '2d'
  const [mode, setMode] = useState<Mode>(requestedMode)
  useEffect(() => setMode(requestedMode), [requestedMode])
  return <section className="visualizer-card color-space-lab" aria-label="Colorful Space Lab visualization">
    <div className="visualizer-header"><div><div className="card-label"><CircleDot size={15} /> COLOR SPACE LAB</div><h2>{visual.name} · {mode.toUpperCase()} color render</h2><p>Created from your request: {request || 'Explore a colorful space model.'}</p></div><div className="visualizer-tabs" role="group" aria-label="Color Space Lab visualization mode"><button type="button" className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')} aria-pressed={mode === '2d'}><Box size={14} /> 2D</button><button type="button" className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')} aria-pressed={mode === '3d'}><Cuboid size={14} /> 3D</button></div></div>
    {mode === '3d' ? <div className="visualizer-stage color-lab-stage color-mode-3d color-stage-canvas"><Canvas camera={{ position: [0, 6.5, 7.5], fov: 45 }} dpr={[1, 1.5]}><ColorScene visual={visual} /></Canvas><div className="visualizer-caption"><span><span className="live-dot" /> 3D COLOR MODEL CREATED</span><span>Drag to rotate · scroll to zoom</span><div className="download-group"><span>Download 3D</span><button type="button" className="visualizer-download" onClick={() => downloadColor3d('glb', request)}>GLB</button><button type="button" className="visualizer-download" onClick={() => downloadColor3d('gltf', request)}>GLTF</button></div></div></div> : <div className={`visualizer-stage color-lab-stage color-scene-${visual.kind} color-mode-2d`} role="img" aria-label={`${visual.name} colorful 2D visualization created from ${request}`}><div className="color-starfield" aria-hidden="true" />{visual.kind === 'planet-comparison' ? <div className="color-planet-row" aria-hidden="true">{visual.bodies?.map((body, index) => <span key={body} className={`color-planet color-planet-${body}`} style={{ '--planet-index': index } as React.CSSProperties} title={body} />)}</div> : visual.kind === 'black-hole' ? <div className="color-black-hole" aria-hidden="true"><span className="color-black-hole-ring" /><span className="color-black-hole-core" /></div> : visual.kind === 'galaxy' ? <div className="color-galaxy" aria-hidden="true"><span className="color-galaxy-core" /><span className="color-galaxy-arm arm-one" /><span className="color-galaxy-arm arm-two" /><span className="color-galaxy-arm arm-three" /></div> : visual.kind === 'nebula' ? <div className="color-nebula" aria-hidden="true"><span /><span /><span /></div> : visual.kind === 'rocket' ? <div className="color-rocket" aria-hidden="true"><span className="color-rocket-nose" /><span className="color-rocket-body" /><span className="color-rocket-flame" /></div> : visual.kind === 'moon' ? <div className="color-moon" aria-hidden="true"><span /><span /><span /></div> : visual.kind === 'star' ? <div className="color-star" aria-hidden="true" /> : visual.kind === 'orbit' ? <><div className="color-core" style={{ background: `radial-gradient(circle at 35% 30%, #fff7ed, ${visual.accent} 35%, ${visual.secondary})` }} aria-hidden="true" /><div className="color-orbit orbit-a" aria-hidden="true"><span style={{ background: visual.accent }} /></div><div className="color-orbit orbit-b" aria-hidden="true"><span style={{ background: visual.secondary }} /></div></> : <div className="color-concept" style={{ background: `radial-gradient(circle at 35% 30%, #fff7ed, ${visual.accent} 35%, ${visual.secondary})` }} aria-hidden="true"><span /><span /></div>}<div className="visualizer-caption"><span><span className="live-dot" /> 2D COLOR MODEL CREATED</span><span>Interactive 2D visualization</span><div className="download-group"><span>Download 2D</span><button type="button" className="visualizer-download" onClick={() => downloadColor2dJpg(request)}>JPG</button><button type="button" className="visualizer-download" onClick={() => downloadColorfulSvg(request)}>SVG</button></div></div></div>}
  </section>
}
