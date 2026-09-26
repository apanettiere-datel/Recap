/** Split a search query into terms; "quoted phrases" stay together (mirrors the API). */
export function parseTerms(query) {
  const terms = []
  const re = /"([^"]+)"|(\S+)/g
  let m
  while ((m = re.exec(query || '')) !== null) {
    const t = (m[1] ?? m[2]).trim()
    if (t && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t)
  }
  return terms
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function termsRegExp(terms) {
  const valid = terms.filter(Boolean).sort((a, b) => b.length - a.length)
  if (valid.length === 0) return null
  return new RegExp(`(${valid.map(escapeRegExp).join('|')})`, 'gi')
}
