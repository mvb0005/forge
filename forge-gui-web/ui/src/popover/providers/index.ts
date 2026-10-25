import { registerPeekProvider } from '../../table/peek'
import { cardPeek } from './card'
import { combatPeek } from './combat'

// Every peek provider is registered here.
registerPeekProvider(cardPeek)
registerPeekProvider(combatPeek)
