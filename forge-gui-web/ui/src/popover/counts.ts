import type { CardCount } from '../protocol'

export type CountedLine = { line: string; counts: CardCount[] }

/** The card's rules text line by line, each with the counts of the ability on that line; `rest` are counts no line matched. */
export function countedLines(text: string, counts: CardCount[] = []): { lines: CountedLine[]; rest: CardCount[] } {
  const lines: CountedLine[] = text.split('\n').map((line) => ({ line, counts: [] }))
  const rest: CardCount[] = []
  for (const c of counts) {
    const head = c.text.split('\n')[0].trim()
    const at = lines.find(({ line }) => {
      const l = line.trim()
      return l !== '' && (l.includes(head) || (head.includes(l) && l.length * 2 >= head.length)) // not a keyword line inside a long ability
    })
    if (at) at.counts.push(c)
    else rest.push(c)
  }
  return { lines, rest }
}

/** "3", or "X 3 · Y 2" when one ability counts more than one thing. */
export function countLabel(counts: CardCount[]): string {
  return counts.length === 1 ? String(counts[0].value) : counts.map((c) => `${c.name} ${c.value}`).join(' · ')
}
