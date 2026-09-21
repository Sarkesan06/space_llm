'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Box, CircleDot, Cuboid, Download, Sparkles } from 'lucide-react'

type VisualMode = '2d' | '3d'
type SpaceVisualizerProps = { request?: string }

type VisualSpec = {
  mode: VisualMode
  title: string
  description: string
  kind: 'orbit' | 'system' | 'planet-comparison' | 'star' | 'black-hole' | 'galaxy' | 'nebula' | 'rocket' | 'telescope' | 'moon' | 'comet' | 'generic'
  bodies: string[]
}

function getVisualSpec(request: string): VisualSpec {
  const lower = request.toLowerCase()
  const mode: VisualMode = /\b3d\b|three[- ]?dimensional/i.test(lower) ? '3d' : '2d'
  const bodies = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].filter((body) => new RegExp(`\\b${body}\\b`, 'i').test(lower))
  const kind: VisualSpec['kind'] = bodies.length >= 2
    ? 'planet-comparison'
    : /black\s*hole|accretion\s*disk|event\s*horizon/i.test(lower)
    ? 'black-hole'
    : /nebula|emission cloud|stellar nursery/i.test(lower)
      ? 'nebula'
      : /galaxy|milky way|spiral galaxy/i.test(lower)
        ? 'galaxy'
        : /rocket|launch vehicle|spacecraft|space shuttle/i.test(lower)
          ? 'rocket'
          : /telescope|jwst|james webb|observatory/i.test(lower)
            ? 'telescope'
            : /moon|lunar|crater/i.test(lower)
              ? 'moon'
              : /comet|asteroid|meteor/i.test(lower)
                ? 'comet'
                : /orbit|trajectory|transfer|gravity|satellite/i.test(lower)
                  ? 'orbit'
                  : /solar system|planetary system|planets|sun and earth/i.test(lower)
                    ? 'system'
                    : /star|supernova/i.test(lower)
                      ? 'star'
                      : 'generic'
  const labels: Record<VisualSpec['kind'], [string, string]> = {
    orbit: ['Orbital mechanics diagram', 'Shows the central body, orbital path, moving object, and trajectory requested.'],
    system: ['Planetary system model', 'Shows the requested planets and their relative orbital structure.'],
    'planet-comparison': ['Planet comparison model', `Shows ${bodies.join(' and ')} as distinct labeled worlds rather than a generic orbit.`],
    star: ['Stellar evolution model', 'Shows a star-focused representation rather than a default planetary orbit.'],
    'black-hole': ['Black hole accretion model', 'Shows an event horizon, glowing accretion disk, and gravitational center.'],
    galaxy: ['Galaxy structure model', 'Shows a galactic core, spiral arms, and distributed stellar regions.'],
    nebula: ['Nebula cloud model', 'Shows a diffuse stellar nursery with layered gas and dust clouds.'],
    rocket: ['Launch vehicle model', 'Shows a spacecraft body, fins, engine plume, and launch trajectory.'],
    telescope: ['Space telescope model', 'Shows a telescope tube, mirror, solar panels, and observation direction.'],
    moon: ['Lunar surface model', 'Shows a moon body with craters and a terminator-like surface treatment.'],
    comet: ['Comet flyby model', 'Shows a nucleus, coma, and directional ion tail.'],
    generic: ['Space concept model', 'Shows a generated spatial interpretation of the requested space concept.'],
  }
  const [title, description] = labels[kind]
  return { mode, title, description, kind, bodies }
}

function download2dJpg(request: string) {
  const safeName = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'space-model'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#070b19"/><circle cx="600" cy="380" r="58" fill="#ffc267"/><circle cx="600" cy="380" r="58" fill="none" stroke="#ffe4a3" stroke-width="5"/><ellipse cx="600" cy="380" rx="210" ry="120" fill="none" stroke="#64748b" stroke-width="3" opacity=".8"/><ellipse cx="600" cy="380" rx="360" ry="205" fill="none" stroke="#64748b" stroke-width="3" opacity=".6"/><text x="44" y="64" fill="#f8fafc" font-family="sans-serif" font-size="30">2D Space Model</text><text x="44" y="102" fill="#aeb9d2" font-family="sans-serif" font-size="17">${request.replace(/[&<>]/g, '')}</text></svg>`
  const image = new Image()
  image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 760; const context = canvas.getContext('2d'); if (!context) return; context.drawImage(image, 0, 0); canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${safeName}-2d.jpg`; link.click(); URL.revokeObjectURL(url) }, 'image/jpeg', 0.94) }
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function download3dArtifact(format: 'glb' | 'gltf', request: string) {
  const safeName = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'space-model'
  const content = format === 'gltf' ? JSON.stringify({ asset: { version: '2.0', generator: 'SpaceLLM Space Lab' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], extras: { prompt: request } }, null, 2) : new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00])
  const blob = new Blob([content], { type: format === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${safeName}.${format}`; link.click(); URL.revokeObjectURL(url)
}

function downloadArtifact(mode: VisualMode, request: string) {
  const safeName = request.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'space-model'
  const content = mode === '2d'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560"><rect width="900" height="560" fill="#070b19"/><g fill="none" stroke="#64748b" opacity=".7"><ellipse cx="450" cy="280" rx="125" ry="75"/><ellipse cx="450" cy="280" rx="220" ry="132"/><ellipse cx="450" cy="280" rx="325" ry="195"/></g><circle cx="450" cy="280" r="30" fill="#ffc267"/><circle cx="575" cy="280" r="10" fill="#60a5fa"/><circle cx="670" cy="280" r="13" fill="#df8d66"/><circle cx="775" cy="280" r="16" fill="#a78bfa"/><text x="32" y="48" fill="#f8fafc" font-family="sans-serif" font-size="24">Space model: ${request.replace(/[&<>]/g, '')}</text></svg>`
    : `<!doctype html><title>Space model</title><style>body{margin:0;background:#070b19;color:#f8fafc;font:16px system-ui;display:grid;place-items:center;height:100vh}canvas{max-width:92vw}</style><h1>3D Space model</h1><p>${request.replace(/[&<>]/g, '')}</p><p>Open this request in SpaceLLM to explore the interactive orbit model.</p>`
  const blob = new Blob([content], { type: mode === '2d' ? 'image/svg+xml' : 'text/html' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeName}.${mode === '2d' ? 'svg' : 'html'}`
  link.click()
  URL.revokeObjectURL(url)
}

function OrbitRing({ radius, color, dashed = false }: { radius: number; color: string; dashed?: boolean }) {
  const points = useMemo(() => new THREE.EllipseCurve(0, 0, radius, radius * 0.72, 0, Math.PI * 2, false, 0).getPoints(128), [radius])
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point.x, 0, point.y))), [points])
  return <lineLoop geometry={geometry}><lineBasicMaterial color={color} transparent opacity={dashed ? 0.32 : 0.62} /></lineLoop>
}

function Planet({ radius, color, distance, speed, size }: { radius: number; color: string; distance: number; speed: number; size: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const angle = clock.getElapsedTime() * speed
    if (ref.current) ref.current.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance * 0.72)
  })
  return <mesh ref={ref} position={[distance, 0, 0]}>
    <sphereGeometry args={[size, 24, 24]} />
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} roughness={0.72} />
  </mesh>
}

function SolarSystemScene({ kind, bodies = [] }: { kind: VisualSpec['kind']; bodies?: string[] }) {
  const centerColor = kind === 'star' ? '#d9b7ff' : kind === 'generic' ? '#8be9fd' : '#ffc267'
  return <>
    <color attach="background" args={['#070b19']} />
    <ambientLight intensity={0.55} />
    <pointLight position={[0, 2, 0]} intensity={14} distance={20} color={centerColor} />
    <Stars radius={30} depth={18} count={kind === 'star' ? 1400 : 900} factor={1.4} saturation={0.15} fade speed={0.4} />
    {kind === 'black-hole' ? <>
      <mesh><sphereGeometry args={[0.7, 32, 32]} /><meshBasicMaterial color="#010108" /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.35, 0.3, 24, 128]} /><meshBasicMaterial color="#ff7b45" /></mesh>
      <mesh rotation={[Math.PI / 2, 0.15, 0]}><torusGeometry args={[2.1, 0.08, 16, 128]} /><meshBasicMaterial color="#ffd27a" transparent opacity={0.8} /></mesh>
      <pointLight position={[0, 0, 0]} intensity={26} distance={9} color="#ff9f55" />
    </> : kind === 'galaxy' ? <>
      <mesh><sphereGeometry args={[0.45, 24, 24]} /><meshBasicMaterial color="#fff1b8" /></mesh>
      {[0, 1, 2, 3].map((arm) => <mesh key={arm} rotation={[0, arm * Math.PI / 2, arm * 0.28]}><torusGeometry args={[1.8, 0.16, 10, 96]} /><meshBasicMaterial color={arm % 2 ? '#8ba8ff' : '#d4a4ff'} transparent opacity={0.72} /></mesh>)}
    </> : kind === 'nebula' ? <>
      <mesh scale={[2.2, 1.2, 1.2]}><sphereGeometry args={[1, 32, 32]} /><meshBasicMaterial color="#a875ff" transparent opacity={0.25} /></mesh>
      <mesh scale={[1.5, 0.9, 1.5]}><sphereGeometry args={[1, 32, 32]} /><meshBasicMaterial color="#42d9d0" transparent opacity={0.2} /></mesh>
      <pointLight position={[0, 0, 0]} intensity={18} distance={8} color="#ffb0e8" />
    </> : kind === 'rocket' ? <>
      <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.34, 0.5, 2.6, 24]} /><meshStandardMaterial color="#e6edf7" metalness={0.55} roughness={0.35} /></mesh>
      <mesh position={[0, 0, 1.5]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.34, 0.7, 24]} /><meshStandardMaterial color="#f07b56" /></mesh>
      <mesh position={[0, -0.18, -1.6]} rotation={[0, 0, Math.PI / 2]}><coneGeometry args={[0.3, 1.5, 20]} /><meshBasicMaterial color="#ffb347" /></mesh>
      <mesh position={[0.42, 0, -0.75]}><boxGeometry args={[0.12, 0.7, 0.55]} /><meshStandardMaterial color="#ef765e" /></mesh>
      <mesh position={[-0.42, 0, -0.75]}><boxGeometry args={[0.12, 0.7, 0.55]} /><meshStandardMaterial color="#ef765e" /></mesh>
    </> : kind === 'telescope' ? <>
      <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.48, 0.62, 2.8, 32]} /><meshStandardMaterial color="#dce7f7" metalness={0.5} roughness={0.3} /></mesh>
      <mesh position={[0, 0, 1.45]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.52, 0.08, 16, 48]} /><meshStandardMaterial color="#69c6ff" /></mesh>
      <mesh position={[0, -1.4, 0]}><cylinderGeometry args={[0.08, 0.28, 2, 16]} /><meshStandardMaterial color="#8290aa" /></mesh>
      <mesh position={[0.85, 0, 0]} rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[0.08, 1.2, 1.1]} /><meshStandardMaterial color="#4a78d1" /></mesh>
    </> : kind === 'moon' ? <>
      <mesh><sphereGeometry args={[1.15, 32, 32]} /><meshStandardMaterial color="#9ba4b5" roughness={1} /></mesh>
      {[-0.6, 0, 0.55].map((x, index) => <mesh key={index} position={[x, index * 0.25 - 0.2, 1.02]}><sphereGeometry args={[0.16 + index * 0.04, 16, 16]} /><meshBasicMaterial color="#596274" /></mesh>)}
    </> : kind === 'comet' ? <>
      <mesh><sphereGeometry args={[0.62, 24, 24]} /><meshStandardMaterial color="#c4d5e7" roughness={0.8} /></mesh>
      <mesh position={[0, 0, -2]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.85, 4, 32, 1, true]} /><meshBasicMaterial color="#80d8ff" transparent opacity={0.34} /></mesh>
      <pointLight intensity={10} distance={5} color="#b7efff" />
    </> : kind === 'planet-comparison' ? <>
      {(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const).filter((body) => bodies.includes(body)).map((body, index) => {
        const colors = { mercury: '#a8a29e', venus: '#fbbf24', earth: '#38bdf8', mars: '#ef4444', jupiter: '#d6a77a', saturn: '#e8c98a', uranus: '#67e8f9', neptune: '#2563eb' }
        const sizes = { mercury: 0.2, venus: 0.3, earth: 0.34, mars: 0.26, jupiter: 0.62, saturn: 0.52, uranus: 0.4, neptune: 0.4 }
        const x = (index - 3.5) * 1.05
        return <group key={body} position={[x, 0, 0]}><mesh><sphereGeometry args={[sizes[body], 28, 28]} /><meshStandardMaterial color={colors[body]} roughness={0.7} /></mesh>{body === 'saturn' && <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.78, 0.06, 12, 48]} /><meshBasicMaterial color="#f6d99a" /></mesh>}</group>
      })}
    </> : kind === 'orbit' || kind === 'system' ? <>
      <mesh><sphereGeometry args={[kind === 'system' ? 0.78 : 0.55, 32, 32]} /><meshBasicMaterial color={centerColor} /></mesh>
      {kind === 'system' ? <>
        <OrbitRing radius={1.7} color="#56627e" /><OrbitRing radius={2.7} color="#56627e" /><OrbitRing radius={3.8} color="#56627e" dashed />
        <Planet radius={0.78} color="#60a5fa" distance={1.7} speed={0.72} size={0.18} /><Planet radius={0.78} color="#df8d66" distance={2.7} speed={0.42} size={0.25} /><Planet radius={0.78} color="#a78bfa" distance={3.8} speed={0.24} size={0.32} />
      </> : <><OrbitRing radius={2.8} color="#60a5fa" /><Planet radius={0.55} color="#60a5fa" distance={2.8} speed={0.42} size={0.22} /></>}
    </> : <>
      <mesh><sphereGeometry args={[1.05, 32, 32]} /><meshBasicMaterial color={centerColor} /></mesh>
      <mesh scale={[1.35, 1.35, 1.35]}><sphereGeometry args={[1, 32, 32]} /><meshBasicMaterial color="#8be9fd" transparent opacity={0.12} /></mesh>
    </>}
    <OrbitControls enablePan={false} minDistance={5} maxDistance={12} />
  </>
}

export function SpaceVisualizer({ request }: SpaceVisualizerProps) {
  const [mode, setMode] = useState<VisualMode>('3d')
  const generated = Boolean(request)
  const spec = request ? getVisualSpec(request) : null
  useEffect(() => {
    if (spec) setMode(spec.mode)
  }, [spec?.mode, request])
  return <section className="visualizer-card" aria-label="Interactive space visualization">
    <div className="visualizer-header"><div><div className="card-label"><CircleDot size={15} /> SPACE LAB</div><h2>{spec?.title ?? 'See the system in motion'}</h2><p>{generated ? `Created from your request: ${request}` : 'Ask for a 2D diagram or 3D model and it will appear here automatically.'}</p>{spec && <p className="visualizer-detail">{spec.description}</p>}</div><div className="visualizer-tabs" role="group" aria-label="Visualization mode"><button type="button" className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')} aria-pressed={mode === '2d'}><Box size={14} /> 2D</button><button type="button" className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')} aria-pressed={mode === '3d'}><Cuboid size={14} /> 3D</button></div></div>
    <div className={`visualizer-stage ${mode === '2d' ? 'flat' : ''}`}>
      {mode === '3d' ? <Canvas camera={{ position: [0, 6.5, 7.5], fov: 45 }} dpr={[1, 1.5]}><SolarSystemScene kind={spec?.kind ?? 'system'} bodies={spec?.bodies} /></Canvas> : <div className={`orbit-2d visual-${spec?.kind ?? 'system'}`}>
        {spec?.kind === 'planet-comparison' && <div className="planet-comparison-2d">{spec.bodies.map((body) => <span key={body} className={`planet-token planet-${body}`} title={body} aria-label={body} />)}</div>}
        {(spec?.kind === 'orbit' || spec?.kind === 'system' || !spec) && <>
          <div className="sun-2d" />
          <div className="ring-2d ring-one"><span className="planet-2d blue" /></div>
          <div className="ring-2d ring-two"><span className="planet-2d red" /></div>
          {spec?.kind === 'system' && <div className="ring-2d ring-three"><span className="planet-2d violet" /></div>}
        </>}
        {spec?.kind === 'star' && <><div className="star-burst" aria-hidden="true" /><div className="star-core-2d" /></>}
        {spec?.kind === 'black-hole' && <><div className="black-hole-disk-2d" aria-hidden="true" /><div className="black-hole-core-2d" aria-hidden="true" /></>}
        {spec?.kind === 'galaxy' && <><div className="galaxy-arms-2d" aria-hidden="true" /><div className="galaxy-core-2d" aria-hidden="true" /></>}
        {spec?.kind === 'nebula' && <><div className="nebula-cloud-2d" aria-hidden="true" /><div className="nebula-star-2d" aria-hidden="true" /></>}
        {spec?.kind === 'rocket' && <><div className="rocket-body-2d" aria-hidden="true" /><div className="rocket-flame-2d" aria-hidden="true" /></>}
        {spec?.kind === 'telescope' && <><div className="telescope-body-2d" aria-hidden="true" /><div className="telescope-panel-2d" aria-hidden="true" /></>}
        {spec?.kind === 'moon' && <><div className="moon-body-2d" aria-hidden="true" /><div className="moon-craters-2d" aria-hidden="true" /></>}
        {spec?.kind === 'comet' && <><div className="comet-head-2d" aria-hidden="true" /><div className="comet-tail-2d" aria-hidden="true" /></>}
        {spec?.kind === 'generic' && <><div className="concept-node" aria-hidden="true" /><div className="concept-wave" aria-hidden="true" /></>}
      </div>}
      <div className="visualizer-caption"><span><span className="live-dot" /> {generated ? `${mode.toUpperCase()} MODEL CREATED` : 'LIVE ORBIT MODEL'}</span><span>{mode === '3d' ? 'Drag to rotate · scroll to zoom' : 'Interactive 2D orbital projection'}</span>{generated && <div className="download-group"><span>Download {mode === '2d' ? '2D' : '3D'}</span>{mode === '2d' ? <><button type="button" className="visualizer-download" onClick={() => download2dJpg(request ?? 'space model')}>JPG</button><button type="button" className="visualizer-download" onClick={() => downloadArtifact('2d', request ?? 'space model')}>SVG</button></> : <><button type="button" className="visualizer-download" onClick={() => download3dArtifact('glb', request ?? 'space model')}>GLB</button><button type="button" className="visualizer-download" onClick={() => download3dArtifact('gltf', request ?? 'space model')}>GLTF</button></>}</div>}</div>
    </div>
  </section>
}

export default SpaceVisualizer
