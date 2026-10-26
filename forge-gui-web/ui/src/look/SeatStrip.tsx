import { memo, type ReactNode } from 'react'
import './theme'
import type { PlayerDto } from '../protocol'
import { LifeShield, type CommanderHit } from './LifeShield'
import type { RibbonSource } from './ManaRibbon'
import { ManaSymbol } from './ManaSymbol'
import { MARK_GLYPH, Icon } from './glyphs'
import { identity } from './tones'

export type SeatStatus = 'active' | 'attacking' | 'defending' | 'waiting' | 'out'

const STATUS: Record<SeatStatus, { text: string; color: string; rim: string }> = {
  active: { text: 'Their turn', color: 'var(--lk-mythic-top)', rim: '0 0 0 2px var(--lk-mythic-top)' },
  attacking: { text: 'Attacking', color: 'var(--lk-mythic-top)', rim: '0 0 0 2px var(--lk-mythic-top)' },
  defending: { text: 'Under attack', color: 'var(--lk-ember-text)', rim: '0 0 0 1.5px var(--lk-ember)' },
  waiting: { text: 'Waiting', color: 'var(--lk-parchment-dim)', rim: '0 0 0 1px var(--lk-metal-line)' },
  out: { text: 'Out', color: 'var(--lk-parchment-mute)', rim: '0 0 0 1px var(--lk-metal-faint)' },
}

const PIP: Record<string, string> = { W: 'var(--lk-mana-w)', U: 'var(--lk-mana-u)', B: 'var(--lk-mana-b)', R: 'var(--lk-mana-r)', G: 'var(--lk-mana-g)' }

/**
 * An opponent in multiplayer: life, colours, open mana, hand, zone counts, commander, triggers. Shapes over sentences.
 * `threat` ("Can hit you for 14 next turn") and trigger counts are engine numbers the caller passes in.
 */
export const SeatStrip = memo(function SeatStrip({ player, colors, status = 'waiting', open = [], threat, facts, triggers, commander, cmdDamage, preview = null, width = 440 }: {
  player: PlayerDto
  colors: string
  status?: SeatStatus
  open?: RibbonSource[]
  threat?: ReactNode
  facts?: ReactNode
  triggers?: { will: number; could: number }
  commander?: { name: string; tax: number }
  cmdDamage?: CommanderHit[]
  preview?: number | null
  width?: number
}) {
  const st = STATUS[player.hasLost ? 'out' : status]
  const openCount = open.reduce((n, s) => n + s.untapped, 0)
  const z = player.zones
  return (
    <div
      className="lk-text"
      style={{
        width, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: '62px minmax(0, 1fr)', gap: '4px 12px', padding: '10px 12px', borderRadius: 14,
        background: 'var(--lk-panel)', boxShadow: `${st.rim}, 0 10px 24px rgb(0 0 0 / .6)`, color: 'var(--lk-parchment)', opacity: player.hasLost ? 0.55 : 1,
      }}
    >
      <span style={{ gridRow: 'span 3' }}>
        <LifeShield life={player.life} preview={preview} poison={player.poison} width={62} rim={status === 'active' || status === 'attacking' ? 'active' : status === 'defending' ? 'ember' : 'dim'} />
      </span>
      <div className="lk-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 17, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
        {identity(colors).map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 999, background: PIP[c], flex: 'none', boxShadow: '0 1px 2px rgb(0 0 0 / .6)' }} />)}
        <span className="lk-label" style={{ fontSize: 13, color: st.color, marginLeft: 4, whiteSpace: 'nowrap' }}>{st.text}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 12px', fontSize: 15, color: 'var(--lk-parchment-dim)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: openCount ? 'var(--lk-ember-light)' : undefined }}>
          {openCount} open
          {open.filter((s) => s.untapped > 0).map((s, i) => <ManaSymbol key={i} sym={s.sym} size={13} shadow={false} />)}
        </span>
        <span>Hand {player.handCount}</span>
        {threat && <span style={{ color: 'var(--lk-ember-light)' }}>{threat}</span>}
        {facts}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', fontSize: 13.5, color: 'var(--lk-parchment-dim)' }}>
        <span>Lib <Num n={player.libraryCount} /></span>·<span>GY <Num n={z.graveyard.length} /></span>·<span>Exile <Num n={z.exile.length} /></span>
        {commander && <>·<span>Command <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{commander.name}</b> (tax {commander.tax})</span></>}
        {triggers && (triggers.will > 0 || triggers.could > 0) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--lk-gold)' }}>
            <Icon g={MARK_GLYPH.trigger} size={12} color="var(--lk-gold)" />
            {triggers.will > 0 ? `${triggers.will} trigger${triggers.will > 1 ? 's' : ''}` : `${triggers.could} could`}
          </span>
        )}
        {cmdDamage?.map((c) => <span key={c.name} style={{ color: 'var(--lk-ember-light)' }}>{c.name} <Num n={c.amount} />/21</span>)}
      </div>
    </div>
  )
})

const Num = ({ n }: { n: number }) => <b className="lk-title" style={{ color: 'var(--lk-parchment)' }}>{n}</b>
