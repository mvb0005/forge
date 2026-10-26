import { createContext, useContext, type ReactNode } from 'react'
import { Kbd } from './ui'

export const MinimizeCtx = createContext<{ minimized: boolean; setMinimized: (m: boolean) => void }>({
  minimized: false,
  setMinimized: () => {},
})
export const useMinimized = () => useContext(MinimizeCtx).minimized

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

// The card every ask is drawn in. Centred over a lightly dimmed table; can be minimised to a pill
// so the player can study the board, keeping the dialog's own state mounted.
export function Frame({ title, message, aside, footer, children, size = 'md', hint }: {
  title: string
  message?: string
  aside?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  size?: keyof typeof widths
  hint?: ReactNode
}) {
  const { minimized, setMinimized } = useContext(MinimizeCtx)
  return (
    <>
      {minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="shell-in lk-plate fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full px-5 py-2.5 text-base transition"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-target" />
          <span className="font-title font-bold">{title}</span>
          <span className="text-ink-dim">Click to answer</span>
        </button>
      )}
      <div className={`fixed inset-0 z-40 grid place-items-center bg-table/45 p-6 ${minimized ? 'hidden' : 'shell-fade'}`}>
        <div
          role="dialog"
          aria-label={title}
          className={`shell-in lk-plate flex max-h-[88vh] w-full ${widths[size]} flex-col overflow-hidden rounded-2xl`}
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-title text-xl font-bold leading-tight">{title}</h2>
              {message && message !== title && <p className="mt-1 whitespace-pre-line text-base text-ink-dim">{message}</p>}
            </div>
            <button
              type="button"
              title="Minimise to look at the board"
              onClick={() => setMinimized(true)}
              className="-mr-1 rounded-lg px-2 py-1 text-sm text-ink-dim transition hover:bg-panel-2 hover:text-ink"
            >
              ▁ Peek board
            </button>
          </header>
          <div className="flex min-h-0 flex-1 gap-5 overflow-hidden px-5 py-4">
            {aside && <div className="shrink-0">{aside}</div>}
            <div className="shell-scroll min-w-0 flex-1 overflow-y-auto">{children}</div>
          </div>
          {(footer || hint) && (
            <footer className="flex items-center gap-2 border-t border-line bg-table/40 px-5 py-3">
              <div className="flex-1 text-xs text-ink-dim">{hint}</div>
              {footer}
            </footer>
          )}
        </div>
      </div>
    </>
  )
}

export const EnterHint = ({ label = 'confirm' }: { label?: string }) => (
  <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd> {label}</span>
)
