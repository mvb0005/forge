// Small inline SVG icons (24×24 viewBox, currentColor).

/** Big faint glyph in the art box of a text-frame card, by card type. */
export function TypeGlyph({ types, size }: { types: string[]; size: number }) {
  const t = types.includes('Creature')
    ? 'creature'
    : types.includes('Planeswalker')
      ? 'pw'
      : types.includes('Land')
        ? 'land'
        : types.includes('Instant')
          ? 'instant'
          : types.includes('Sorcery')
            ? 'sorcery'
            : types.includes('Artifact')
              ? 'artifact'
              : types.includes('Enchantment')
                ? 'ench'
                : types.includes('Battle')
                  ? 'battle'
                  : 'other'
  const paths: Record<string, string> = {
    creature: 'M5 20c1-6 2-10 1-15l3 4 1-6 2 6 2-6 1 6 3-4c-1 5 0 9 1 15z',
    pw: 'M12 2 9 9H2l5.5 4.5L5 21l7-4.5 7 4.5-2.5-7.5L22 9h-7z',
    land: 'M1 20 8 8l4 6 3-4 8 10z',
    instant: 'M13 2 4 14h6l-1 8 9-12h-6z',
    sorcery: 'M12.5 2c.6 3.3-2.4 4.5-2.4 7.5 0 1 .6 1.8 1.4 2.1-.3-1.5.7-2.6 1.8-3.6.9 2.4 3.6 3.8 3.6 6.9A5 5 0 0 1 12 20a5 5 0 0 1-5-5.1c0-5.2 5.2-6.9 5.5-12.9z',
    artifact: 'M10 2h4l.6 2.6 2.3 1 2.3-1.4 2.8 2.8-1.4 2.3 1 2.3L24 12v0l-2.4.6-1 2.3 1.4 2.3-2.8 2.8-2.3-1.4-2.3 1L14 22h-4l-.6-2.4-2.3-1-2.3 1.4L2 17.2l1.4-2.3-1-2.3L0 12l2.4-.6 1-2.3L2 6.8 4.8 4l2.3 1.4 2.3-1zm2 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    ench: 'M12 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2zM19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1z',
    battle: 'M12 2 4 5v6c0 5 3.5 9.3 8 11 4.5-1.7 8-6 8-11V5z',
    other: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d={paths[t]} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
