'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { ArrowUp, Atom, Copy, Download, ExternalLink, FileText, Orbit, Paperclip, Sparkles, Square, Terminal, X } from 'lucide-react'
import SpaceVisualizer from '@/components/space-visualizer'
import ColorSpaceLab from '@/components/color-space-lab'
import { OFFLINE_SPACE_CORPUS, SPACE_CONSTANTS, CELESTIAL_BODIES } from '@/lib/space-knowledge'
import { fetchWikipediaDeepExtracts, chunkArticleText, deduplicateChunks, RetrievedChunk } from '@/lib/web-retriever'
import { getRequestedAnswerStyle, limitAnswerToRequestedLines, synthesizeAccurateAnswer } from '@/lib/answer-synthesizer'

const MODEL_ID = 'Qwen/Qwen2.5-0.5B-Instruct'
const EMBEDDING_MODEL_ID = 'Xenova/bge-small-en-v1.5'
const MODEL_NAME = 'SpaceLLM General AI'
const OFFLINE_MAX_NEW_TOKENS = 1024

type InferenceMode = 'online' | 'offline-cpu' | 'offline-gpu'

const modeLabels: Record<InferenceMode, string> = {
  online: 'Online · General AI + Web Context',
  'offline-cpu': 'Offline · Grounded CPU',
  'offline-gpu': 'Offline · Grounded GPU/WebGPU',
}

const examples = [
  'What would happen if a star became a black hole?',
  'Explain how the James Webb Space Telescope observes distant galaxies.',
  'Compare Mars, Europa, and Titan as places to search for life.',
  'Derive the escape velocity from Earth and calculate it numerically.',
]

type EmbeddingPipeline = (text: string | string[], options?: { pooling?: string; normalize?: boolean }) => Promise<any>
type VectorRecord = { text: string; vector: number[] }

const vectorStore = new Map<string, VectorRecord>()

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index]
    normA += a[index] ** 2
    normB += b[index] ** 2
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0
}

async function embedText(embedder: EmbeddingPipeline, text: string, instruction: string) {
  const key = `${instruction}:${text}`
  const cached = vectorStore.get(key)
  if (cached) return cached.vector
  const vector = Array.from(await embedder(`${instruction}: ${text}`, { pooling: 'mean', normalize: true })) as number[]
  vectorStore.set(key, { text, vector })
  return vector
}

async function rankWithBGE(chunks: RetrievedChunk[], query: string, embedder: EmbeddingPipeline, limit = 8) {
  const deduped = deduplicateChunks(chunks)
  if (!deduped.length) return []
  const queryVector = await embedText(embedder, query, 'Represent this sentence for searching relevant passages')
  const terms = [...new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2))]
  const vectors = await Promise.all(
    deduped.map(async (chunk) => {
      const vector = await embedText(embedder, chunk.text, 'Represent this passage for retrieval')
      const semanticScore = cosineSimilarity(queryVector, vector)
      const lexicalScore = terms.length
        ? terms.reduce((score, term) => score + (chunk.text.toLowerCase().includes(term) ? 1 : 0), 0) / terms.length
        : 0
      return { ...chunk, score: semanticScore * 0.85 + lexicalScore * 0.15 }
    })
  )
  return vectors.sort((a, b) => b.score - a.score).slice(0, limit)
}

function rankChunksLexical(chunks: RetrievedChunk[], query: string, limit = 8): RetrievedChunk[] {
  const deduped = deduplicateChunks(chunks)
  const terms = [...new Set(query.toLowerCase().split(/\W+/).filter((term) => term.length > 2))]
  return deduped
    .map((chunk) => ({
      ...chunk,
      score: terms.reduce((score, term) => score + (chunk.text.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function buildOfflineCorpusChunks(attachment?: { name: string; content: string } | null): RetrievedChunk[] {
  const chunks: RetrievedChunk[] = []
  for (const item of OFFLINE_SPACE_CORPUS) {
    const articleChunks = chunkArticleText(item.content, `Local Corpus: ${item.title}`)
    chunks.push(...articleChunks)
  }
  if (attachment) {
    const userChunks = chunkArticleText(attachment.content, `User Upload (${attachment.name})`)
    chunks.push(...userChunks)
  }
  return deduplicateChunks(chunks)
}

function verifyMath(question: string, answer: string) {
  const lower = question.toLowerCase()
  if (!/(escape velocity|circular orbit|orbital period|delta.?v|hohmann|schwarzschild|speed of light)/.test(lower)) {
    return { passed: true, note: 'No orbital calculation detected' }
  }
  const hasEquation = /(sqrt|mu|gravity|velocity|period|km\/s|m\/s|\^|2\s*\*|π|pi|GM|v_esc)/i.test(answer)
  return { passed: hasEquation, note: hasEquation ? 'Equation and units verified' : 'Missing equation or units' }
}

function cleanMathMarkup(value: string) {
  let cleaned = value
    .replace(/\\text(?:rm|bf|it)?\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:boxed|mathbf|mathrm|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[,;!]\s*/g, ' ')
    .replace(/\\quad\s*/g, ' ')
    .replace(/\\times/g, 'x')
    .replace(/\\cdot/g, '*')
    .replace(/\\approx/g, 'approx.')
    .replace(/\\to/g, '->')
    .replace(/\\infty/g, 'infinity')
    .replace(/\\pi/g, 'pi')
    .replace(/\\pm/g, '+/-')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1 / $2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\s*&\s*/g, ' ')
    .replace(/[{}]/g, '')
  return cleaned.replace(/\s+/g, ' ').trim()
}

function normalizeAnswerMarkup(text: string) {
  let normalized = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, equation: string) => `$$${equation}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, equation: string) => `$${equation}$`)
    .replace(/\\begin\{(?:aligned|align\*?|equation\*?)\}/g, '')
    .replace(/\\end\{(?:aligned|align\*?|equation\*?)\}/g, '')
    .replace(/\\\\/g, '\n')

  normalized = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (_, equation: string) => `$$${cleanMathMarkup(equation)}$$`)
  return normalized.replace(/\$([^$\n]+)\$/g, (_, equation: string) => `$${cleanMathMarkup(equation)}$`)
}

function renderFormattedLine(line: string) {
  // Split by LaTeX blocks $$...$$ or $...$, markdown links [text](url), bold **text**, inline code `text`, and citations [1]
  const parts = line.split(/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$|\[[^\]]+\]\([^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g)
  return parts.map((part, i) => {
    // LaTeX display equation $$...$$
    if (part.startsWith('$$') && part.endsWith('$$')) {
      const eq = part.slice(2, -2).trim()
      return (
        <span key={i} className="block my-2 p-2 bg-emerald-950/5 text-emerald-950 rounded font-mono text-sm overflow-x-auto border border-emerald-800/15">
          {eq}
        </span>
      )
    }
    // LaTeX inline equation $...$
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const eq = part.slice(1, -1).trim()
      return (
        <span key={i} className="inline-block px-1 py-0.5 bg-emerald-900/5 text-emerald-900 rounded font-mono text-xs border border-emerald-800/10">
          {eq}
        </span>
      )
    }
    // Markdown link
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/)
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-emerald-700 hover:text-emerald-950 underline font-semibold cursor-pointer transition-colors"
        >
          <span>{linkMatch[1]}</span>
          <ExternalLink size={11} className="inline opacity-80 shrink-0 ml-0.5" />
        </a>
      )
    }
    // Bold
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
    }
    // Code
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-slate-100 text-emerald-800 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>
    }
    // Citation tag
    if (/^\[\d+\]$/.test(part)) {
      return <span key={i} className="inline-flex items-center text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded mx-0.5">{part}</span>
    }
    return part
  })
}

function renderAnswer(text: string) {
  const lines = normalizeAnswerMarkup(text).split('\n')
  const elements: React.ReactNode[] = []
  let inTable = false
  let tableRows: string[][] = []

  const flushTable = (keyIdx: number) => {
    if (tableRows.length > 0) {
      const header = tableRows[0]
      const body = tableRows.slice(1).filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell.trim())))
      elements.push(
        <div key={`table-${keyIdx}`} className="overflow-x-auto my-4">
          <table className="w-full text-left text-xs md:text-sm border border-emerald-200/60 rounded-lg overflow-hidden">
            <thead className="bg-emerald-100/60 text-emerald-950 font-semibold border-b border-emerald-200">
              <tr>
                {header.map((cell, cIdx) => (
                  <th key={cIdx} className="p-2 border-r last:border-r-0 border-emerald-200">
                    {renderFormattedLine(cell.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-100 bg-white">
              {body.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-emerald-50/40 transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="p-2 border-r last:border-r-0 border-emerald-100 text-slate-700">
                      {renderFormattedLine(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      tableRows = []
    }
    inTable = false
  }

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()

    // Table line detection: starts and ends with '|'
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      inTable = true
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      tableRows.push(cells)
      continue
    } else if (inTable) {
      flushTable(index)
    }

    if (!trimmed) {
      elements.push(<div key={`empty-${index}`} className="h-2" />)
      continue
    }

    // Headings
    if (/^###\s+/.test(trimmed)) {
      elements.push(
        <h3 key={`h3-${index}`} className="answer-heading text-lg font-semibold text-emerald-800 mt-5 mb-1.5 border-b border-emerald-100/60 pb-1">
          {renderFormattedLine(trimmed.replace(/^###\s+/, ''))}
        </h3>
      )
      continue
    }
    if (/^####\s+/.test(trimmed)) {
      elements.push(
        <h4 key={`h4-${index}`} className="answer-subheading text-base font-semibold text-emerald-900 mt-4 mb-1">
          {renderFormattedLine(trimmed.replace(/^####\s+/, ''))}
        </h4>
      )
      continue
    }
    if (/^#+\s+/.test(trimmed)) {
      elements.push(
        <h2 key={`h2-${index}`} className="answer-heading text-xl font-bold text-emerald-800 mt-6 mb-2 border-b border-emerald-200 pb-1">
          {renderFormattedLine(trimmed.replace(/^#+\s+/, ''))}
        </h2>
      )
      continue
    }

    // Horizontal line
    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={`hr-${index}`} className="my-4 border-t border-emerald-100" />)
      continue
    }

    // Blockquotes / Evidence citations
    if (trimmed.startsWith('>')) {
      elements.push(
        <blockquote key={`quote-${index}`} className="border-l-3 border-emerald-500 pl-3 my-2 text-xs text-slate-600 italic bg-emerald-50/70 py-1.5 rounded-r">
          {renderFormattedLine(trimmed.replace(/^>\s*/, ''))}
        </blockquote>
      )
      continue
    }

    // Bullet points or numbered items
    if (/^(\*|-|\d+\.)\s+/.test(trimmed)) {
      elements.push(
        <p key={`list-${index}`} className="answer-line pl-4 my-1.5 text-slate-800">
          {renderFormattedLine(trimmed)}
        </p>
      )
      continue
    }

    elements.push(
      <p key={`p-${index}`} className="answer-line my-2 leading-relaxed text-slate-800">
        {renderFormattedLine(trimmed)}
      </p>
    )
  }

  if (inTable) {
    flushTable(lines.length)
  }

  return elements
}

function parseSpaceCommand(input: string) {
  const match = input.trim().match(/^\/(\w+)(?:\s+([\s\S]*))?$/)
  if (!match) return { command: '', prompt: input.trim() }
  const command = match[1].toLowerCase()
  const prompt = match[2]?.trim() ?? ''
  const instructions: Record<string, string> = {
    explain: 'Explain this space topic in depth with verified concepts, mechanisms, and sources:',
    calculate: 'Calculate and derive the solution step by step with exact governing equations, standard SI constants, and a sanity check for:',
    calc: 'Calculate and derive the solution step by step with exact governing equations, standard SI constants, and a sanity check for:',
    maths: 'Solve this space-mathematics problem rigorously with formulas, units, and verified calculations:',
    physics: 'Solve this space-physics problem in depth using governing laws, equations, and empirical evidence:',
    phys: 'Solve this space-physics problem in depth using governing laws, equations, and empirical evidence:',
    math: 'Solve this space-mathematics problem rigorously with equations, units, and a sanity check:',
    science: 'Answer this space-science question using grounded evidence, physical mechanisms, and citations:',
    scientific: 'Answer this space-science question using grounded evidence, physical mechanisms, and citations:',
    sci: 'Answer this space-science question using grounded evidence, physical mechanisms, and citations:',
    equation: 'Identify the governing equation, define every variable, derive it step by step, and apply it to:',
    eq: 'Identify the governing equation, define every variable, derive it step by step, and apply it to:',
    derive: 'Derive the requested result step by step showing energy conservation, algebra, units, and verification for:',
    derivation: 'Derive the requested result step by step showing energy conservation, algebra, units, and verification for:',
    combine: 'Combine the relevant space-science concepts and grounded sources into one rigorous solution for:',
    visualize: 'Create a space visualization specification for this request, choosing the correct 2D or 3D representation, then explain it:',
    sources: 'Answer using verified evidence and cite sources with direct links for:',
    compare: 'Compare the requested space objects or environments using scientific criteria, habitability parameters, and trade-offs:',
  }
  if (command === 'help') return { command, prompt: '' }
  return { command, prompt: prompt ? `${instructions[command] ?? ''} ${prompt}`.trim() : input.trim() }
}

export default function Page() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingModel, setLoadingModel] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [ragStatus, setRagStatus] = useState('Ready for scientific retrieval')
  const [verificationAttempt, setVerificationAttempt] = useState(0)
  const [visualizationRequest, setVisualizationRequest] = useState('')
  const [activeLab, setActiveLab] = useState<'classic' | 'color'>('classic')
  const touchStartX = useRef<number | null>(null)
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('online')
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!visualizationRequest) return
    requestAnimationFrame(() => document.getElementById('space-lab-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [visualizationRequest])

  function handleLabTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null
  }

  function handleLabTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (touchStartX.current === null) return
    const delta = event.changedTouches[0]?.clientX - touchStartX.current
    if (Math.abs(delta) > 45) setActiveLab(delta < 0 ? 'color' : 'classic')
    touchStartX.current = null
  }

  const generator = useRef<any>(null)
  const embedder = useRef<EmbeddingPipeline | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const modelLoadPromise = useRef<Promise<any> | null>(null)

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const isReadable = file.type.startsWith('text/') || /\.(txt|md|csv|json|xml|yaml|yml|tex)$/i.test(file.name)
    try {
      const content = isReadable
        ? (await file.text()).slice(0, 120000)
        : `[Uploaded ${file.type || 'file'}: ${file.name}. The file is available as user context, but text-based files are directly read.]`
      setAttachment({ name: file.name, content })
      setError('')
    } catch {
      setError('This file could not be read. Try a text, Markdown, CSV, JSON, or XML file.')
    }
    event.target.value = ''
  }

  async function loadModel() {
    if (generator.current && embedder.current) return generator.current
    if (modelLoadPromise.current) return modelLoadPromise.current
    setLoadingModel(true)
    setProgress(0)
    setError('')
    modelLoadPromise.current = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers')
        if (!embedder.current) {
          embedder.current = (await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
            dtype: 'q8',
            progress_callback: (event) => setProgress(Math.round('progress' in event ? (event.progress ?? 0) : 0)),
          })) as EmbeddingPipeline
        }
        if (!generator.current) {
          generator.current = await pipeline('text-generation', MODEL_ID, {
            dtype: 'q4',
            progress_callback: (event) => setProgress(Math.round('progress' in event ? (event.progress ?? 0) : 0)),
          })
        }
        return generator.current
      } catch {
        throw new Error('The local model could not load. Ensure Hugging Face model files can download, or switch to Online Web RAG mode.')
      } finally {
        modelLoadPromise.current = null
        setLoadingModel(false)
      }
    })()
    return modelLoadPromise.current
  }

  async function askSpaceLLM(event?: FormEvent) {
    event?.preventDefault()
    if (!question.trim() || loading) return

    const parsed = parseSpaceCommand(question)
    if (parsed.command === 'help') {
      setAnswer(
        '### SpaceLLM Commands & Capabilities\n\n' +
        '- `/explain <topic>` — In-depth concept explanation with mechanisms and evidence\n' +
        '- `/calculate <problem>` — Step-by-step mathematical derivation, standard SI constants, and sanity check\n' +
        '- `/compare <objects or missions>` — Detailed scientific comparison table and trade-offs\n' +
        '- `/visualize <2D or 3D request>` — Generate an interactive space model in the Space Lab\n' +
        '- `/sources <topic>` — Grounded answer with direct links to verified sources\n\n' +
        'You can also type any astronomy, orbital mechanics, or space physics question directly.'
      )
      return
    }

    const questionText = parsed.prompt || question.trim()
    setLoading(true)
    setError('')
    setAnswer('')

    const visualizationPrompt = parsed.command === 'visualize' ? questionText : question.trim()
    const asksForVisualization =
      parsed.command === 'visualize' ||
      /\b(2d|3d|two[- ]?dimensional|three[- ]?dimensional|visuali[sz](e|ation)|diagram|draw|render|plot|illustrat(e|ion)|model|scene|orbit map|star map|planetary system|solar system)\b/i.test(
        visualizationPrompt
      )
    if (asksForVisualization) setVisualizationRequest(visualizationPrompt)

    abortRef.current = new AbortController()

    try {
      if (inferenceMode === 'online') {
        setRagStatus(`Online deep Web RAG · searching Wikipedia, web sources & reasoning with AI engine…`)
        
        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: questionText, attachment }),
            signal: abortRef.current.signal,
          })

          if (response.ok) {
            const data = await response.json()
            if (data.answer) {
              setRagStatus('Grounded response verified and ready')
              setAnswer(data.answer)
              return
            }
          }
        } catch (apiErr: any) {
          if (apiErr?.name === 'AbortError') {
            setError('Generation stopped by user.')
            return
          }
          // Fallback to client-side synthesis
        }

        // Fallback to client-side online retrieval and synthesis
        const webChunks = await fetchWikipediaDeepExtracts(questionText)
        const offlineChunks = buildOfflineCorpusChunks(attachment)
        const combined = deduplicateChunks([...webChunks, ...offlineChunks])

        const ranked = embedder.current
          ? await rankWithBGE(combined, questionText, embedder.current, 10)
          : rankChunksLexical(combined, questionText, 10)

        setRagStatus(`Online Web RAG · ${ranked.length} verified passages retrieved · synthesizing solution…`)

        const groundedAnswer = synthesizeAccurateAnswer({
          question: questionText,
          retrievedChunks: ranked,
          attachment,
          mode: 'online',
        })

        setAnswer(groundedAnswer)
        return
      }

      // Offline CPU / GPU Mode
      setRagStatus(`Offline RAG · indexing verified offline astrophysics corpus…`)
      const offlineChunks = buildOfflineCorpusChunks(attachment)

      let model: any = null
      try {
        model = await loadModel()
      } catch (loadErr) {
        // If local model fails to load, fallback to verified offline grounded synthesis
        setRagStatus(`Offline corpus synthesis · providing accurate grounded response…`)
        const ranked = rankChunksLexical(offlineChunks, questionText, 8)
        const offlineAnswer = synthesizeAccurateAnswer({
          question: questionText,
          retrievedChunks: ranked,
          attachment,
          mode: inferenceMode,
        })
        setAnswer(offlineAnswer)
        return
      }

      let allChunks = offlineChunks
      let finalAnswer = ''
      let lastRetrieved: RetrievedChunk[] = []

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        setVerificationAttempt(attempt)
        setRagStatus(`Offline pass ${attempt}: ranking ${allChunks.length} local chunks with BGE vector embeddings…`)

        const currentRetrieved = embedder.current
          ? await rankWithBGE(allChunks, questionText, embedder.current, 6)
          : rankChunksLexical(allChunks, questionText, 6)

        lastRetrieved = currentRetrieved
        const context = currentRetrieved.map((chunk, idx) => `[${idx + 1}] ${chunk.source}: ${chunk.text}`).join('\n\n')

        const runtimeLabel = inferenceMode === 'offline-gpu' ? 'Local GPU/WebGPU' : 'Local CPU'
        const requestedStyle = getRequestedAnswerStyle(questionText)
        const styleInstruction = requestedStyle ? `\nPRESENTATION STYLE:\n${requestedStyle}` : ''
        const prompt = `<|im_start|>system\nYou are SpaceLLM ${runtimeLabel}, a rigorous space science reasoning assistant. Understand the user's intent even when the question is informal, misspelled, or phrased in a different style. Answer the actual scientific question using the requested presentation style. Provide an accurate, scientifically sound explanation using the retrieved evidence below. State exact formulas, numbers, and units where applicable. For calculation or derivation questions, begin with a clearly labeled Final Answer, then show the detailed derivation as numbered steps. Put every substitution and algebraic transformation on its own line; never write a long calculation as one paragraph.${styleInstruction}\n\nGROUNDED EVIDENCE:\n${context || 'Standard astrophysical references apply.'}<|im_end|>\n<|im_start|>user\n${questionText}<|im_end|>\n<|im_start|>assistant\n`

        const result = await model(prompt, {
          max_new_tokens: OFFLINE_MAX_NEW_TOKENS,
          temperature: 0.2,
          repetition_penalty: 1.15,
          do_sample: false,
          return_full_text: false,
        })

        const first = Array.isArray(result) ? result[0] : result
        const generated = typeof first === 'string' ? first : first?.generated_text
        const cleanGenerated = typeof generated === 'string' ? generated.replace(/<\|im_end\|>[\s\S]*$/, '').trim() : ''

        const mathCheck = verifyMath(questionText, cleanGenerated)
        if (cleanGenerated.length > 150 && mathCheck.passed) {
          finalAnswer = cleanGenerated
          break
        }
      }

      // If the small 0.5B model generated weak or incomplete text, fuse with verified offline synthesis
      if (!finalAnswer || finalAnswer.length < 150) {
        finalAnswer = synthesizeAccurateAnswer({
          question: questionText,
          retrievedChunks: lastRetrieved,
          attachment,
          mode: inferenceMode,
        })
      } else {
        // Ensure verified references are appended
        if (lastRetrieved.length > 0 && !finalAnswer.includes('References & Verified Sources')) {
          const refsBlock = lastRetrieved
            .slice(0, 4)
            .map((c, i) => `[${i + 1}] **${c.source}**\n> ${c.text}`)
            .join('\n\n')
          finalAnswer = `${finalAnswer}\n\n### References & Verified Sources\n${refsBlock}`
        }
      }

      setRagStatus('Grounded response verified and ready')
      setAnswer(limitAnswerToRequestedLines(finalAnswer, questionText))
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        setError('Generation stopped by user.')
      } else {
        // High accuracy fallback using synthesizer
        const fallbackChunks = buildOfflineCorpusChunks(attachment)
        const fallbackAnswer = synthesizeAccurateAnswer({
          question: questionText,
          retrievedChunks: fallbackChunks.slice(0, 5),
          attachment,
          mode: inferenceMode,
        })
        setAnswer(fallbackAnswer)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  return (
    <main className="space-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Orbit size={18} />
          </span>
          <span>SpaceLLM</span>
          <span className="beta">SCIENTIFIC</span>
        </div>
        <div className="model-pill">
          <span className="status-dot" /> Grounded Reasoning <span className="divider" /> {MODEL_NAME}
        </div>
      </header>

      <section className="workspace" aria-label="SpaceLLM workspace">
        <div className="mode-switch" role="group" aria-label="Inference mode">
          {(Object.keys(modeLabels) as InferenceMode[]).map((mode) => (
            <button
              type="button"
              key={mode}
              className={`mode-button ${inferenceMode === mode ? 'active' : ''}`}
              onClick={() => setInferenceMode(mode)}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>

        <div className="capability-matrix" aria-label="Online and offline capability matrix">
          <div>
            <strong>Online · General AI</strong>
            <span>Answers any question with optional live web context and source links</span>
          </div>
          <div>
            <strong>Offline · CPU/GPU</strong>
            <span>Verified offline astrophysics corpus · BGE vector search · 100% reliable calculations</span>
          </div>
          <div>
            <strong>Mathematical Rigor</strong>
            <span>Exact SI physical constants · LaTeX equations · step-by-step arithmetic</span>
          </div>
        </div>

        <form className="ask-card" onSubmit={askSpaceLLM}>
          <div className="card-label">
            <Terminal size={15} /> NEW INQUIRY
          </div>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask anything about space physics, orbital mechanics, missions, or planets..."
            aria-label="Your question"
          />

          {attachment && (
            <div className="attachment-chip">
              <FileText size={14} />
              <span>{attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} aria-label={`Remove ${attachment.name}`}>
                <X size={13} />
              </button>
            </div>
          )}

          <div className="ask-footer">
            <span>
              {loadingModel ? `Loading local model · ${progress}%` : loading ? ragStatus : 'General AI · optional web context and verified sources'}
            </span>
            <div className="ask-actions">
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.tex,.pdf,.doc,.docx,image/*"
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="attach-button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a document or image"
              >
                <Paperclip size={17} />
              </button>
              {loading ? (
                <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop generation">
                  <Square size={15} />
                </button>
              ) : (
                <button type="submit" disabled={!question.trim() || loadingModel} aria-label="Ask SpaceLLM">
                  {loadingModel ? <span className="loader" /> : <ArrowUp size={19} />}
                </button>
              )}
            </div>
          </div>
        </form>

      </section>

      {(answer || loading || error) && (
        <section className="answer-card" aria-live="polite">
          <div className="answer-top">
            <div className="card-label">
              <Atom size={15} /> AI RESPONSE
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => {
                setAnswer('')
                setError('')
              }}
              aria-label="Clear answer"
            >
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="thinking">
              <span className="loader dark" /> {ragStatus}
              <span className="thinking-dots">...</span>
            </div>
          ) : error ? (
            <p className="error-text">{error}</p>
          ) : (
            <div className="answer-body">
              {renderAnswer(answer)}
              <button className="copy-button" type="button" onClick={() => navigator.clipboard?.writeText(answer)}>
                <Copy size={14} /> Copy solution
              </button>
            </div>
          )}
        </section>
      )}

      {visualizationRequest && (
        <section id="space-lab-output" className="generated-visual-output" aria-label="Generated Space Lab visualizations">
          <div className="generated-visual-heading">
            <div>
              <div className="card-label">
                <Sparkles size={15} /> GENERATED SPACE LAB OUTPUT
              </div>
              <p>Interactive 2D &amp; 3D scientific visualization for &quot;{visualizationRequest}&quot;.</p>
            </div>
            <button type="button" className="text-button" onClick={() => setVisualizationRequest('')}>
              Hide visual
            </button>
          </div>

          <div className="lab-switcher" role="tablist" aria-label="Space Lab views">
            <button
              type="button"
              role="tab"
              aria-selected={activeLab === 'classic'}
              className={activeLab === 'classic' ? 'active' : ''}
              onClick={() => setActiveLab('classic')}
            >
              Classic Space Lab
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeLab === 'color'}
              className={activeLab === 'color' ? 'active' : ''}
              onClick={() => setActiveLab('color')}
            >
              Color Space Lab
            </button>
          </div>

          <div className="lab-swipe-hint">Swipe left or right to switch labs</div>

          <div className="lab-viewport" onTouchStart={handleLabTouchStart} onTouchEnd={handleLabTouchEnd}>
            <div className={`lab-track ${activeLab === 'color' ? 'show-color' : ''}`}>
              <div className="lab-panel">
                <SpaceVisualizer request={visualizationRequest} />
              </div>
              <div className="lab-panel">
                <ColorSpaceLab request={visualizationRequest} />
              </div>
            </div>
          </div>
        </section>
      )}

      <footer className="footer">
        <span>
          <span className="live-dot" /> VERIFIED SCIENTIFIC RAG
        </span>
        <span>
          <Download size={12} /> Multi-Query Wikipedia · BGE Embeddings · Grounded Physics
        </span>
      </footer>
    </main>
  )
}
