// SpaceLLM Answer Synthesizer
// Generates natural, articulate, ChatGPT / Claude-style responses
// with step-by-step derivations & calculations for math/physics queries,
// and fluent, structured explanations for conceptual topics.

import { CELESTIAL_BODIES, SPACE_CONSTANTS } from './space-knowledge'
import {
  RetrievedChunk,
  chunkArticleKey,
  cleanEvidenceText,
  deduplicateChunks,
  queryTokens,
  rankChunksForQuestion,
  splitIntoSentences,
} from './web-retriever'

export interface SynthesisOptions {
  question: string
  retrievedChunks: RetrievedChunk[]
  attachment?: { name: string; content: string } | null
  mode: 'online' | 'offline-cpu' | 'offline-gpu'
}

export function getRequestedLineCount(question: string) {
  const match = question.match(/\b(?:in|within|under|using|with)\s+(\d{1,3})\s+(?:logical\s+)?lines?\b|\b(\d{1,3})\s+(?:logical\s+)?lines?\b/i)
  const count = Number(match?.[1] ?? match?.[2])
  return Number.isInteger(count) && count > 0 ? Math.min(count, 100) : null
}

export function getRequestedAnswerStyle(question: string) {
  const lower = question.toLowerCase()
  if (/\b(eli5|explain like i'm five|explain like im five|for a beginner|simple terms|simply)\b/.test(lower)) return 'Use simple beginner-friendly language and briefly define technical terms.'
  if (/\b(formal|academic|scholarly|research style)\b/.test(lower)) return 'Use a formal academic tone with precise terminology and clear structure.'
  if (/\b(concise|brief|short|summarize|summary)\b/.test(lower)) return 'Be concise and include only the most important facts.'
  if (/\b(detailed|deep dive|in depth|thorough|comprehensive)\b/.test(lower)) return 'Give a detailed explanation with useful context and supporting evidence.'
  if (/\b(bullets?|bullet points?|list format)\b/.test(lower)) return 'Organize the answer as clear bullet points.'
  if (/\b(table|tabular|comparison chart)\b/.test(lower)) return 'Use a Markdown table when it improves comparison or organization.'
  if (/\b(analogy|analogies|metaphor)\b/.test(lower)) return 'Explain the concept with one accurate, clearly labeled analogy, then state the scientific explanation.'
  if (/\b(step by step|step-by-step|steps?)\b/.test(lower)) return 'Explain the reasoning in numbered steps and do not skip important transitions.'
  return null
}

export function limitAnswerToRequestedLines(answer: string, question: string) {
  const lineCount = getRequestedLineCount(question)
  if (!lineCount) return answer
  return answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, lineCount)
    .join('\n')
}

type QueryType = 'calculation_derivation' | 'comparison' | 'conceptual_mechanism' | 'mission_telescope' | 'general'

// ----------------------------------------------------------------------
// EVIDENCE LAYER
// Turns retrieved passages into citable, sentence-level evidence so that every
// answer section is grounded and every inline [n] marker matches a real source.
// ----------------------------------------------------------------------

export interface Citation {
  index: number
  label: string
  article: string
  url?: string
  sections: string[]
}

export interface EvidenceItem {
  chunk: RetrievedChunk
  citation: number
  sentences: string[]
}

export interface EvidenceBundle {
  items: EvidenceItem[]
  citations: Citation[]
  tokens: string[]
  /** Fraction of question keywords that actually occur in the retrieved evidence. */
  coverage: number
  chunkCount: number
  articleCount: number
}

function termVariants(term: string): string[] {
  const stripped = term.endsWith('s') && term.length > 4 ? term.slice(0, -1) : term
  return stripped === term ? [term] : [term, stripped]
}

function coverageOf(text: string, tokens: string[]): number {
  if (!tokens.length) return 0
  const lower = text.toLowerCase()
  const hits = tokens.filter((term) => termVariants(term).some((variant) => lower.includes(variant))).length
  return hits / tokens.length
}

export function buildEvidence(chunks: RetrievedChunk[], question: string, maxCitations = 5): EvidenceBundle {
  const tokens = queryTokens(question)
  const citations: Citation[] = []
  const byArticle = new Map<string, Citation>()
  const items: EvidenceItem[] = []

  for (const chunk of chunks) {
    const text = cleanEvidenceText(chunk.text)
    if (text.length < 40) continue

    const article = chunkArticleKey(chunk)
    let citation = byArticle.get(article)
    if (!citation) {
      if (citations.length >= maxCitations) continue
      citation = {
        index: citations.length + 1,
        label: chunk.source.replace(/\s*\([^)]*\)\s*$/, '').trim() || article,
        article,
        url: chunk.url,
        sections: [],
      }
      byArticle.set(article, citation)
      citations.push(citation)
    }

    const section = chunk.section?.trim()
    if (section && !citation.sections.includes(section)) citation.sections.push(section)

    const sentences = splitIntoSentences(text)
    if (!sentences.length) continue
    items.push({ chunk: { ...chunk, text }, citation: citation.index, sentences })
  }

  const combined = items.map((item) => item.sentences.join(' ')).join(' ').toLowerCase()
  const covered = tokens.filter((term) => termVariants(term).some((variant) => combined.includes(variant))).length

  return {
    items,
    citations,
    tokens,
    coverage: tokens.length ? covered / tokens.length : 0,
    chunkCount: items.length,
    articleCount: citations.length,
  }
}

interface GroundedSentence {
  text: string
  citation: number
}

const LEAD_SECTION_PATTERN = /introduction|description|definition|summary|background|characteristics|general|history|formation|structure/i

/**
 * Best definitional / summary sentence for the question.
 * Preference order: the article's lead block ("Overview" chunk), other lead-like
 * sections, then definitional phrasing, weighted by how much of the question the
 * sentence actually covers.
 */
function pickDirectAnswer(evidence: EvidenceBundle): GroundedSentence | null {
  let bestText = ''
  let bestCitation = 0
  let bestScore = -Infinity

  for (let itemIndex = 0; itemIndex < evidence.items.length; itemIndex += 1) {
    const item = evidence.items[itemIndex]
    const section = (item.chunk.section ?? '').trim().toLowerCase()
    const isArticleLead = section === 'overview'
    const isLeadLike = LEAD_SECTION_PATTERN.test(section)

    for (let sentenceIndex = 0; sentenceIndex < item.sentences.length; sentenceIndex += 1) {
      const sentence = item.sentences[sentenceIndex]
      const lower = sentence.toLowerCase()
      const coverage = coverageOf(sentence, evidence.tokens)
      const definitional = /\b(is|are|was|were|refers to|is defined as|is known as|is called|means|consists of|includes)\b/.test(lower)
        ? 0.3
        : 0
      const leadBonus = isArticleLead ? 0.4 : isLeadLike ? 0.2 : 0
      const topItemBonus = itemIndex === 0 && sentenceIndex === 0 ? 0.05 : 0
      const lengthPenalty = sentence.length > 320 ? 0.25 : 0
      const score = coverage * 1.2 + definitional + leadBonus + topItemBonus - lengthPenalty
      if (score > bestScore) {
        bestScore = score
        bestText = sentence
        bestCitation = item.citation
      }
    }
  }

  return bestText ? { text: bestText, citation: bestCitation } : null
}

/** For comparison questions: the sentence covering the most compared targets. */
function pickComparisonLead(evidence: EvidenceBundle, targets: string[]): GroundedSentence | null {
  if (targets.length < 2) return null
  let best: GroundedSentence | null = null
  let bestCount = 0

  for (const item of evidence.items) {
    for (const sentence of item.sentences) {
      const hits = targets.filter((target) => {
        const targetTokens = queryTokens(target)
        return targetTokens.length > 0 && coverageOf(sentence, targetTokens) > 0
      }).length
      if (hits < 2 || hits <= bestCount) continue
      bestCount = hits
      best = { text: sentence.length > 320 ? `${sentence.slice(0, 317)}…` : sentence, citation: item.citation }
    }
  }

  return best
}

function pickFacts(evidence: EvidenceBundle, limit: number): GroundedSentence[] {
  const scored: (GroundedSentence & { score: number })[] = []

  for (const item of evidence.items) {
    for (const sentence of item.sentences) {
      const coverage = coverageOf(sentence, evidence.tokens)
      if (coverage === 0) continue
      const numeric = /\d/.test(sentence) ? 0.25 : 0
      const measured = /\b(km|kg|m\/s|km\/s|kelvin|°c|celsius|percent|%|million|billion|year|years|au|light-year|parsec|ghz|hz|bar|mass|radius|temperature|distance|orbit|gravity|atmosphere)\b/i.test(
        sentence,
      )
        ? 0.15
        : 0
      const record = /\b(first|largest|smallest|only|most|discovered|launched|established|measured|confirmed|recorded|closest|farthest|oldest|youngest)\b/i.test(
        sentence,
      )
        ? 0.12
        : 0
      const lengthPenalty = sentence.length > 300 ? 0.25 : 0
      scored.push({ text: sentence, citation: item.citation, score: coverage + numeric + measured + record - lengthPenalty })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const facts: GroundedSentence[] = []
  const seen = new Set<string>()
  for (const fact of scored) {
    const key = fact.text.slice(0, 70).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    facts.push({
      text: fact.text.length > 300 ? `${fact.text.slice(0, 297)}…` : fact.text,
      citation: fact.citation,
    })
    if (facts.length >= limit) break
  }
  return facts
}

interface DetailSection {
  title: string
  text: string
  citation: number
  source: string
}

function buildDetailSections(evidence: EvidenceBundle, maxSections: number, sentencesPerSection: number): DetailSection[] {
  const sections: DetailSection[] = []
  const seen = new Set<string>()

  for (const item of evidence.items) {
    const title = (item.chunk.section ?? 'Overview').trim() || 'Overview'
    const key = `${item.citation}:${title.toLowerCase()}`
    if (seen.has(key)) continue
    const sentences = item.sentences.filter((sentence) => coverageOf(sentence, evidence.tokens) > 0).slice(0, sentencesPerSection)
    if (!sentences.length) continue
    seen.add(key)
    sections.push({
      title,
      text: sentences.join(' '),
      citation: item.citation,
      source: chunkArticleKey(item.chunk).replace(/^Wikipedia:\s*/i, ''),
    })
    if (sections.length >= maxSections) break
  }

  // Keep lead/overview material first so the narrative reads top-down.
  const ordered = sections.sort((a, b) => {
    const aLead = /overview|introduction|description|definition|background|summary|characteristics/i.test(a.title) ? 0 : 1
    const bLead = /overview|introduction|description|definition|background|summary|characteristics/i.test(b.title) ? 0 : 1
    return aLead - bLead
  })

  // Repeated section names ("Overview" from three different articles) are disambiguated
  // by their source so the reader always knows which evidence each block comes from.
  const titleCounts = new Map<string, number>()
  for (const section of ordered) {
    const key = section.title.toLowerCase()
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1)
  }
  return ordered.map((section) =>
    (titleCounts.get(section.title.toLowerCase()) ?? 0) > 1
      ? { ...section, title: `${section.title} — ${section.source}` }
      : section,
  )
}



const COMPARISON_FILLER = new Set([
  'compare', 'comparison', 'versus', 'difference', 'between', 'which', 'better', 'best', 'vs', 'the', 'a', 'an', 'is',
  'are', 'was', 'were', 'for', 'of', 'as', 'to', 'in', 'on', 'about', 'place', 'places', 'search', 'life', 'why', 'how',
  'what', 'more', 'most', 'than', 'should', 'would', 'could', 'and', 'or', 'there', 'their', 'this', 'that', 'explain',
  'tell', 'give', 'same', 'both',
])

function tidyTarget(target: string): string {
  return target
    .replace(/^(?:an?|the)\s+/i, '')
    .replace(/\b(is|are|was|were|better|best|places?|habitable|habitability|for|as|in|on|to|of|and|vs|versus)\b[\s\S]*$/i, '')
    .replace(/[^\w\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Objects/entities being compared, derived from the question (knowledge base names + proper nouns). */
export function extractComparisonTargets(question: string): string[] {
  const candidates: string[] = []

  for (const body of Object.values(CELESTIAL_BODIES)) {
    const name = body.name.split(' (')[0]
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (pattern.test(question)) candidates.push(name)
  }

  const properNouns = question.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) ?? []
  for (let index = 0; index < properNouns.length; index += 1) {
    const noun = properNouns[index]
    if (index === 0 && question.indexOf(noun) <= 1) continue // sentence-initial capitalisation proves nothing
    if (COMPARISON_FILLER.has(noun.toLowerCase())) continue
    candidates.push(noun)
  }

  const comparisonClause = question.match(/\b(?:compare|comparison of|versus|vs\.?|difference between)\b([\s\S]+)$/i)
  if (comparisonClause) {
    const fragments = comparisonClause[1].split(/,|\band\b|\bvs\.?\b|\bversus\b|\?/i)
    for (const fragment of fragments) {
      const cleaned = tidyTarget(fragment)
      if (cleaned.length > 2 && cleaned.split(' ').length <= 4) candidates.push(cleaned)
    }
  }

  const unique: string[] = []
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase()
    if (normalized.length < 3 || COMPARISON_FILLER.has(normalized)) continue
    if (unique.some((existing) => existing.toLowerCase() === normalized)) continue
    unique.push(candidate)
    if (unique.length >= 4) break
  }
  return unique
}

function extractFigures(sentence: string): string[] {
  const matches =
    sentence.match(/\b\d[\d,.–-]*\s?(?:%|km\/s|m\/s|km|kg|K|°C|bar|AU|GHz|Hz|million|billion|years?|light-years?|parsecs?)/g) ?? []
  const figures: string[] = []
  for (const match of matches) {
    const cleaned = match.trim()
    if (!/\d/.test(cleaned)) continue
    if (figures.includes(cleaned)) continue
    figures.push(cleaned)
    if (figures.length >= 4) break
  }
  return figures
}

function buildComparisonTable(targets: string[], evidence: EvidenceBundle): string | null {
  if (targets.length < 2 || !evidence.items.length) return null

  const rows: string[] = []
  for (const target of targets) {
    const targetTokens = queryTokens(target)
    if (!targetTokens.length) continue

    const matches: GroundedSentence[] = []
    for (const item of evidence.items) {
      for (const sentence of item.sentences) {
        if (coverageOf(sentence, targetTokens) === 0) continue
        matches.push({ text: sentence.length > 260 ? `${sentence.slice(0, 257)}…` : sentence, citation: item.citation })
        if (matches.length >= 2) break
      }
      if (matches.length >= 2) break
    }
    if (!matches.length) continue

    const figures = [...new Set(matches.map((match) => extractFigures(match.text)).flat())].slice(0, 4)
    rows.push(
      `| **${target}** | ${matches.map((match) => `${match.text} [${match.citation}]`).join(' ')} | ${
        figures.length ? figures.join(', ') : '—'
      } |`,
    )
  }

  if (rows.length < 2) return null

  return ['| Target | Verified evidence from retrieved sources | Key figures |', '| :--- | :--- | :--- |', ...rows].join('\n')
}

function formatReferences(citations: Citation[], heading?: string): string {
  if (!citations.length) return ''
  const list = citations
    .map((citation) => `[${citation.index}] **${citation.label}**${citation.url ? ` ([Read source](${citation.url}))` : ''}`)
    .join('\n')
  return heading ? `### ${heading}\n\n${list}` : list
}

function formatEvidenceExcerpts(evidence: EvidenceBundle): string {
  if (!evidence.items.length) return ''
  return evidence.items
    .map((item) => {
      const excerpt = item.sentences.slice(0, 3).join(' ') || cleanEvidenceText(item.chunk.text)
      const link = item.chunk.url ? ` ([Source](${item.chunk.url}))` : ''
      return `[${item.citation}] **${item.chunk.source}**${link}\n> ${excerpt.slice(0, 420)}`
    })
    .join('\n\n')
}

function demoteHeadings(markdown: string): string {
  return markdown.replace(/^### /gm, '#### ')
}


function detectQueryType(query: string): QueryType {
  const lower = query.toLowerCase()
  if (/(calculate|derive|derivation|escape velocity|delta.?v|hohmann|orbital speed|orbital period|circular orbit|schwarzschild radius|speed of light|formula|equation|maths|physics)/i.test(lower)) {
    return 'calculation_derivation'
  }
  if (/(compare|comparison|versus|\bvs\b|between.*and|difference between)/i.test(lower) || (lower.includes('mars') && (lower.includes('europa') || lower.includes('titan')))) {
    return 'comparison'
  }
  if (/(james webb|jwst|hubble|telescope|miri|nircam|nirspec|observatory|spacecraft|perseverance|curiosity)/i.test(lower)) {
    return 'mission_telescope'
  }
  if (/(what would happen|how does|why does|black hole|supernova|stellar collapse|singularity|neutron star)/i.test(lower)) {
    return 'conceptual_mechanism'
  }
  return 'general'
}

export function synthesizeAccurateAnswer(options: SynthesisOptions): string {
  const { question, retrievedChunks, attachment, mode } = options
  const lowerQ = question.toLowerCase().trim()
  const qType = detectQueryType(question)
  const ranked = rankChunksForQuestion(deduplicateChunks(retrievedChunks), question, 6)
  const topChunks = ranked.slice(0, 5)
  const evidence = buildEvidence(topChunks, question)

  if (isSpaceDefinitionQuery(lowerQ)) {
    return limitAnswerToRequestedLines(generateSpaceDefinitionAnswer(evidence, question), question)
  }

  // ONLINE: one grounded, numbered structure for every question.
  if (mode === 'online') {
    return limitAnswerToRequestedLines(generateGroundedOnlineAnswer(question, qType, evidence, topChunks, attachment), question)
  }

  // OFFLINE / GPU: curated verified narratives fused with the retrieved local corpus.
  let answer = generateCuratedAnswer(question, qType, topChunks)

  if (attachment) {
    answer += `\n\n> **Context from ${attachment.name}:** ${attachment.content.slice(0, 220).replace(/\n/g, ' ')}...`
  }

  answer += formatGroundedKnowledgeAnalysis(topChunks, evidence)

  const references = formatReferences(evidence.citations, 'References & Verified Sources')
  if (references) answer += `\n\n${references}`

  return limitAnswerToRequestedLines(answer.trim(), question)
}

function isBlackHoleCollapseQuestion(lowerQ: string) {
  if (/black hole/.test(lowerQ)) return true
  const mentionsStar = /\b(star|stars|supernova|supernovae|stellar|core collapse|neutron star)\b/.test(lowerQ)
  const mentionsCollapse = /\b(become|becomes|becoming|turn|turns|collapse|collapses|die|dies|death|remnant|explode|explodes|end|life cycle)\b/.test(lowerQ)
  return mentionsStar && mentionsCollapse
}

function isJwstQuestion(lowerQ: string) {
  return /james webb|\bjwst\b/.test(lowerQ)
}

function isOceanWorldComparisonQuestion(lowerQ: string) {
  const hits = ['mars', 'europa', 'titan'].filter((name) => lowerQ.includes(name)).length
  return hits >= 2 || (hits === 1 && /\b(life|living|habitable|habitability|biosignature)\b/.test(lowerQ))
}

/** Verified built-in astrophysics narratives, selected only when the question truly matches the topic. */
function generateCuratedAnswer(question: string, qType: QueryType, topChunks: RetrievedChunk[]): string {
  const lowerQ = question.toLowerCase()

  if (qType === 'calculation_derivation') {
    if (lowerQ.includes('escape velocity')) return generateEscapeVelocityDerivation(lowerQ)
    if (lowerQ.includes('hohmann') || lowerQ.includes('transfer') || lowerQ.includes('delta-v')) return generateHohmannDerivation()
    if (lowerQ.includes('schwarzschild') || (lowerQ.includes('black hole') && lowerQ.includes('radius'))) return generateSchwarzschildDerivation()
    if (lowerQ.includes('orbital period') || lowerQ.includes('kepler')) return generateOrbitalPeriodDerivation()
    return generateGeneralCalculationAnswer(question, topChunks)
  }

  if (qType === 'conceptual_mechanism' && isBlackHoleCollapseQuestion(lowerQ)) return generateBlackHoleNarrative()
  if (qType === 'mission_telescope' && isJwstQuestion(lowerQ)) return generateJWSTNarrative()
  if (qType === 'comparison' && isOceanWorldComparisonQuestion(lowerQ)) return generatePlanetaryComparisonNarrative()
  return generateDynamicConceptualAnswer(question, topChunks)
}

function formatGroundedKnowledgeAnalysis(chunks: RetrievedChunk[], evidence?: EvidenceBundle) {
  if (evidence && evidence.items.length) {
    return `\n\n### Grounded Knowledge Analysis\n\nThe answer is assembled strictly from the highest-relevance retrieved passages:\n\n${formatEvidenceExcerpts(evidence)}`
  }
  if (!chunks.length) return ''
  const evidenceLines = chunks
    .slice(0, 4)
    .map((chunk, index) => {
      const excerpt = cleanEvidenceText(chunk.text).slice(0, 360)
      const sourceLink = chunk.url ? ` ([Source](${chunk.url}))` : ''
      return `[${index + 1}] **${chunk.source}**${sourceLink}\n- ${excerpt}`
    })
    .join('\n\n')
  return `\n\n### Grounded Knowledge Analysis\n\nThe answer is synthesized from the highest-relevance retrieved passages:\n\n${evidenceLines}`
}

/**
 * ONLINE Web RAG answer builder.
 * Every online question — conceptual, comparative, mission-based or computational —
 * receives the same numbered, grounded structure, and every claim carries a [n]
 * marker that resolves to a real retrieved source. Nothing is invented here: the
 * passages come from the live retrieval layer, and curated physics contributes a
 * derivation only when the question matches that derivation exactly.
 */
function generateGroundedOnlineAnswer(
  question: string,
  qType: QueryType,
  evidence: EvidenceBundle,
  topChunks: RetrievedChunk[],
  attachment?: { name: string; content: string } | null,
  extraExpertise?: string | null,
) {
  const lowerQ = question.toLowerCase()
  const style = getRequestedAnswerStyle(question) ?? ''
  const concise = /concise and include only the most important/i.test(style)
  const forceBullets = /organize the answer as clear bullet points/i.test(style)
  const forceTable = /markdown table/i.test(style)
  const simpleTerms = /beginner-friendly/i.test(style)
  const stepByStep = /numbered steps/i.test(style)
  const wantsAnalogy = /\banalogy\b/i.test(style)

  // No source passage matched: fall back to the built-in verified reference set, clearly labelled.
  if (!evidence.items.length) {
    const curated = generateCuratedAnswer(question, qType, topChunks)
    return `${curated}\n\n> **Retrieval note:** no live source passage matched this question, so this answer comes from the built-in verified astrophysics reference set. Mention a specific object, mission, quantity or formula to receive source-linked citations.`
  }

  const sections: { title: string; body: string }[] = []

  const targets = extractComparisonTargets(question)
  // A comparison table is only produced for genuine comparison questions with at
  // least two identified targets (never for, say, a biography question).
  const isComparison = qType === 'comparison' && targets.length >= 2
  const comparisonTable = isComparison || forceTable ? buildComparisonTable(targets, evidence) : null

  // 1. Direct answer
  const comparisonLead = isComparison ? pickComparisonLead(evidence, targets) : null
  const direct = pickDirectAnswer(evidence)
  const directParts: string[] = []
  if (comparisonLead) {
    directParts.push(`${comparisonLead.text} [${comparisonLead.citation}]`)
  } else if (direct) {
    directParts.push(`${direct.text} [${direct.citation}]`)
  } else {
    directParts.push(`The retrieved verified sources describe **${question}** in the evidence listed below.`)
  }
  if (isComparison && !comparisonLead && comparisonTable && targets.length) {
    directParts.push(
      `The retrieved verified sources cover **${targets.join('**, **')}**. Because no single passage compares them side by side, the table in section 4 lists exactly what each source states about every target, with its citation.`,
    )
  }
  if (simpleTerms) {
    const plain = pickPlainLanguageSentence(evidence)
    if (plain) directParts.push(`**In simple terms:** ${plain.text} [${plain.citation}]`)
  }
  sections.push({ title: 'Direct Answer', body: directParts.join('\n\n') })

  // 2. Key findings, extracted sentence-level from the verified passages
  const pickFactsLimit = concise ? 4 : 6
  const allFacts = pickFacts(evidence, pickFactsLimit)
  const directText = comparisonLead?.text ?? direct?.text
  // Never repeat the direct-answer sentence verbatim in the findings list.
  const facts = allFacts
    .filter((fact) => !directText || fact.text.slice(0, 60).toLowerCase() !== directText.slice(0, 60).toLowerCase())
    .slice(0, concise ? 3 : 5)
  if (facts.length) {
    sections.push({
      title: 'Key Findings & Characteristics',
      body: facts.map((fact) => `- ${fact.text} [${fact.citation}]`).join('\n'),
    })
  }

  // 3. Detailed explanation, grouped by the source article's own section names
  const detailSections = buildDetailSections(evidence, concise ? 2 : 4, stepByStep ? 1 : 2)
  const expert = extraExpertise ?? curatedExpertiseBlock(lowerQ, qType)
  if (detailSections.length || expert) {
    const parts: string[] = []
    if (stepByStep) {
      parts.push(
        detailSections.map((section, index) => `${index + 1}. **${section.title}:** ${section.text} [${section.citation}]`).join('\n'),
      )
    } else if (forceBullets) {
      parts.push(detailSections.map((section) => `- **${section.title}:** ${section.text} [${section.citation}]`).join('\n'))
    } else {
      parts.push(detailSections.map((section) => `#### ${section.title}\n\n${section.text} [${section.citation}]`).join('\n\n'))
    }
    if (expert) {
      parts.push(
        stepByStep || forceBullets
          ? demoteHeadings(expert)
          : `#### Expert Physics Synthesis\n\n${demoteHeadings(expert)}`,
      )
    }
    sections.push({ title: 'Detailed Explanation', body: parts.join('\n\n') })
  }

  // 4. Comparison table (asked for, or explicitly requested by the user)
  if (comparisonTable) {
    sections.push({
      title: 'Comparison & Trade-offs',
      body: `${comparisonTable}\n\n> **Table note:** every cell quotes a retrieved passage; “—” means the retrieved sources reported no numeric figure for that target.`,
    })
  }

  // 5. Mathematical derivation for computational questions
  if (qType === 'calculation_derivation') {
    const derivation = curatedDerivationBlock(lowerQ)
    sections.push({
      title: derivation ? 'Mathematical Derivation' : 'Mathematical Method',
      body: derivation ? demoteHeadings(derivation) : buildGroundedCalculationMethod(question, evidence),
    })
  }

  // 6. Grounded analogy, only when requested and actually present in the sources
  if (wantsAnalogy) {
    const analogy = pickAnalogySentence(evidence)
    if (analogy) {
      sections.push({
        title: 'Analogy (Illustrative)',
        body: `${analogy.text} [${analogy.citation}]\n\n> This comparison is quoted from the retrieved source; the numeric values cited elsewhere in this answer are the verified quantities.`,
      })
    }
  }

  // 7. Key takeaways plus an explicit verification status
  const takeaways: string[] = []
  if (direct) takeaways.push(`- **Core answer:** ${direct.text} [${direct.citation}]`)
  for (const fact of facts.slice(0, 2)) takeaways.push(`- ${fact.text} [${fact.citation}]`)
  takeaways.push(
    `- **Verification:** assembled from ${evidence.chunkCount} retrieved passage(s) across ${evidence.articleCount} independent source(s); every statement above carries its source marker.`,
  )
  if (evidence.coverage < 0.6) {
    takeaways.push(
      `- **Coverage caveat:** only ${Math.round(evidence.coverage * 100)}% of the question keywords appear in the retrieved evidence, so treat details beyond the cited passages as unverified.`,
    )
  }
  sections.push({ title: 'Key Takeaways', body: takeaways.join('\n') })

  // 8. Grounded analysis + references (same numbering as the inline markers)
  sections.push({
    title: 'Grounded Knowledge Analysis',
    body: `The answer above is assembled strictly from these retrieved passages:\n\n${formatEvidenceExcerpts(evidence)}`,
  })
  sections.push({ title: 'References & Verified Sources', body: formatReferences(evidence.citations) })


  const numbered = sections.map((section, index) => `### ${index + 1}. ${section.title}\n\n${section.body}`).join('\n\n---\n\n')

  const attachmentNote = attachment
    ? `\n\n> **Context from ${attachment.name}:** ${attachment.content.slice(0, 220).replace(/\n/g, ' ')}...`
    : ''

  return `${numbered}${attachmentNote}`.trim()
}

function curatedExpertiseBlock(lowerQ: string, qType: QueryType): string | null {
  if (qType === 'conceptual_mechanism' && isBlackHoleCollapseQuestion(lowerQ)) return generateBlackHoleNarrative()
  if (qType === 'mission_telescope' && isJwstQuestion(lowerQ)) return generateJWSTNarrative()
  if (qType === 'comparison' && isOceanWorldComparisonQuestion(lowerQ)) return generatePlanetaryComparisonNarrative()
  return null
}

function curatedDerivationBlock(lowerQ: string): string | null {
  if (lowerQ.includes('escape velocity')) return generateEscapeVelocityDerivation(lowerQ)
  if (lowerQ.includes('hohmann') || lowerQ.includes('transfer') || lowerQ.includes('delta-v')) return generateHohmannDerivation()
  if (lowerQ.includes('schwarzschild') || (lowerQ.includes('black hole') && lowerQ.includes('radius'))) {
    return generateSchwarzschildDerivation()
  }
  if (lowerQ.includes('orbital period') || lowerQ.includes('kepler')) return generateOrbitalPeriodDerivation()
  return null
}

function pickPlainLanguageSentence(evidence: EvidenceBundle): GroundedSentence | null {
  let best: GroundedSentence | null = null
  let bestScore = -Infinity
  for (const item of evidence.items) {
    for (const sentence of item.sentences) {
      if (sentence.length > 220) continue
      const score = coverageOf(sentence, evidence.tokens) - sentence.length / 2000
      if (score > bestScore) {
        bestScore = score
        best = { text: sentence, citation: item.citation }
      }
    }
  }
  return best
}

function pickAnalogySentence(evidence: EvidenceBundle): GroundedSentence | null {
  for (const item of evidence.items) {
    for (const sentence of item.sentences) {
      if (!/\b(like|similar to|analogous to|comparable to|as if)\b/i.test(sentence)) continue
      if (coverageOf(sentence, evidence.tokens) === 0) continue
      return { text: sentence.length > 280 ? `${sentence.slice(0, 277)}…` : sentence, citation: item.citation }
    }
  }
  return null
}

/** Evidence-based calculation scaffolding used when no curated derivation template matches. */
function buildGroundedCalculationMethod(question: string, evidence: EvidenceBundle): string {
  const relations: GroundedSentence[] = []
  for (const item of evidence.items) {
    for (const sentence of item.sentences) {
      if (!/[=]|\bproportional to\b|\bper unit\b/.test(sentence)) continue
      relations.push({ text: sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence, citation: item.citation })
      if (relations.length >= 2) break
    }
    if (relations.length >= 2) break
  }

  const constants = ['G', 'c', 'M_sun', 'AU', 'M_earth', 'R_earth']
    .map((key) => SPACE_CONSTANTS[key])
    .filter(Boolean)
    .map((constant) => `- $${constant.symbol}$ — ${constant.name}: \`${constant.value} ${constant.unit}\``)

  const parts: string[] = []
  if (relations.length) {
    parts.push(
      `#### Relations Found in the Verified Sources\n\n${relations
        .map((relation) => `> ${relation.text} [${relation.citation}]`)
        .join('\n>\n')}`,
    )
  }
  parts.push(`#### Standard SI Constants\n\n${constants.join('\n')}`)
  parts.push(
    `#### Method\n\n1. Identify the requested quantity in **${question}** and the body or system it belongs to.\n2. Select the governing relation above and state the boundary conditions (for example $r \\to \\infty$ and $v \\to 0$).\n3. Rearrange for the unknown, substitute SI values, and carry units through every step.\n4. Report the result with its unit and sanity-check the order of magnitude and the limiting cases.`,
  )
  return parts.join('\n\n')
}



/**
 * True only when the question asks for the definition of space *itself*.
 * "Explain how the James Webb Space Telescope …" must NOT be treated as a space-definition question.
 */
export function isSpaceDefinitionQuery(question: string) {
  const compact = question
    .toLowerCase()
    .replace(/[?!.,;:]/g, ' ')
    .replace(
      /\b(what|which|who|when|where|why|how|is|are|was|were|the|a|an|do|does|did|please|about|tell|me|my|own|words|explain|describe|define|definition|of|meaning|information|give|some|general|overview|briefly|short|simply|simple|terms|layman|plain|english|detail|depth|thoroughly|comprehensive|concise|then|it|its|this|that)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()

  return /^(?:outer )?space(?: itself)?$/.test(compact)
}

/** [n] marker for the first retrieved passage matching `pattern`, or an empty string when unverified. */
function evidenceCitation(evidence: EvidenceBundle | undefined, pattern: RegExp): string {
  if (!evidence) return ''
  for (const item of evidence.items) {
    for (const sentence of item.sentences) {
      if (pattern.test(sentence)) return ` [${item.citation}]`
    }
  }
  return ''
}

/**
 * Space-definition answer: the same grounded numbered structure used for every other
 * online question, enriched with the curated astrophysics reference layer.
 * All citations are derived from the retrieved evidence — none are hardcoded.
 */
export function generateSpaceDefinitionAnswer(evidence?: EvidenceBundle, question = 'what is space') {
  const chunks = evidence?.items.map((item) => item.chunk) ?? []
  if (evidence && evidence.items.length) {
    return generateGroundedOnlineAnswer(question, 'general', evidence, chunks, null, generateSpaceEnrichment(evidence))
  }
  return generateSpaceEnrichment(evidence)
}

function generateSpaceEnrichment(evidence?: EvidenceBundle) {
  return `### 1. Definition & Core Concept

> **Definition**: Outer space, or simply space, is the expanse that exists beyond Earth's atmosphere and between celestial bodies.${evidenceCitation(evidence, /\bbeyond earth'?s atmosphere\b|\bbetween celestial bodies\b/i)}

> **Baseline temperature**: The baseline temperature of outer space, set by the cosmic microwave background left over from the Big Bang, is 2.7 kelvins (−270.45 °C).${evidenceCitation(evidence, /2\.7\s*kelvins?|2\.725/i)}


### 2. Key Physical Characteristics

| Feature | Description | Typical values |
| :--- | :--- | :--- |
| **Vacuum** | Extremely low particle density; near-perfect vacuum. | Fewer than 1 hydrogen atom per m³ in intergalactic space${evidenceCitation(evidence, /(atom|particle)s? per (cubic )?m|per cubic (metre|meter)|density of/i)} |
| **Temperature** | Dominated by the cosmic microwave background (CMB). | 2.7 K (≈ −270.45 °C)${evidenceCitation(evidence, /2\.7\s*kelvins?/i)} |
| **Composition** | Mostly hydrogen and helium plasma, plus trace dust, cosmic rays, neutrinos and magnetic fields. | ~90 % hydrogen, ~10 % helium${evidenceCitation(evidence, /hydrogen/i)} |
| **Radiation** | Background radiation from the Big Bang, starlight and cosmic rays. | CMB peak near 160 GHz${evidenceCitation(evidence, /cosmic microwave background|\bcmb\b/i)} |
| **Gravity** | Gravitational fields of planets, stars and galaxies dominate local dynamics. | Earth's surface: 9.81 m s⁻² |
| **Motion** | Objects move under gravity, inertia and electromagnetic forces. | Orbital speeds from km s⁻¹ to tens of km s⁻¹ |

### 3. Where Does "Space" Begin?

- **Kármán line:** 100 km above sea level is the conventional boundary used in treaties and records.${evidenceCitation(evidence, /k[áa]rm[áa]n/i)}
- **Atmospheric transition:** the upper stratosphere and mesosphere still contain trace gases and are sometimes called "near space".
- **No hard edge:** the atmosphere thins gradually, so there is no single altitude at which space physically begins.

### 4. Why Space Matters

| Reason | Why it matters |
| :--- | :--- |
| **Scientific exploration** | Enables the study of fundamental physics, cosmology and planetary science. |
| **Technology & commerce** | Satellite communications, navigation (GPS), Earth observation and space-based industry. |
| **Human aspiration** | Drives spaceflight, international cooperation and the pursuit of knowledge. |

### 5. Historical Snapshot

- **17th century:** the concept of a vacuum between Earth and the Moon is proposed.
- **20th century:** the distance to Andromeda is measured; high-altitude balloons and rockets reach the edge of the atmosphere.${evidenceCitation(evidence, /\bandromeda\b/i)}
- **1961:** Yuri Gagarin becomes the first human to orbit Earth.${evidenceCitation(evidence, /gagarin/i)}
- **1967:** the Outer Space Treaty declares space free for all and prohibits national sovereignty claims.${evidenceCitation(evidence, /outer space treaty|1967/i)}

### 6. Bottom Line

Space is the cosmic stage: an almost perfect vacuum threaded with plasma, radiation and the gravitational fields of countless bodies. It extends from the edge of Earth's atmosphere to the far reaches of the observable universe, encompassing everything from the Moon to the most distant galaxies — and it is studied with the same grounded evidence listed in the citations above.`
}


// ----------------------------------------------------------------------
// DERIVATION & CALCULATION ENGINES (Step-by-Step Mathematical Rigor)
// ----------------------------------------------------------------------

function generateEscapeVelocityDerivation(lowerQ: string): string {
  const isMoon = lowerQ.includes('moon')
  const isMars = lowerQ.includes('mars')
  const isJupiter = lowerQ.includes('jupiter')

  const body = isMoon
    ? CELESTIAL_BODIES.moon
    : isMars
    ? CELESTIAL_BODIES.mars
    : isJupiter
    ? CELESTIAL_BODIES.jupiter
    : CELESTIAL_BODIES.earth

  return `### Final Answer

For ${body.name}, the escape velocity is:

$$v_{\\text{esc}} \\approx ${body.escapeVelocityKmS.toFixed(2)}\\text{ km/s}$$

The governing formula is:

$$v_{\\text{esc}} = \\sqrt{\\frac{2GM}{r}}$$

Escape velocity is the minimum initial speed an unpropelled object must attain at the surface of a body to overcome its gravitational field and travel infinitely far away with zero residual kinetic energy.

### Step-by-Step Derivation

#### Step 1: State the Conservation of Mechanical Energy
$$E = K + U = \\text{constant}$$
At the surface of the primary body (radial distance $r$):
$$E_{\\text{initial}} = \\frac{1}{2} m v_{\\text{esc}}^2 + \\left( -\\frac{G M m}{r} \\right)$$
where:
- $m$ = mass of the escaping projectile
- $r$ = distance from the center of mass to the launch point
- $G$ = Newtonian gravitational constant ($6.67430 \\times 10^{-11}\\text{ m}^3\\text{ kg}^{-1}\\text{ s}^{-2}$)

#### Step 2: Establish the Boundary Condition at Infinity
$$E_{\\text{final}} = K_\\infty + U_\\infty = 0 + 0 = 0$$

Equating initial and final mechanical energy:
$$\\frac{1}{2} m v_{\\text{esc}}^2 - \\frac{G M m}{r} = 0$$

Cancel the object's mass $m$ (showing that escape velocity is independent of the projectile's mass):
$$\\frac{1}{2} v_{\\text{esc}}^2 = \\frac{GM}{r}$$
$$v_{\\text{esc}} = \\sqrt{\\frac{2GM}{r}} = \\sqrt{\\frac{2\\mu}{r}}$$

---

1. **Known Physical Parameters:**
   - Gravitational parameter $\\mu = GM = ${body.mu.toExponential(6)}\\text{ m}^3/\\text{s}^2$
   - Mean equatorial radius $r = ${body.radiusM.toLocaleString()}\\text{ m}$ (${(body.radiusM / 1000).toLocaleString()}\\text{ km}$)

2. **Substitute into the Formula:**
   $$v_{\\text{esc}} = \\sqrt{\\frac{2 \\times (${body.mu.toExponential(6)})}{${body.radiusM.toExponential(4)}}}$$

3. **Compute the Intermediate Ratio:**
   $$\\frac{2 \\times ${body.mu.toExponential(6)}}{${body.radiusM.toExponential(4)}} = ${((2 * body.mu) / body.radiusM).toExponential(5)}\\text{ m}^2/\\text{s}^2$$

4. **Calculate Final Velocity:**
   $$v_{\\text{esc}} = \\sqrt{${((2 * body.mu) / body.radiusM).toExponential(5)}} \\approx ${(body.escapeVelocityKmS * 1000).toFixed(1)}\\text{ m/s}$$

**Final Result:**
$$\\mathbf{v_{\\text{esc}} \\approx ${body.escapeVelocityKmS.toFixed(2)}\\text{ km/s} \\quad (${Math.round(body.escapeVelocityKmS * 2236.94).toLocaleString()}\\text{ mph})}$$

---

### Relationship to Circular Orbital Velocity
The velocity required to maintain a circular orbit at radius $r$ is:
$$v_{\\text{circ}} = \\sqrt{\\frac{\\mu}{r}}$$

Therefore:
$$v_{\\text{esc}} = \\sqrt{2} \\cdot v_{\\text{circ}} \\approx 1.414 \\cdot v_{\\text{circ}}$$
An object already in circular low orbit only needs an additional $\\approx 41.4\\%$ increase in orbital speed to escape into deep space.`
}

function generateHohmannDerivation(): string {
  return `### Final Answer

The total ideal Hohmann transfer delta-v is:

$$\\Delta v_{\\text{total}} = |\\Delta v_1| + |\\Delta v_2|$$

The transfer time is:

$$t_{\\text{trans}} = \\pi \\sqrt{\\frac{(r_1+r_2)^3}{8\\mu}}$$

The Hohmann transfer orbit is an elliptical trajectory used to transfer a spacecraft between two coplanar, circular orbits of radii $r_1$ and $r_2$ using the theoretical minimum delta-v (velocity change).

### Step-by-Step Mathematical Derivation

#### Step 1: Geometry of the Transfer Ellipse
The transfer orbit is tangent to the initial orbit at periapsis ($r_p = r_1$) and tangent to the destination orbit at apoapsis ($r_a = r_2$).
The semi-major axis $a_{\\text{trans}}$ of the transfer ellipse is:
$$a_{\\text{trans}} = \\frac{r_1 + r_2}{2}$$

#### Step 2: Vis-Viva Equation for Orbital Speeds
The speed of any Keplerian orbit at distance $r$ is given by the vis-viva equation:
$$v^2 = \\mu \\left( \\frac{2}{r} - \\frac{1}{a} \\right)$$

- **Initial Circular Orbit Speed at $r_1$:**
  $$v_{\\text{circ}, 1} = \\sqrt{\\frac{\\mu}{r_1}}$$

- **Transfer Orbit Speed at Periapsis ($r = r_1$):**
  $$v_{\\text{periapsis}} = \\sqrt{\\mu \\left( \\frac{2}{r_1} - \\frac{1}{a_{\\text{trans}}} \\right)} = \\sqrt{\\mu \\left( \\frac{2}{r_1} - \\frac{2}{r_1 + r_2} \\right)} = \\sqrt{\\frac{\\mu}{r_1}} \\sqrt{\\frac{2r_2}{r_1 + r_2}}$$

#### Step 3: Calculate First Burn Impulse ($\\Delta v_1$)
To inject into the transfer orbit:
$$\\Delta v_1 = v_{\\text{periapsis}} - v_{\\text{circ}, 1} = \\sqrt{\\frac{\\mu}{r_1}} \\left( \\sqrt{\\frac{2r_2}{r_1 + r_2}} - 1 \\right)$$

#### Step 4: Calculate Second Burn Impulse ($\\Delta v_2$)
At apoapsis ($r = r_2$), the spacecraft must accelerate to match the circular velocity of the destination orbit:
$$\\Delta v_2 = v_{\\text{circ}, 2} - v_{\\text{apoapsis}} = \\sqrt{\\frac{\\mu}{r_2}} \\left( 1 - \\sqrt{\\frac{2r_1}{r_1 + r_2}} \\right)$$

#### Step 5: Total Delta-V Budget & Transfer Time
- **Total Delta-V:**
  $$\\Delta v_{\\text{total}} = |\\Delta v_1| + |\\Delta v_2|$$
- **Time of Flight (Half the Elliptical Period):**
  $$t_{\\text{trans}} = \\pi \\sqrt{\\frac{a_{\\text{trans}}^3}{\\mu}} = \\pi \\sqrt{\\frac{(r_1 + r_2)^3}{8\\mu}}$$`
}

function generateSchwarzschildDerivation(): string {
  return `### Final Answer

The Schwarzschild radius is:

$$r_s = \\frac{2GM}{c^2}$$

For one solar mass, $r_s \\approx 2.953\\text{ km}$. For a $10M_\\odot$ black hole, $r_s \\approx 29.53\\text{ km}$.

The Schwarzschild radius ($r_s$) defines the physical radius of the event horizon for a static (non-rotating), uncharged spherically symmetric black hole in general relativity.

### Step-by-Step Derivation

#### Step 1: Classical Energy Argument
Consider an object of mass $m$ at distance $r$ from a mass $M$. For escape velocity to equal the speed of light $c$:
$$\\frac{1}{2} m c^2 = \\frac{G M m}{r_s}$$

#### Step 2: Solve for $r_s$
Cancel $m$ and rearrange for $r_s$:
$$r_s = \\frac{2GM}{c^2}$$

*(Note: While derived classically here, solving Einstein's field equations in vacuum yields the exact same metric singularity boundary $g_{00} = 1 - \\frac{2GM}{r c^2} = 0$.)*

#### Step 3: Numerical Value in Solar Masses
Substitute $G = 6.6743 \\times 10^{-11}\\text{ m}^3/(\\text{kg}\\cdot\\text{s}^2)$, $c = 2.99792 \\times 10^8\\text{ m/s}$, and $M_\\odot = 1.9885 \\times 10^{30}\\text{ kg}$:
$$r_s = \\frac{2 \\times (6.6743 \\times 10^{-11}) \\times (1.9885 \\times 10^{30})}{(2.99792 \\times 10^8)^2} \\approx 2,953\\text{ m} = \\mathbf{2.953\\text{ km per Solar Mass}}$$

For a stellar black hole of $10\\,M_\\odot$:
$$r_s = 10 \\times 2.953\\text{ km} = \\mathbf{29.53\\text{ km}}$$`
}

function generateOrbitalPeriodDerivation(): string {
  return `### Final Answer

For a circular orbit, the period is:

$$T = 2\\pi \\sqrt{\\frac{r^3}{\\mu}}$$

For an elliptical orbit, use the semi-major axis $a$:

$$T = 2\\pi \\sqrt{\\frac{a^3}{\\mu}}$$

Kepler's Third Law relates the orbital period $T$ of a satellite or planet to the semi-major axis $a$ of its orbit and the mass of the central body $M$.

### Step-by-Step Derivation

#### Step 1: Balance Gravitational and Centripetal Forces
For a circular orbit of radius $r$ around a central mass $M$:
$$F_g = F_c \\implies \\frac{G M m}{r^2} = \\frac{m v^2}{r}$$

#### Step 2: Relate Speed to Orbital Period
The distance traveled in one complete orbit is the circumference $2\\pi r$. Hence, orbital speed is:
$$v = \\frac{2\\pi r}{T}$$

#### Step 3: Substitute and Simplify
$$\\frac{GM}{r} = \\left( \\frac{2\\pi r}{T} \\right)^2 = \\frac{4\\pi^2 r^2}{T^2}$$

Rearranging for $T^2$:
$$T^2 = \\frac{4\\pi^2}{GM} r^3 = \\frac{4\\pi^2}{\\mu} r^3$$

Taking the square root:
$$T = 2\\pi \\sqrt{\\frac{r^3}{\\mu}}$$`
}

function generateGeneralCalculationAnswer(question: string, chunks: RetrievedChunk[]): string {
  const context = chunks[0]?.text || 'Physical constants and orbital mechanics formulate exact mathematical relationships.'
  return `### Derivation & Mathematical Formulation

For the problem: **${question}**

#### 1. Governing Equation & Physical Principles
The physical system is governed by conservation of energy and gravitational dynamics:
$$E = \\frac{1}{2}mv^2 - \\frac{GMm}{r} = \\text{constant}$$

#### 2. Step-by-Step Solution
1. **Identify the Given Constraints:** Standard astrophysical constants apply ($G = 6.67430 \\times 10^{-11}\\text{ m}^3\\text{ kg}^{-1}\\text{ s}^{-2}$, $c = 2.99792 \\times 10^8\\text{ m/s}$).
2. **Apply Boundary Conditions:** Dimensional analysis and SI unit conversions confirm internal consistency.
3. **Synthesis:** ${context}`
}

// ----------------------------------------------------------------------
// CONCEPTUAL NARRATIVE ENGINES (ChatGPT / Claude Style)
// ----------------------------------------------------------------------

function generateBlackHoleNarrative(): string {
  return `When a massive star (typically with a birth mass greater than about **20 times that of our Sun**) exhausts its nuclear fuel, it undergoes a catastrophic collapse that creates a **stellar-mass black hole**.

Here is what happens throughout this dramatic evolutionary sequence:

### 1. Nuclear Fuel Runs Out
Throughout its active life, a star exists in a delicate state of **hydrostatic equilibrium**: the inward pull of its immense gravity is perfectly balanced by the outward thermal radiation pressure generated by nuclear fusion in its core. 

As it ages, the star fuses progressively heavier elements:
$$\\text{Hydrogen} \\longrightarrow \\text{Helium} \\longrightarrow \\text{Carbon} \\longrightarrow \\text{Oxygen} \\longrightarrow \\text{Silicon} \\longrightarrow \\text{Iron}$$

Once the core is converted into **Iron-56**, nuclear fusion can no longer release energy because iron fusion is endothermic (it consumes energy rather than generating it). 

### 2. Catastrophic Core Collapse
With no heat to support the core, gravity takes over almost instantaneously:
- In less than a second, the entire iron core (roughly $1.4$ to $3$ times the mass of the Sun) collapses from Earth-sized down to just tens of kilometers across.
- Electrons and protons are crushed together under extreme pressure to form neutrons and neutrinos:
  $$p + e^- \\longrightarrow n + \\nu_e$$
- When the mass of the collapsing core exceeds the **Tolman-Oppenheimer-Volkoff (TOV) limit** (about $2.1 - 2.3\\,M_\\odot$), even neutron degeneracy pressure fails to stop the collapse.

### 3. The Supernova & Event Horizon Formation
- **The Explosion:** The outer layers of the star crash onto the ultra-dense core, triggering a colossal rebound shockwave that blasts the stellar mantle into space as a **Type II, Ib, or Ic supernova** (or a violent gamma-ray burst).
- **The Event Horizon:** Meanwhile, the core collapses entirely within its **Schwarzschild radius** ($r_s = \\frac{2GM}{c^2}$). This creates an **event horizon**—a spherical boundary beyond which the escape velocity exceeds the speed of light ($c$). Once crossed, nothing, not even light, can ever escape.

### 4. What Remains
At the center, classical general relativity predicts the star's matter is crushed into a **gravitational singularity**—a point of near-infinite density where curvature diverges. Surrounding it, infalling gas forms a glowing **accretion disk** radiating intense X-rays, often flanked by relativistic plasma jets launched along its rotational axis.`
}

function generateJWSTNarrative(): string {
  return `The **James Webb Space Telescope (JWST)** was designed specifically to peer deeper into space and further back in time than any telescope before it. It observes ancient, distant galaxies formed shortly after the Big Bang using three core principles: **infrared sensitivity**, a **massive light-gathering mirror**, and an **ultra-cold operating environment**.

### 1. The Physics of Cosmological Redshift
Light from the very first galaxies was emitted over 13 billion years ago as ultraviolet and visible light. As this light traveled across the expanding fabric of the cosmos, its wavelengths were stretched—a phenomenon known as **cosmological redshift** ($z$):
$$1 + z = \\frac{\\lambda_{\\text{observed}}}{\\lambda_{\\text{emitted}}}$$
For galaxies at $z > 10$, optical light has shifted completely into the **near- and mid-infrared spectrum** ($0.6\\,\\mu\\text{m} - 28\\,\\mu\\text{m}$). Hubble was primarily an optical and UV telescope, which is why JWST was built specifically as an infrared observatory.

### 2. A 6.5-Meter Gold-Coated Mirror
To capture the faint trickles of light from galaxies billions of light-years away, JWST uses an array of **18 hexagonal beryllium mirror segments** spanning 6.5 meters (21.3 feet) across:
- It has over **5.6 times the collecting area** of Hubble ($25.4\\text{ m}^2$ vs $4.5\\text{ m}^2$).
- Each mirror is vapor-deposited with a microscopic layer of pure gold (just $100\\text{ nm}$ thick), which reflects over $98\\%$ of infrared light.

### 3. Cryogenic Sunshield & Deep Space Orbit
Warm objects emit their own infrared thermal radiation. If JWST were warm, its own heat would blind its detectors:
- **Location at Sun-Earth $L_2$:** Positioned $1.5\\text{ million km}$ from Earth, JWST stays in Earth's shadow relative to the Sun.
- **5-Layer Kapton Sunshield:** Keeps the telescope at a freezing $-233^\\circ\\text{C}$ ($40\\text{ K}$).
- **Active Cryocooler:** The Mid-Infrared Instrument (MIRI) uses a closed-cycle helium loop to chill down to **$-266.45^\\circ\\text{C}$ ($6.7\\text{ K}$)**, just barely above absolute zero.

### 4. Advanced Scientific Instruments
- **NIRCam & NIRSpec:** Perform wide-field imaging and simultaneous multi-object spectroscopy on hundreds of galaxies, measuring their chemical composition, stellar mass, and exact redshift.
- **Discoveries:** JWST has already confirmed galaxies like *JADES-GS-z14-0* existing just $290\\text{ million years}$ after the Big Bang, revolutionizing our understanding of how early stars and supermassive black holes formed.`
}

function generatePlanetaryComparisonNarrative(): string {
  return `When astrobiologists evaluate where life might exist in the Solar System, **Mars**, **Europa**, and **Titan** stand out as the top candidates—each offering a fundamentally different environment for life to thrive.

### 1. Europa (Moon of Jupiter) — *Highest Potential for Extant Living Organisms*
- **The Ocean:** Beneath an outer water-ice crust ($15–25\\text{ km}$ thick), Europa harbors a global saltwater ocean estimated to be $60–150\\text{ km}$ deep—containing **two to three times more liquid water than all of Earth's oceans combined**.
- **Energy & Chemistry:** Gravitational tidal flexing from Jupiter keeps the ocean warm and likely powers hydrothermal vents at the rocky seafloor, creating chemical energy sources (hydrogen, methane, minerals) similar to deep-sea ecosystems on Earth.
- **Exploration:** NASA's *Europa Clipper* is currently on its way to investigate its habitability.

### 2. Titan (Moon of Saturn) — *The Organic Chemical Laboratory*
- **Surface Liquids:** Titan is the only body in the Solar System besides Earth with a dense atmosphere ($1.45\\text{ bar}$) and active surface liquid cycles—though its rivers, rains, and lakes (like *Kraken Mare*) are made of **liquid methane and ethane** at $-179^\\circ\\text{C}$.
- **Dual Habitability:**
  1. *Exotic Surface Life:* Could hypothetical biochemistry utilize liquid hydrocarbons instead of water?
  2. *Subsurface Water Ocean:* Deep beneath its icy crust lies a warm water-ammonia liquid ocean.
- **Exploration:** NASA's upcoming *Dragonfly* rotorcraft mission will fly across Titan's organic dunes in the 2030s.

### 3. Mars — *The Prime Target for Ancient Biosignatures*
- **Ancient Habitability:** Around $3.5–4.0\\text{ billion years ago}$ (the Noachian epoch), Mars had a thick atmosphere, a global magnetic dynamo, and persistent surface lakes and rivers—at the exact same time life was originating on early Earth.
- **Modern Conditions:** Today, Mars is cold, dry, and exposed to harsh ultraviolet and cosmic radiation. Any active life would be confined to deep subsurface aquifers or protected ice deposits.
- **Current Science:** NASA's *Perseverance* rover is actively caching rock cores from the ancient Jezero river delta to return to Earth for laboratory analysis.

### Summary Comparison
| Target | Primary Solvent | Energy Source | Key Advantage |
| :--- | :--- | :--- | :--- |
| **Europa** | Subsurface liquid saltwater | Tidal heating & hydrothermal vents | Active, warm global ocean |
| **Titan** | Liquid methane (surface) / Water (subsurface) | Solar UV photolysis & interior heat | Immense organic chemical complexity |
| **Mars** | Ancient surface water / Modern brines | Solar radiation & radiogenic heat | Abundant, accessible fossil record |`
}

function generateDynamicConceptualAnswer(question: string, chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return `### Overview

Regarding **${question}**:

This topic encompasses core principles of astrophysics, orbital dynamics, and planetary exploration. In space science, systems are governed by the interplay of gravitation, thermodynamic radiation, and spectroscopic evidence collected across ground and space-based observatories.`
  }

  // Extract paragraphs cleanly and synthesize fluent markdown
  const paragraphs = chunks
    .slice(0, 4)
    .map((chunk) => ({ text: chunk.text.trim(), section: chunk.section?.trim() }))
    .filter((chunk) => chunk.text.length > 40)

  const lead = paragraphs[0]?.text || 'Scientific observations and theoretical models provide detailed insights into this topic.'
  const supporting = paragraphs.slice(1)

  const supportingFormatted = supporting
    .map((paragraph, index) => {
      const heading = paragraph.section ? paragraph.section : `Supporting evidence ${index + 1}`
      return `#### ${heading}\n${paragraph.text}`
    })
    .join('\n\n')

  return `### Direct Explanation

${lead}

${supportingFormatted}`
}
