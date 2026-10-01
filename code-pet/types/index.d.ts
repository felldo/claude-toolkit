export type Species = 'cat' | 'dog' | 'pikachu'

export type IdleActivity = 'play' | 'purr' | 'groom' | 'sleep' | 'sit'

export type Mood =
  | IdleActivity
  | 'watch'
  | 'busy'
  | 'frantic'
  | 'startled'
  | 'happy'
  | 'perk'

export type PetEvent = { kind: 'startled' | 'happy' | 'perk'; at: number }

export type PetTick = { frame: number; now: number; load: number }

export type PetIdle = { activity: IdleActivity; until: number }

export type PetConfig = { species: Species; name: string; isHidden: boolean }

declare module 'claude-code' {
  interface PluginState {
    'code-pet': {
      tick: PetTick
      event: PetEvent | null
      idle: PetIdle
      config: PetConfig
    }
  }
}
