// Web Retriever for SpaceLLM
// Implements multi-query search decomposition and deep Wikipedia extract retrieval

export interface RetrievedChunk {
  text: string
  source: string
  url?: string
  score: number
  section?: string
  /** Parent article/collection title, used for relevance filtering and citation grouping. */
  article?: string
  /** 0..1 overlap between this chunk and the user question. */
  relevance?: number
}

const QUERY_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'all', 'also', 'and', 'any', 'are', 'because', 'been', 'before', 'being',
  'between', 'both', 'briefly', 'but', 'can', 'could', 'describe', 'did', 'do', 'does', 'doing', 'during', 'each',
  'explain', 'few', 'for', 'from', 'further', 'give', 'had', 'has', 'have', 'having', 'here', 'how', 'into', 'its',
  'just', 'list', 'made', 'make', 'many', 'may', 'mean', 'meaning', 'might', 'more', 'most', 'much', 'must', 'not',
  'now', 'off', 'once', 'only', 'other', 'our', 'out', 'over', 'own', 'please', 'same', 'should', 'show', 'simple',
  'simply', 'some', 'such', 'tell', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where', 'whether', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'work', 'works', 'overview', 'information',
  'compare', 'comparison', 'versus', 'difference', 'place', 'places', 'search', 'searching', 'seeking', 'look',
  'looking', 'versus', 'explanation', 'between', 'happen', 'happens', 'become', 'becomes', 'became', 'would',
  'calculate', 'calculation', 'calculate', 'derivation', 'derive', 'formula', 'numerically', 'numeric',
  'mathematical', 'maths', 'math', 'solve', 'answer', 'question', 'topic', 'need', 'want', 'know', 'using',
])

function tokenVariants(term: string): string[] {
  const stripped = term.endsWith('s') && term.length > 4 ? term.slice(0, -1) : term
  return stripped === term ? [term] : [term, stripped]
}

function matchesTerm(haystack: string, term: string) {
  return tokenVariants(term).some((variant) => haystack.includes(variant))
}

/** Normalised, stop-word filtered search terms extracted from a user question. */
export function queryTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/^\/[a-z]+\s+/i, '')
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .map((term) => term.replace(/^['-]+|['-]+$/g, ''))
        .filter((term) => term.length > 2 && !QUERY_STOP_WORDS.has(term)),
    ),
  ]
}

/**
 * Strips Wikipedia/encyclopedia artefacts that make raw extracts look like scraped text
 * (pronunciation fragments, markup leftovers, residual citation markers).
 */
export function cleanEvidenceText(text: string): string {
  return text
    .replace(/\[\[\s*(?:[^\]|]*\|)?\s*([^\]]*?)\s*\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\(\s*;\s*[^)]*\)/g, '')
    .replace(/\(\s*;\s*/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*\([^)]*(?:listen|IPA|pronounced|help·info)[^)]*\)/gi, '')
    .replace(/\[\d+\]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim()
}

/** Splits a passage into complete sentences, discarding fragments that carry no information. */
export function splitIntoSentences(text: string): string[] {
  return cleanEvidenceText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$('"“])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30 && sentence.length < 700)
    .filter((sentence) => !/^[a-z]/.test(sentence))
    .filter((sentence) => !/^["“'(\[]?\s*[a-z]/.test(sentence))
}

/** Groups chunks belonging to the same source article, ignoring the section suffix. */
export function chunkArticleKey(chunk: RetrievedChunk): string {
  return chunk.article || chunk.source.replace(/\s*\([^)]*\)\s*$/, '').trim() || chunk.source
}

/** 0..1 relevance of a passage to the question, blending title and body overlap. */
export function scoreChunkRelevance(chunk: RetrievedChunk, tokens: string[]): number {
  if (!tokens.length) return 0
  const body = `${chunk.text} ${chunk.section ?? ''}`.toLowerCase()
  const title = `${chunk.article ?? ''} ${chunk.source}`.toLowerCase()
  const bodyCoverage = tokens.filter((term) => matchesTerm(body, term)).length / tokens.length
  const titleCoverage = tokens.filter((term) => matchesTerm(title, term)).length / tokens.length
  const phraseBonus = tokens.length > 1 && body.includes(tokens.join(' ')) ? 0.05 : 0
  return Math.min(1, bodyCoverage * 0.6 + titleCoverage * 0.3 + phraseBonus)
}

/**
 * Relevance + diversity ranking used for every retrieval source.
 * Guarantees multiple articles are represented so the answer never depends on one passage.
 */
/**
 * Relevance + diversity ranking used for every retrieval source.
 * Per article, the lead block ("Overview" chunk, i.e. the first chunk in document
 * order) is always kept alongside the highest-scoring section chunks, so answers
 * never lose the definitional passage that introduced the topic. Articles are then
 * interleaved by relevance so a single source can never dominate the answer.
 */
export function rankChunksForQuestion(
  chunks: RetrievedChunk[],
  question: string,
  limit = 6,
  maxPerArticle = 2,
): RetrievedChunk[] {
  const tokens = queryTokens(question)
  const leadSections = /overview|introduction|description|definition|summary|background|characteristics|lead|general/i
  const seenArticle = new Set<string>()

  const scored = deduplicateChunks(chunks).map((chunk, order) => {
    const article = chunkArticleKey(chunk)
    const isArticleLead = !seenArticle.has(article)
    if (isArticleLead) seenArticle.add(article)

    const overlap = scoreChunkRelevance(chunk, tokens)
    // Blend the retrieval-side prior (Wikipedia search order / source trust) with local overlap
    // so the highest-ranked, most topical passages always win.
    const prior = chunk.score > 0 && chunk.score <= 1 ? chunk.score : 0
    // Article lead sections answer definitional questions, so they are preferred slightly —
    // but only for passages that genuinely mention the question's terms.
    const leadBonus = isArticleLead ? 0.02 : 0
    const sectionBonus = leadSections.test(chunk.section ?? '') ? 0.03 : 0
    const relevance = overlap > 0 ? Math.min(1, overlap * 0.75 + prior * 0.25 + leadBonus + sectionBonus) : 0
    return { chunk: { ...chunk, relevance, score: relevance }, relevance, order }
  })

  interface ScoredChunk {
    chunk: RetrievedChunk
    relevance: number
    order: number
  }

  const byArticle = new Map<string, ScoredChunk[]>()
  for (const entry of scored) {
    const key = chunkArticleKey(entry.chunk)
    const bucket = byArticle.get(key)
    if (bucket) bucket.push(entry)
    else byArticle.set(key, [entry])
  }

  const picks: ScoredChunk[] = []
  for (const entries of byArticle.values()) {
    const lead = entries.reduce((earliest, entry) => (entry.order < earliest.order ? entry : earliest), entries[0])
    const rest = entries.filter((entry) => entry !== lead).sort((a, b) => b.relevance - a.relevance)
    const bundle = lead.relevance > 0 ? [lead, ...rest] : rest
    picks.push(...bundle.slice(0, maxPerArticle))
  }

  const ordered = picks.sort((a, b) => b.relevance - a.relevance || a.order - b.order)

  const relevant = ordered.filter((entry) => entry.relevance > 0)
  const pool = relevant.length ? relevant : ordered
  const selected = pool.slice(0, limit).map((entry) => entry.chunk)

  // If diversity caps left the answer short, backfill with the next best passages.
  if (selected.length < limit) {
    for (const entry of ordered) {
      if (selected.length >= limit) break
      if (pool.includes(entry)) continue
      selected.push(entry.chunk)
    }
  }

  return selected.slice(0, limit)
}

export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>()
  const result: RetrievedChunk[] = []
  for (const chunk of chunks) {
    const normalized = chunk.text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 100)
    if (!seen.has(normalized) && chunk.text.trim().length > 35) {
      seen.add(normalized)
      result.push(chunk)
    }
  }
  return result
}

/** Sections that only hold navigation, trivia or reference lists — never answer material. */
const NON_ANSWER_SECTIONS = /^(external links?|see also|references?|further reading|notes|bibliography|gallery|footnotes|sources|citations|media|works cited|published works|awards and nominations)$/i

export function chunkArticleText(
  text: string,
  source: string,
  url?: string,
  article?: string,
): RetrievedChunk[] {
  // Split on double newlines or section headers (e.g. == Overview ==)
  const rawSections = cleanEvidenceText(text).split(/\n{2,}|(?=\n==+\s+[^=]+\s+==+)/)
  const chunks: RetrievedChunk[] = []

  let currentSection = 'Overview'

  for (const section of rawSections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^==+\s*([^=]+)\s*==+/m)
    if (headerMatch) {
      currentSection = headerMatch[1].trim()
    }

    if (NON_ANSWER_SECTIONS.test(currentSection)) continue

    const cleanContent = trimmed.replace(/^==+\s*[^=]+\s*==+/gm, '').trim()
    if (cleanContent.length < 40) continue

    // Break down large paragraphs (> 600 chars) into coherent smaller blocks
    const subParts = cleanContent.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    let currentBlock = ''

    for (const part of subParts) {
      if ((currentBlock + ' ' + part).length > 450 && currentBlock.length > 50) {
        chunks.push({
          text: currentBlock.trim(),
          source: `${source} (${currentSection})`,
          url,
          article: article ?? source,
          section: currentSection,
          score: 0,
        })
        currentBlock = part
      } else {
        currentBlock = currentBlock ? `${currentBlock} ${part}` : part
      }
    }

    if (currentBlock.trim().length > 30) {
      chunks.push({
        text: currentBlock.trim(),
        source: `${source} (${currentSection})`,
        url,
        article: article ?? source,
        section: currentSection,
        score: 0,
      })
    }
  }

  return deduplicateChunks(chunks)
}

function stripQuestionScaffolding(userQuery: string): string {
  return userQuery
    .replace(/^\/(explain|calculate|calc|maths|math|physics|phys|science|scientific|sci|compare|derive|derivation|equation|eq|combine|sources|visualize)\s+/i, '')
    .replace(/^(please\s+)?(can you\s+|could you\s+|i want to know\s+|tell me\s+)/i, '')
    .replace(
      /^(what|which|who|when|where|why|how)\s+(is|are|was|were|does|do|did|would|will|can|could|should)\s+/i,
      '',
    )
    .replace(/^(what|which|who|when|where|why|how)\s+/i, '')
    .replace(/^(explain|describe|define|definition of|meaning of|information about|overview of|list|summarize)\s+/i, '')
    .replace(/\?+\s*$/, '')
    .replace(/\s+(in|within|under|using|with)\s+\d{1,3}\s+(logical\s+)?lines?\.?$/i, '')
    .replace(/[.\s]+$/, '')
    .trim()
}

function generateSearchQueries(userQuery: string): string[] {
  const cleaned = userQuery
    .replace(/^\/(explain|calculate|calc|maths|math|physics|phys|science|scientific|sci|compare|derive|derivation|equation|eq|combine|sources|visualize)\s+/i, '')
    .trim()
  const topic = stripQuestionScaffolding(cleaned)

  const queries: string[] = []
  const cleanedQuestion = cleaned.replace(/[?]+\s*$/, '').trim()
  // The full question is the most specific query, so it is asked first; the stripped
  // topic is used as a second, broader pass.
  if (cleanedQuestion) queries.push(cleanedQuestion)
  if (topic && topic.length > 2 && topic.toLowerCase() !== cleanedQuestion.toLowerCase()) queries.push(topic)

  // Add domain-specific variants so multi-hop questions retrieve the supporting article too.
  const lower = cleaned.toLowerCase()
  if (lower.includes('escape velocity')) {
    queries.push('Escape velocity orbital mechanics derivation')
  } else if (lower.includes('black hole')) {
    queries.push('Black hole event horizon Schwarzschild radius formation')
  } else if (lower.includes('james webb') || lower.includes('jwst')) {
    queries.push('James Webb Space Telescope infrared instruments')
  } else if (lower.includes('mars') && (lower.includes('europa') || lower.includes('titan') || lower.includes('life'))) {
    queries.push('Europa Titan Mars habitability ocean worlds')
  } else if (lower.includes('hohmann') || lower.includes('delta-v') || lower.includes('transfer orbit')) {
    queries.push('Hohmann transfer orbit delta-v orbital mechanics')
  } else if (lower.includes('gravitational wave')) {
    queries.push('Gravitational wave LIGO general relativity')
  } else if (lower.includes('space telescope') || lower.includes('hubble')) {
    queries.push('Space telescope observatory astronomy')
  }

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 3)
}

/** Lead-text disambiguation check (pages are mainly gated via pageprops). */
function isDisambiguationText(text: string) {
  return /\b(?:may|might|can)\s+(?:also\s+)?refer to\b|\bis a topic that\b|\brefers to a number of\b/i.test(text.slice(0, 500))
}

/**
 * Drops entertainment/fiction articles (novels, television series, films, games …) that
 * Wikipedia's fuzzy search happily returns for science questions — e.g. the novel
 * "What Is the What" or "Star Trek: Deep Space Nine" for "what is space".
 */
function isFictionArticle(categories: { title?: string }[] | undefined) {
  if (!categories?.length) return false
  return categories.some((category) =>
    /\b(television series|tv series|films?|novels?|novella|short stor(?:y|ies)|video games?|fictional|fiction|manga|anime|comics?|albums?|songs?|singles?|bands?|duos?|musical groups?|characters?|sitcoms?)\b/i.test(
      category.title ?? '',
    ),
  )
}

const WIKIPEDIA_HEADERS = {
  // Wikimedia asks API clients to identify themselves; a descriptive User-Agent
  // also makes throttling far less likely during multi-query retrieval bursts.
  'User-Agent': 'SpaceLLM/1.0 (grounded astronomy RAG assistant; contact: spacellm@example.com)',
  Accept: 'application/json',
}

/** JSON fetch with one retry, used for every Wikipedia call (search + article extracts). */
async function fetchWikipediaJson<T>(url: string, attempts = 2): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: WIKIPEDIA_HEADERS })
      if (response.ok) return (await response.json()) as T
      // 429/5xx: back off briefly and retry once.
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 350))
    } catch {
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 350))
    }
  }
  return null
}

interface WikipediaPage {
  title?: string
  extract?: string
  fullurl?: string
  canonicalurl?: string
  categories?: { title?: string }[]
  pageprops?: Record<string, string>
}

/**
 * Fetches one article's full plain-text extract, URL, categories and page properties.
 * `exlimit` must stay at 1: the MediaWiki extract API silently downgrades
 * multi-title extract requests to a single article.
 */
async function fetchWikipediaPage(title: string): Promise<WikipediaPage | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info|categories|pageprops&cllimit=25&inprop=url&explaintext=1&exlimit=1&titles=${encodeURIComponent(
    title,
  )}&format=json&origin=*`
  const data = await fetchWikipediaJson<{ query?: { pages?: Record<string, WikipediaPage> } }>(url)
  const page = Object.values(data?.query?.pages ?? {})[0]
  if (!page?.extract || !page.title) return null
  return page
}

/** Disambiguation pages are detected from pageprops (authoritative) and from the lead text. */
function isDisambiguationPage(page: WikipediaPage) {
  if (page.pageprops && 'disambiguation' in page.pageprops) return true
  return /\b(?:may|might|can)\s+(?:also\s+)?refer to\b|\bis a topic that\b|\brefers to a number of\b/i.test(
    (page.extract ?? '').slice(0, 500),
  )
}

export async function fetchWikipediaDeepExtracts(query: string): Promise<RetrievedChunk[]> {
  const searchQueries = generateSearchQueries(query)
  const allChunks: RetrievedChunk[] = []
  const usedArticles = new Set<string>()
  // Article fetches are cached per question so the same page is never requested twice.
  const pageCache = new Map<string, WikipediaPage | null>()

  const loadPage = async (title: string) => {
    const key = title.toLowerCase()
    if (pageCache.has(key)) return pageCache.get(key) ?? null
    const page = await fetchWikipediaPage(title).catch(() => null)
    pageCache.set(key, page)
    return page
  }

  for (let queryIndex = 0; queryIndex < searchQueries.length; queryIndex += 1) {
    const searchQuery = searchQueries[queryIndex]
    // The user's own phrasing is the primary signal; broader/topic passes are supplementary.
    const queryWeight = Math.max(0.7, 1 - queryIndex * 0.15)
    try {
      const tokens = queryTokens(searchQuery)
      if (!tokens.length) continue

      // 1. Wikipedia search: results arrive in the encyclopedia's own relevance order.
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchQuery,
      )}&srlimit=5&format=json&origin=*`
      const searchData = await fetchWikipediaJson<{
        query?: { search?: { title: string; snippet?: string }[] }
      }>(searchUrl)
      if (!searchData) continue

      const searchTitles = (searchData.query?.search ?? []).map((result) => result.title)
      if (!searchTitles.length) continue

      // 2. Pre-gate candidates before spending a request per article:
      //    a title match is strong evidence of topicality, a body-only match is only
      //    trusted for the first two search results.
      const candidates = searchTitles
        .map((title, index) => ({
          title,
          index,
          titleMatch: tokens.filter((term) => matchesTerm(title.toLowerCase(), term)).length,
        }))
        .filter((candidate) => candidate.titleMatch > 0 || candidate.index < 2)
        .slice(0, 3)

      // 3. Pull extracts in parallel (one request per article, exlimit=1).
      const pageResults = await Promise.all(
        candidates.map(async (candidate) => ({ candidate, page: await loadPage(candidate.title) })),
      )

      let acceptedForQuery = 0
      for (const { candidate, page } of pageResults) {
        if (acceptedForQuery >= 2) break
        if (!page?.extract || !page.title) continue
        if (isDisambiguationPage(page) || isDisambiguationText(page.extract)) continue
        if (isFictionArticle(page.categories)) continue

        const article = page.title
        const articleKey = article.toLowerCase()
        if (usedArticles.has(articleKey)) continue

        // 4. Body relevance gate on the fetched article.
        const titleLower = article.toLowerCase()
        const body = page.extract.toLowerCase()
        const titleMatchCount = tokens.filter((term) => matchesTerm(titleLower, term)).length
        const bodyMatchCount = tokens.filter((term) => matchesTerm(body, term)).length
        const bodyCoverage = bodyMatchCount / tokens.length
        const bodyWordCount = body.split(/\s+/).length
        const occurrences = tokens.reduce(
          (sum, term) => sum + tokenVariants(term).reduce((inner, variant) => inner + (body.split(variant).length - 1), 0),
          0,
        )

        const titleRelevant = titleMatchCount > 0
        const strongBody = bodyCoverage >= 0.6 && occurrences >= 4 && bodyWordCount > 80
        if (!titleRelevant && !strongBody) continue

        usedArticles.add(articleKey)
        acceptedForQuery += 1

        // 5. Wikipedia's own result order is a strong topical prior.
        const rankPrior = Math.max(0.4, 1 - candidate.index * 0.15)
        const relevance = Math.min(
          1,
          (rankPrior * 0.4 + (titleMatchCount / tokens.length) * 0.4 + bodyCoverage * 0.2) * queryWeight,
        )

        const pageUrl =
          page.fullurl || page.canonicalurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}`
        const articleChunks = chunkArticleText(page.extract, `Wikipedia: ${article}`, pageUrl, article)
        allChunks.push(...articleChunks.map((chunk) => ({ ...chunk, relevance, score: relevance })))
      }
    } catch {
      // Ignore network errors and continue with next query or fallback
    }
  }

  return deduplicateChunks(allChunks)
}

