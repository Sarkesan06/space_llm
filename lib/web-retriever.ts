// Web Retriever for SpaceLLM
// Implements multi-query search decomposition and deep Wikipedia extract retrieval

export interface RetrievedChunk {
  text: string
  source: string
  url?: string
  score: number
  section?: string
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

export function chunkArticleText(text: string, source: string, url?: string): RetrievedChunk[] {
  // Split on double newlines or section headers (e.g. == Overview ==)
  const rawSections = text.split(/\n{2,}|(?=\n==+\s+[^=]+\s+==+)/)
  const chunks: RetrievedChunk[] = []

  let currentSection = 'Overview'

  for (const section of rawSections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^==+\s*([^=]+)\s*==+/m)
    if (headerMatch) {
      currentSection = headerMatch[1].trim()
    }

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
        section: currentSection,
        score: 0,
      })
    }
  }

  return deduplicateChunks(chunks)
}

function generateSearchQueries(userQuery: string): string[] {
  const cleaned = userQuery
    .replace(/^\/(explain|calculate|calc|maths|physics|science|compare|derive|equation|combine|sources)\s+/i, '')
    .trim()

  const queries = [cleaned]

  // Add domain-specific variants
  const lower = cleaned.toLowerCase()
  if (lower.includes('escape velocity')) {
    queries.push('Escape velocity orbital mechanics derivation')
  } else if (lower.includes('black hole')) {
    queries.push('Black hole astrophysics event horizon Schwarzschild')
  } else if (lower.includes('james webb') || lower.includes('jwst')) {
    queries.push('James Webb Space Telescope instruments infrared science')
  } else if (lower.includes('mars') && (lower.includes('europa') || lower.includes('titan') || lower.includes('life'))) {
    queries.push('Extraterrestrial life ocean worlds Europa Titan Mars')
  } else if (lower.includes('hohmann') || lower.includes('orbit')) {
    queries.push('Hohmann transfer orbit delta-v Keplerian orbital mechanics')
  } else if (lower.includes('gravitational waves')) {
    queries.push('Gravitational wave LIGO general relativity')
  }

  return [...new Set(queries)].slice(0, 3)
}

export async function fetchWikipediaDeepExtracts(query: string): Promise<RetrievedChunk[]> {
  const searchQueries = generateSearchQueries(query)
  const allChunks: RetrievedChunk[] = []

  for (const searchQuery of searchQueries) {
    try {
      // 1. Search Wikipedia for top matching articles
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchQuery
      )}&srlimit=3&format=json&origin=*`
      const searchRes = await fetch(searchUrl)
      if (!searchRes.ok) continue
      const searchData = (await searchRes.json()) as {
        query?: { search?: { title: string; snippet?: string }[] }
      }

      const titles = (searchData.query?.search ?? []).map((s) => s.title)
      if (!titles.length) continue

      // 2. Fetch full extracts and page info in batch
      const titlesParam = titles.map((t) => encodeURIComponent(t)).join('|')
      const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&inprop=url&explaintext=1&exlimit=${titles.length}&titles=${titlesParam}&format=json&origin=*`

      const extractRes = await fetch(extractUrl)
      if (!extractRes.ok) continue
      const extractData = (await extractRes.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              title?: string
              extract?: string
              fullurl?: string
              canonicalurl?: string
            }
          >
        }
      }

      const pages = Object.values(extractData.query?.pages ?? {})
      for (const page of pages) {
        if (!page.extract || !page.title) continue
        const pageUrl = page.fullurl || page.canonicalurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
        const articleChunks = chunkArticleText(page.extract, `Wikipedia: ${page.title}`, pageUrl)
        allChunks.push(...articleChunks)
      }
    } catch {
      // Ignore network errors and continue with next query or fallback
    }
  }

  return deduplicateChunks(allChunks)
}
