import type { CSSProperties, ReactNode } from 'react'
import './theme'
import { basic, card, creature, player, spell } from '../board/fixtures/factory'
import type { PhaseName } from '../protocol'
import { CardFrame, type Highlight } from './CardFrame'
import { CounterGem } from './CounterGem'
import { KeywordRail } from './KeywordRail'
import { LifeShield } from './LifeShield'
import { foldLands, ManaRibbon } from './ManaRibbon'
import { ManaCost, ManaSymbol } from './ManaSymbol'
import { PhaseGems } from './PhaseGems'
import { PTPlate } from './PTPlate'
import { SeatStrip } from './SeatStrip'
import { TableHalf, TableMat } from './TableHalf'
import type { Mat, Metal } from './theme'
import { TypeLine } from './TypeLine'
import { artFor, hasArt, SCENES } from './dev/scenes'
import { StaticTable } from './dev/StaticTable'
import { LiveScene } from './dev/LiveScene'

// /?look: every look component in every state, and static tables (/?look=main, combat, four, quiet, pod) to set beside the mockups.
// &mat=lamplight|midnight, &metal=silver|bronze. /?look=live&scene=… drives the real table from a scene.

const q = new URLSearchParams(location.search)
const view = q.get('look') || 'atoms'
const mat = (q.get('mat') as Mat) || 'identity'
const metal = (q.get('metal') as Metal) || 'gold'

const link = (p: Record<string, string>) => {
  const n = new URLSearchParams({ look: view, mat, metal, ...p })
  if (n.get('mat') === 'identity') n.delete('mat')
  if (n.get('metal') === 'gold') n.delete('metal')
  return '?' + n.toString().replace('look=atoms', 'look')
}

export function DevLook() {
  if (view === 'live') return <LiveScene />
  return (
    <div data-mat={mat} data-metal={metal} className="lk-text" style={{ minHeight: '100%', minWidth: 1440, background: 'radial-gradient(ellipse 80% 60% at 30% 0%, #2a2118 0%, #120e0a 55%, #0a0806 100%)', color: 'var(--lk-parchment)' }}>
      <Nav />
      {view === 'atoms' ? <Atoms /> : SCENES[view] ? <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 40 }}><StaticTable scene={SCENES[view].make()} mat={mat} metal={metal} /></div> : <p style={{ padding: 40 }}>Unknown view.</p>}
    </div>
  )
}

function Nav() {
  const tab = (on: boolean): CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, textDecoration: 'none', fontSize: 12, color: on ? 'var(--lk-on-parchment)' : 'var(--lk-parchment-dim)',
    background: on ? 'linear-gradient(var(--lk-metal-bright), var(--lk-metal-deep))' : 'transparent', boxShadow: on ? undefined : 'inset 0 0 0 1px var(--lk-metal-line)',
  })
  return (
    <div className="lk-label" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 24px', borderBottom: '1px solid var(--lk-metal-line)', fontSize: 12 }}>
      <span style={{ color: 'var(--lk-metal)', marginRight: 8 }}>The look</span>
      {[['atoms', 'Components'], ...Object.entries(SCENES).map(([k, v]) => [k, v.label])].map(([k, l]) => <a key={k} href={link({ look: k })} style={tab(view === k)}>{l}</a>)}
      <span style={{ flex: 1 }} />
      {(['identity', 'lamplight', 'midnight'] as Mat[]).map((m) => <a key={m} href={link({ mat: m })} style={tab(mat === m)}>{m === 'identity' ? 'Your colours' : m}</a>)}
      <span style={{ width: 12 }} />
      {(['gold', 'silver', 'bronze'] as Metal[]).map((m) => <a key={m} href={link({ metal: m })} style={tab(metal === m)}>{m}</a>)}
      {!hasArt && <span style={{ color: 'var(--lk-ember-text)' }}>no dev art (look/dev-art)</span>}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 0', borderTop: '1px solid var(--lk-metal-faint)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h2 className="lk-title" style={{ margin: 0, fontWeight: 700, fontSize: 22 }}>{title}</h2>
        {note && <span style={{ fontSize: 15, color: 'var(--lk-parchment-dim)' }}>{note}</span>}
      </div>
      {children}
    </section>
  )
}

const Row = ({ children, gap = 28, align = 'flex-end' }: { children: ReactNode; gap?: number; align?: string }) => <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: align }}>{children}</div>

function Cap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {children}
      <span className="lk-label" style={{ fontSize: 13, color: 'var(--lk-parchment-mute)' }}>{label}</span>
    </div>
  )
}

const withArt = <T extends { name: string; img: string | null }>(c: T) => ({ ...c, img: artFor(c.name) })

const SHIVAN = withArt(creature('Shivan Dragon', '{4}{R}{R}', 'R', 'Dragon', 5, 5, 'Flying', ['flying']))
const DUSK = withArt(creature("Knight of Dusk's Shadow", '{2}{B}', 'B', 'Vampire Knight', 3, 3, 'Menace', ['menace']))
const ORCHID = withArt(creature('Knight of the White Orchid', '{W}{W}', 'W', 'Human Knight', 3, 3, 'First strike', ['first strike'], { counters: { '+1/+1': 1 } }))
const WALL = withArt(creature('Wall of Omens', '{1}{W}', 'W', 'Wall', 0, 4, 'Defender', ['defender']))
const BIRDS = withArt(creature('Birds of Paradise', '{G}', 'G', 'Bird', 0, 1, 'Flying', ['flying']))
const WITNESS = withArt(creature('Eternal Witness', '{1}{G}{G}', 'G', 'Human Shaman', 2, 1, '', [], { sick: true }))
const RAK = withArt(creature('Rakshasa Gravecaller', '{4}{B}', 'B', 'Cat Demon', 3, 6, 'Exploit', [], { damage: 3 }))
const ELVES = withArt(creature('Llanowar Elves', '{G}', 'G', 'Elf Druid', 1, 1, '{T}: Add {G}.', [], { tapped: true }))
const KRENKO = withArt(creature('Krenko, Tin Street Kingpin', '{2}{R}', 'R', 'Goblin', 3, 4, '', ['haste', 'vigilance'], { counters: { '+1/+1': 2 } }))
const ATRAXA = creature("Atraxa, Praetors' Voice", '{G}{W}{U}{B}', 'WUBG', 'Phyrexian Angel Horror', 4, 4, 'Flying, vigilance, deathtouch, lifelink', ['flying', 'vigilance', 'deathtouch', 'lifelink', 'trample', 'hexproof', 'indestructible'])
const GOBLIN = creature('Goblin', '', 'R', 'Goblin', 1, 1, '', [], { token: true })
const TEFERI = spell('Teferi, Hero of Dominaria', '{3}{W}{U}', 'WU', 'Legendary Planeswalker — Teferi', '+1: Draw a card.', { loyalty: 4, counters: { loyal: 4 } })
const SOL = withArt(spell('Sol Ring', '{1}', '', 'Artifact', '{T}: Add {C}{C}.', { counters: { charge: 2 } }))

const PHASES: PhaseName[] = ['UPKEEP', 'MAIN1', 'COMBAT_DECLARE_BLOCKERS', 'MAIN2', 'END_OF_TURN']
const HL: (Highlight | null)[] = [null, 'playable', 'choose', 'chosen', 'attacking', 'blocking', 'targeted']

function Atoms() {
  const vex = player({ id: 2, name: 'Vex', life: 32, handCount: 4, libraryCount: 61, zones: { hand: [], battlefield: [], graveyard: [1, 2, 3, 4, 5, 6, 7, 8], exile: [1, 2], command: [] } })
  const mira = player({ id: 3, name: 'Mira', life: 28, handCount: 5, libraryCount: 58, zones: { hand: [], battlefield: [], graveyard: Array(11).fill(0), exile: [], command: [] } })
  const oren = player({ id: 4, name: 'Oren', life: 36, poison: 3, handCount: 2, libraryCount: 55, zones: { hand: [], battlefield: [], graveyard: Array(6).fill(0), exile: [0], command: [0] } })
  const lands = [...Array.from({ length: 4 }, (_, i) => basic('Forest', { tapped: i < 1 })), ...Array.from({ length: 3 }, () => basic('Plains')), basic('Island', { tapped: true }),
    spell('Temple Garden', '', '', 'Land — Forest Plains', '({T}: Add {G} or {W}.)', { types: ['Land'] }), card({ name: 'Command Tower', types: ['Land'], text: '{T}: Add one mana of any color in your commander\'s color identity.' })]
  return (
    <div style={{ padding: '24px 64px 80px', display: 'flex', flexDirection: 'column' }}>
      <h1 className="lk-title" style={{ margin: '12px 0 4px', fontWeight: 900, fontSize: 52, lineHeight: 1 }}>The look</h1>
      <p style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--lk-parchment-dim)', maxWidth: 760 }}>
        Card-frame materials as React components (D-05): parchment, frost for what you can do, breathing gold for what to choose, brass for chosen, ember for attack and damage, steel for blocks and protection.
      </p>

      <Section title="Mana symbols" note="Our own set. Costs parse the server's {2}{W}{U} and Forge shorthand 2 W U.">
        <Row gap={14} align="center">
          {['W', 'U', 'B', 'R', 'G', 'C', '0', '1', '2', '3', '7', '12', 'X', 'S', 'W/U', 'B/R', 'G/W', '2/W', 'C/U', 'R/P', 'G/P', 'B/G/P', 'T', 'Q', 'E'].map((s) => (
            <Cap key={s} label={s}><ManaSymbol sym={s} size={30} /></Cap>
          ))}
        </Row>
        <Row gap={24} align="center">
          {['{2}{W}{U}', '{X}{R}{R}', '{5}{G}{G}{G}', '{G}{W}{U}{B}', '2 W U', '{1}{W/U}{B/P}'].map((c) => (
            <Cap key={c} label={c}><span style={{ fontSize: 20 }}><ManaCost cost={c} size={20} /></span></Cap>
          ))}
          <Cap label="inline, 14px"><span style={{ fontSize: 17 }}>Pay <ManaCost cost="{1}{G}" size={15} />, <ManaSymbol sym="T" size={15} />: Add <ManaSymbol sym="G" size={15} />.</span></Cap>
        </Row>
      </Section>

      <Section title="Phase gems" note="Past common black, upcoming uncommon silver, current mythic; ember in combat.">
        <Row gap={36} align="center">
          {PHASES.map((p) => <Cap key={p} label={p}><PhaseGems phase={p} /></Cap>)}
        </Row>
      </Section>

      <Section title="Type line" note="The divider between the halves; ember in combat; turn order in multiplayer.">
        <TypeLine activeName="You" you phase="MAIN1" turn={7} hint="Play a land or cast spells" gemLabels />
        <TypeLine activeName="Vex" you={false} phase="COMBAT_DECLARE_BLOCKERS" hint={<>Choose a blocker for <b>Shivan Dragon</b>, or click another attacker</>} ledger="Net −6 · 20 → 14" />
        <TypeLine activeName="Vex" you={false} phase="COMBAT_DECLARE_BLOCKERS" activeId={2} order={[{ id: 2, name: 'Vex' }, { id: 1, name: 'You', you: true }, { id: 3, name: 'Mira' }, { id: 4, name: 'Oren' }]} />
        <TypeLine activeName="Mira" you={false} phase="END_OF_TURN" hint="Vex is next" activeId={3} order={[{ id: 3, name: 'Mira' }, { id: 4, name: 'Oren', out: true }, { id: 2, name: 'Vex' }, { id: 1, name: 'You', you: true }]} />
      </Section>

      <Section title="Life shield" note="Combat preview from the engine, poison, commander damage per source.">
        <Row gap={44}>
          <Cap label="at rest"><LifeShield life={20} /></Cap>
          <Cap label="your turn"><LifeShield life={20} rim="bright" /></Cap>
          <Cap label="their turn"><LifeShield life={18} rim="active" width={78} /></Cap>
          <Cap label="combat preview"><LifeShield life={20} preview={14} rim="ember" /></Cap>
          <Cap label="lifelink preview"><LifeShield life={12} preview={17} /></Cap>
          <Cap label="lethal"><LifeShield life={5} preview={0} lethal /></Cap>
          <Cap label="poison"><LifeShield life={17} poison={4} /></Cap>
          <Cap label="100+"><LifeShield life={142} /></Cap>
          <div style={{ paddingRight: 120 }}><Cap label="commander damage"><LifeShield life={40} preview={38} rim="ember" commander={[{ name: 'Krenko', amount: 7 }, { name: 'Atraxa', amount: 16 }]} /></Cap></div>
        </Row>
      </Section>

      <Section title="Mana ribbon" note="Lands folded into symbols; usable untapped mana glows frost; tapped-out sources fade.">
        <Row gap={24} align="center">
          <Cap label="yours, usable"><ManaRibbon sources={[...foldLands(lands), { sym: '2', untapped: 1, total: 1, label: 'Sol Ring' }]} usable /></Cap>
          <Cap label="not your priority"><ManaRibbon sources={foldLands(lands)} summary="6 untapped" /></Cap>
          <Cap label="opponent, compact"><ManaRibbon size={20} sources={[{ sym: 'U', untapped: 3, total: 3 }, { sym: 'B', untapped: 2, total: 2 }, { sym: 'R', untapped: 0, total: 2 }]} summary="5 untapped" /></Cap>
        </Row>
      </Section>

      <Section title="Keyword rail" note="Tier 1 ember ring and word, tier 2 steel (lock while you target), tier 3 icon only. Hover a rail for words.">
        <Row gap={120} align="flex-start">
          <Cap label="tier 1 · danger"><KeywordRail keywords={['deathtouch', 'first strike', 'double strike', 'trample', 'menace', 'infect', 'lifelink']} /></Cap>
          <Cap label="tier 2 · protected"><KeywordRail keywords={['hexproof', 'shroud', 'indestructible', 'ward', 'protection']} /></Cap>
          <Cap label="tier 2 · targeting"><KeywordRail keywords={['hexproof', 'shroud', 'indestructible', 'ward']} choosingTargets /></Cap>
          <Cap label="tier 3 · evasion"><KeywordRail keywords={['flying', 'reach', "can't be blocked"]} /></Cap>
        </Row>
      </Section>

      <Section title="P/T plate and counters" note="Parchment printed, frost raised, ember damaged or lowered (needs the base P/T from the server).">
        <Row gap={36} align="center">
          <Cap label="printed"><PTPlate power={3} toughness={3} base={{ power: 3, toughness: 3 }} /></Cap>
          <Cap label="raised"><PTPlate power={4} toughness={4} base={{ power: 3, toughness: 3 }} /></Cap>
          <Cap label="lowered"><PTPlate power={1} toughness={1} base={{ power: 2, toughness: 2 }} /></Cap>
          <Cap label="damaged"><PTPlate power={3} toughness={6} damage={3} /></Cap>
          <Cap label="no base yet"><PTPlate power={5} toughness={5} /></Cap>
          <span style={{ width: 30 }} />
          <Cap label="+1/+1"><CounterGem name="+1/+1" count={1} /></Cap>
          <Cap label="+1/+1 ×3"><CounterGem name="+1/+1" count={3} /></Cap>
          <Cap label="−1/−1"><CounterGem name="-1/-1" count={2} /></Cap>
          <Cap label="charge"><CounterGem name="charge" count={3} /></Cap>
          <Cap label="lore"><CounterGem name="lore" count={1} /></Cap>
        </Row>
      </Section>

      <Section title="Card frame · states" note="Highlight rings keep one meaning each. Gold breathes (opacity only).">
        <Row gap={34}>
          {HL.map((h) => <Cap key={h ?? 'none'} label={h ?? 'at rest'}><CardFrame card={h === 'attacking' ? SHIVAN : h === 'blocking' ? WALL : h === 'choose' ? BIRDS : h === 'targeted' ? ORCHID : h === 'chosen' ? DUSK : h === 'playable' ? SOL : RAK} width={128} highlight={h} base={h === 'targeted' ? { power: 2, toughness: 2 } : undefined} /></Cap>)}
        </Row>
        <Row gap={34}>
          <Cap label="can't block (dim)"><CardFrame card={WITNESS} width={128} dim="Can't block a creature with flying" /></Cap>
          <Cap label="summoning sick"><CardFrame card={WITNESS} width={128} /></Cap>
          <Cap label="tapped (mark)"><CardFrame card={ELVES} width={128} /></Cap>
          <Cap label="tapped (rotated)"><div style={{ width: 180, display: 'grid', placeItems: 'center' }}><CardFrame card={ELVES} width={128} rotate /></div></Cap>
          <Cap label="dies"><CardFrame card={ELVES} width={128} verdict="dies" highlight="blocking" /></Cap>
          <Cap label="survives"><CardFrame card={DUSK} width={128} verdict="survives" highlight="attacking" /></Cap>
          <Cap label="status marks"><CardFrame card={KRENKO} width={128} base={{ power: 1, toughness: 2 }} /></Cap>
        </Row>
        <Row gap={34}>
          <Cap label="many keywords, no art"><CardFrame card={ATRAXA} width={128} /></Cap>
          <Cap label="choosing targets"><CardFrame card={ATRAXA} width={128} choosingTargets /></Cap>
          <Cap label="token group ×9"><CardFrame card={GOBLIN} width={128} count={9} /></Cap>
          <Cap label="planeswalker"><CardFrame card={TEFERI} width={128} /></Cap>
          <Cap label="charge counters"><CardFrame card={SOL} width={128} /></Cap>
          <Cap label="damage marked"><CardFrame card={RAK} width={128} /></Cap>
        </Row>
      </Section>

      <Section title="Card frame · widths" note="Laid out once at 160 px and scaled: a new width is only a transform.">
        <Row gap={26}>
          {[56, 72, 96, 128, 160, 220].map((w) => <Cap key={w} label={`${w}px`}><CardFrame card={ORCHID} width={w} base={{ power: 2, toughness: 2 }} highlight={w === 96 ? 'playable' : null} /></Cap>)}
          {[56, 96, 160].map((w) => <Cap key={'a' + w} label={`${w}px`}><CardFrame card={ATRAXA} width={w} /></Cap>)}
        </Row>
      </Section>

      <Section title="Seat strips" note="Opponents in multiplayer. Shapes over sentences.">
        <Row gap={20}>
          <SeatStrip player={vex} colors="UBG" status="attacking" open={[{ sym: 'U', untapped: 1, total: 4 }, { sym: 'B', untapped: 1, total: 3 }, { sym: 'G', untapped: 1, total: 2 }]} facts={<span>6 creatures, 3 attacking</span>} triggers={{ will: 2, could: 0 }} />
          <SeatStrip player={mira} colors="WB" status="defending" open={[{ sym: 'W', untapped: 1, total: 3 }, { sym: 'B', untapped: 1, total: 3 }]} facts={<span>Untapped power 7</span>} triggers={{ will: 0, could: 1 }} preview={27} />
          <SeatStrip player={oren} colors="RG" status="waiting" open={[{ sym: 'R', untapped: 3, total: 3 }, { sym: 'G', untapped: 2, total: 2 }]} threat="Can hit you for 14 next turn" commander={{ name: 'Krenko', tax: 2 }} />
          <SeatStrip player={{ ...oren, name: 'Tamsin', hasLost: true, life: 0 }} colors="U" />
        </Row>
      </Section>

      <Section title="Table tones" note="Flat colour-identity tones (Q-01): one colour flat, more split into WUBRG bands with a soft seam. Active half brighter.">
        <Row gap={14}>
          {['W', 'U', 'B', 'R', 'G', '', 'GW', 'UBR', 'WUBG', 'WUBRG'].map((c) => (
            <Cap key={c} label={c || 'colourless'}>
              <TableMat mat={mat} metal={metal} style={{ width: 230, height: 150, borderRadius: 12 }} halves={
                <>
                  <TableHalf colors={c} side="top" style={{ position: 'absolute', inset: '0 0 50% 0' }} />
                  <TableHalf colors={c} active style={{ position: 'absolute', inset: '50% 0 0 0' }} />
                </>
              }>
                <span className="lk-label" style={{ position: 'absolute', left: 18, top: 16, fontSize: 12, color: 'var(--lk-parchment-mute)' }}>rest</span>
                <span className="lk-label" style={{ position: 'absolute', left: 18, bottom: 16, fontSize: 12, color: 'var(--lk-parchment-dim)' }}>active</span>
              </TableMat>
            </Cap>
          ))}
        </Row>
      </Section>
    </div>
  )
}
