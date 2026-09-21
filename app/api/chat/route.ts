import { NextRequest, NextResponse } from 'next/server'
import { fetchWikipediaDeepExtracts, RetrievedChunk, deduplicateChunks } from '@/lib/web-retriever'
import { OFFLINE_SPACE_CORPUS, CELESTIAL_BODIES, SPACE_CONSTANTS } from '@/lib/space-knowledge'
import {
  generateSpaceDefinitionAnswer,
  getRequestedAnswerStyle,
  getRequestedLineCount,
  isSpaceDefinitionQuery,
  limitAnswerToRequestedLines,
  synthesizeAccurateAnswer,
} from '@/lib/answer-synthesizer'

export const dynamic = 'force-dynamic'

async function queryFreeAiModel(prompt: string, context: string, userQuestion: string): Promise<string> {
  const requestedLineCount = getRequestedLineCount(userQuestion)
  const requestedStyle = getRequestedAnswerStyle(userQuestion)
  const systemPrompt = `You are SpaceLLM, an elite scientific and astrophysics AI reasoning assistant delivering responses of the highest quality (comparable to Claude 3.5 Sonnet and GPT-4o).

RULES:
1. For CALCULATION and DERIVATION questions:
  - Start with a clearly labeled **Final Answer** containing the final formula or numerical result, then show the detailed derivation.
  - Provide a rigorous, numbered, step-by-step mathematical derivation using standard LaTeX equations ($$ ... $$ for block formulas, $ ... $ for inline math).
   - Clearly state the governing physical laws (e.g., Conservation of Energy, Newton's laws, Kepler's laws, General Relativity).
   - Define all variables and list standard SI physical constants with values and units.
  - Show every substitution and algebraic transformation on its own line; never combine a long calculation into one paragraph.
  - Show all intermediate algebraic steps and calculations without skipping steps.
   - Provide the final numerical result with appropriate units (e.g., km/s, m/s, AU, km) clearly boxed or bolded.

2. For CONCEPTUAL, COMPARATIVE, and DESCRIPTIVE questions:
   - Provide articulate, fluent, well-structured, and engaging explanations in clean Markdown.
   - Use clear headings, bullet points, and markdown comparison tables where appropriate.
   - Do NOT force a rigid artificial step-by-step template onto non-calculation questions; explain naturally and thoroughly.

3. ACCURACY & EVIDENCE:
   - Base your scientific facts on the provided grounded search context and standard physics laws.
   - Avoid generic filler, hallucinations, or repetitive text.
${requestedLineCount ? `4. LENGTH: Answer in no more than ${requestedLineCount} concise logical lines because the user explicitly requested that limit.` : ''}
${requestedStyle ? `5. STYLE: ${requestedStyle}` : ''}

GROUNDED SEARCH EVIDENCE:
${context || 'Standard astrophysical constants and laws apply.'}`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userQuestion },
  ]

  // Endpoint 1: Pollinations AI with modern model
  try {
    const response = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model: 'openai',
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(25000),
    })

    if (response.ok) {
      const text = await response.text()
      if (text && text.trim().length > 80) {
        return text.trim()
      }
    }
  } catch (err) {
    // Retry with fallback model
  }

  // Endpoint 2: Fallback with mistral / searchgpt
  try {
    const fallbackRes = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model: 'mistral',
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (fallbackRes.ok) {
      const text = await fallbackRes.text()
      if (text && text.trim().length > 80) {
        return text.trim()
      }
    }
  } catch (err) {
    // Continue to local high-accuracy synthesis
  }

  return ''
}

export async function POST(req: NextRequest) {
  try {
    const { question, attachment } = (await req.json()) as {
      question?: string
      attachment?: { name: string; content: string } | null
    }

    if (!question || !question.trim()) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 })
    }

    const trimmedQuestion = question.trim()

    // 1. Live Web RAG Retrieval
    let webChunks: RetrievedChunk[] = []
    try {
      webChunks = await fetchWikipediaDeepExtracts(trimmedQuestion)
    } catch {
      webChunks = []
    }

    // 2. Local Corpus Chunks
    const localChunks: RetrievedChunk[] = []
    for (const item of OFFLINE_SPACE_CORPUS) {
      if (trimmedQuestion.toLowerCase().split(/\W+/).some((w) => w.length > 3 && item.content.toLowerCase().includes(w))) {
        localChunks.push({
          source: `Astrophysics Corpus: ${item.title}`,
          text: item.content,
          score: 1,
        })
      }
    }

    if (attachment) {
      localChunks.push({
        source: `User Document (${attachment.name})`,
        text: attachment.content.slice(0, 3000),
        score: 1,
      })
    }

    const allChunks = deduplicateChunks([...webChunks, ...localChunks])
    const topChunks = allChunks.slice(0, 6)

    const contextText = topChunks
      .map((c, i) => `[${i + 1}] ${c.source}: ${c.text}`)
      .join('\n\n')

    // 3. Keep the existing online answer, then append the canonical space definition layout.
    let generatedAnswer = await queryFreeAiModel(trimmedQuestion, contextText, trimmedQuestion)

    // 4. If AI API fails or is offline, use high-accuracy local synthesizer
    if (!generatedAnswer || generatedAnswer.length < 100) {
      generatedAnswer = synthesizeAccurateAnswer({
        question: trimmedQuestion,
        retrievedChunks: topChunks,
        attachment,
        mode: 'online',
      })
    } else {
      // Append verified source links if not already present
      if (topChunks.length > 0 && !generatedAnswer.toLowerCase().includes('references') && !generatedAnswer.toLowerCase().includes('sources')) {
        const refs = topChunks
          .slice(0, 4)
          .map((c, i) => {
            const link = c.url ? ` ([Source Link](${c.url}))` : ''
            return `[${i + 1}] **${c.source}**${link}`
          })
          .join('\n')
        generatedAnswer = `${generatedAnswer}\n\n### References & Verified Sources\n${refs}`
      }
      if (isSpaceDefinitionQuery(trimmedQuestion)) {
        generatedAnswer += `\n\n${generateSpaceDefinitionAnswer()}`
      }
    }

    return NextResponse.json({
      answer: limitAnswerToRequestedLines(generatedAnswer, trimmedQuestion),
      sources: topChunks,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to process inquiry' },
      { status: 500 }
    )
  }
}
