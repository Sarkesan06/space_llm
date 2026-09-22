import { NextRequest, NextResponse } from 'next/server'
import {
  RetrievedChunk,
  chunkArticleText,
  cleanEvidenceText,
  fetchWikipediaDeepExtracts,
  rankChunksForQuestion,
} from '@/lib/web-retriever'
import { OFFLINE_SPACE_CORPUS } from '@/lib/space-knowledge'
import {
  getRequestedAnswerStyle,
  getRequestedLineCount,
  isDetailedDerivationRequest,
  limitAnswerToRequestedLines,
  removeUnwantedPromotions,
  solveBasicArithmetic,
  synthesizeAccurateAnswer,
} from '@/lib/answer-synthesizer'

export const dynamic = 'force-dynamic'

function appendWikipediaReferences(answer: string, chunks: RetrievedChunk[]) {
  if (/grounded wikipedia sources\s*&\s*references/i.test(answer)) return answer

  const references: string[] = []
  const seenArticles = new Set<string>()

  for (const chunk of chunks) {
    if (!chunk.url || !/wikipedia\.org/i.test(chunk.url) || (chunk.relevance ?? 0) < 0.12) continue

    const article = (chunk.article || chunk.source)
      .replace(/^Wikipedia:\s*/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
    const articleKey = `${article.toLowerCase()}|${chunk.url}`
    if (seenArticles.has(articleKey)) continue

    const excerpt = cleanEvidenceText(chunk.text).replace(/\s+/g, ' ').trim()
    if (!article || excerpt.length < 40) continue

    seenArticles.add(articleKey)
    references.push(
      `[${references.length + 1}] **Wikipedia: ${article}** ([Link](${chunk.url}))\n\n> ${excerpt.slice(0, 420)}${excerpt.length > 420 ? '...' : ''}`,
    )
    if (references.length >= 6) break
  }

  const sourceBody = references.length
    ? references.join('\n\n')
    : '> No directly relevant Wikipedia source was retrieved for this question.'

  return `${answer.trim()}\n\n### Grounded Wikipedia Sources & References\n\n${sourceBody}`
}

function isMathQuestion(question: string) {
  return /(calculate|compute|evaluate|solve|simplify|factor|expand|derive|derivation|find the value|how much|how many|percentage|percent|ratio|average|mean|median|probability|perimeter|area|volume|distance|math|mathematics|arithmetic|algebra|geometry|trigonometry|calculus|statistics|fraction|decimal|equation|inequality|integral|derivative|formula|\d\s*[+\-*/^=]\s*\d|[a-z]\s*[+\-*/^=]\s*\d)/i.test(question)
}

async function queryFreeAiModel(_prompt: string, context: string, userQuestion: string, mathMode = false): Promise<string> {
  const requestedLineCount = getRequestedLineCount(userQuestion)
  const requestedStyle = getRequestedAnswerStyle(userQuestion)
  const systemPrompt = mathMode
    ? `You are SpaceLLM Math Solver. Solve the user's mathematics problem directly; do not use a retrieval QA format, Wikipedia, or unrelated context.

MATH RULES:
- Solve every mathematical problem, including simple arithmetic, word problems, fractions, percentages, algebra, equations, geometry, trigonometry, calculus, probability, statistics, finance, and unit conversions.
- Start with **Final Answer**.
- Show the shortest complete step-by-step derivation needed to verify the result. For a one-step problem, show the expression and result.
- Check arithmetic, signs, units, rounding, domains, and extraneous equation roots.
- Never replace the solution with general advice. If the problem is ambiguous, state the exact assumption used.
${requestedLineCount ? `- Keep the solution within ${requestedLineCount} logical lines.` : ''}
${requestedStyle ? `- Presentation style: ${requestedStyle}` : ''}`
    : `You are SpaceLLM, a capable general-purpose AI assistant. Answer the user's actual question across any topic, while using a strong scientific and reasoning style when the question is technical. Do not restrict answers to astronomy or to the supplied search context.

RULES:
1. For ANY MATHEMATICS question, including very small arithmetic problems, word problems, percentages, fractions, algebra, equations, geometry, trigonometry, calculus, probability, statistics, finance, or unit conversion:
  - Solve the actual problem completely. Do not answer with general advice or only a method.
  - Start with **Final Answer**, then show concise step-by-step work. For a one-step problem, show the expression and result.
  - Check the arithmetic, signs, units, rounding, and whether the result answers what was asked.
  - If information is missing, state exactly what is missing instead of inventing values.

2. For CALCULATION and DERIVATION questions:
  - Start with a clearly labeled **Final Answer** containing the final formula or numerical result, then show the detailed derivation.
  - Provide a rigorous, numbered, step-by-step mathematical derivation using standard LaTeX equations ($$ ... $$ for block formulas, $ ... $ for inline math).
   - Clearly state the governing physical laws (e.g., Conservation of Energy, Newton's laws, Kepler's laws, General Relativity).
   - Define all variables and list standard SI physical constants with values and units.
  - Show every substitution and algebraic transformation on its own line; never combine a long calculation into one paragraph.
  - Show all intermediate algebraic steps and calculations without skipping steps.
   - Provide the final numerical result with appropriate units (e.g., km/s, m/s, AU, km) clearly boxed or bolded.

3. For CONCEPTUAL, COMPARATIVE, and DESCRIPTIVE questions:
   - Provide articulate, fluent, well-structured, and engaging explanations in clean Markdown.
   - Use clear headings, bullet points, and markdown comparison tables where appropriate.
   - Do NOT force a rigid artificial step-by-step template onto non-calculation questions; explain naturally and thoroughly.

4. ACCURACY & EVIDENCE:
  - Use the provided search context when it is relevant, but answer general questions from your broader knowledge when it is not.
  - Be honest about uncertainty and avoid generic filler, hallucinations, or repetitive text.
${requestedLineCount ? `5. LENGTH: Answer in no more than ${requestedLineCount} concise logical lines because the user explicitly requested that limit.` : ''}
${requestedStyle ? `6. STYLE: ${requestedStyle}` : ''}

OPTIONAL SEARCH CONTEXT:
${context || 'No directly relevant search context was found. Answer the user using your general knowledge.'}`

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
      const cleanText = removeUnwantedPromotions(text)
      if (cleanText.length > 80) {
        return cleanText
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
      const cleanText = removeUnwantedPromotions(text)
      if (cleanText.length > 80) {
        return cleanText
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
    const basicArithmetic = solveBasicArithmetic(trimmedQuestion)
    if (basicArithmetic) {
      return NextResponse.json({ answer: basicArithmetic, sources: [] })
    }
    const mathMode = isMathQuestion(trimmedQuestion)

    // 1. Live Web RAG retrieval (multi-query Wikipedia deep extracts, relevance gated).
    //    Wikipedia occasionally throttles bursts, so a thin result is retried once.
    let webChunks: RetrievedChunk[] = []
    try {
      webChunks = await fetchWikipediaDeepExtracts(trimmedQuestion)
      if (webChunks.length < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        const retry = await fetchWikipediaDeepExtracts(trimmedQuestion)
        if (retry.length > webChunks.length) webChunks = retry
      }
    } catch {
      webChunks = []
    }

    // 2. Local verified corpus, chunked and relevance filtered like any other source
    const localChunks: RetrievedChunk[] = []
    for (const item of OFFLINE_SPACE_CORPUS) {
      localChunks.push(
        ...chunkArticleText(item.content, `Astrophysics Corpus: ${item.title}`, undefined, item.title),
      )
    }

    if (attachment) {
      localChunks.push({
        source: `User Document (${attachment.name})`,
        article: attachment.name,
        text: attachment.content.slice(0, 3000),
        score: 1,
      })
    }

    // 3. One relevance + diversity ranking shared by every source, so no article can dominate
    //    and relevance-free articles are dropped before synthesis.
    const webRanked = rankChunksForQuestion(webChunks, trimmedQuestion, 6)
    const localRanked = rankChunksForQuestion(localChunks, trimmedQuestion, 2).filter(
      (chunk) => (chunk.relevance ?? 0) > 0,
    )

    // The built-in corpus is a *fallback*: when live retrieval already produced enough
    // evidence, adding unrelated corpus topics would only dilute the answer. A user
    // attachment, however, is always treated as first-class evidence.
    const corpusFallback = webRanked.length >= 3 ? [] : localRanked
    const attachmentChunks = localRanked.filter((chunk) => chunk.source.startsWith('User Document'))
    const topChunks = rankChunksForQuestion(
      [...webRanked, ...corpusFallback, ...attachmentChunks],
      trimmedQuestion,
      6,
    )

    if (isDetailedDerivationRequest(trimmedQuestion)) {
      const derivation = synthesizeAccurateAnswer({
        question: trimmedQuestion,
        retrievedChunks: topChunks,
        attachment,
        mode: 'offline-cpu',
      })
      return NextResponse.json({
        answer: limitAnswerToRequestedLines(derivation, trimmedQuestion),
        sources: topChunks,
      })
    }

    // Let the online model answer the user's actual question. Retrieved passages
    // improve factual accuracy, but they are supporting context rather than a
    // whitelist of questions the assistant is allowed to answer.
    const context = mathMode ? '' : topChunks
      .map((chunk, index) => `[${index + 1}] ${chunk.source}: ${chunk.text}`)
      .join('\n\n')
    const modelAnswer = await queryFreeAiModel('', context, trimmedQuestion, mathMode)
    const generatedAnswer = modelAnswer || synthesizeAccurateAnswer({
      question: trimmedQuestion,
      retrievedChunks: topChunks,
      attachment,
      mode: 'online',
    })
    const answerWithReferences = mathMode ? generatedAnswer : appendWikipediaReferences(generatedAnswer, webRanked)

    return NextResponse.json({
      answer: removeUnwantedPromotions(limitAnswerToRequestedLines(answerWithReferences, trimmedQuestion)),
      sources: topChunks,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to process inquiry' },
      { status: 500 }
    )
  }
}
