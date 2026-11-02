import { send } from '../net'

/** "In response": you're answering and want longer. The server adds the time (and says so with a new timer). */
export function MoreTime() {
  return (
    <button type="button" title="20 more seconds before priority passes for you"
      onClick={(e) => {
        e.stopPropagation()
        send({ t: 'moreTime' })
      }}
      className="lk-title"
      style={{ pointerEvents: 'auto', border: '1px solid var(--lk-gold-soft)', borderRadius: 3, background: 'rgb(245 213 138 / .1)', color: 'var(--lk-gold)', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '1px 6px', lineHeight: '16px' }}>
      In response +20s
    </button>
  )
}
