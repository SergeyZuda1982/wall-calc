import type { Profile } from '../types'

export const PROFILES: Profile[] = [
  { label: 'ПС 50×50',  value: 'ps50',  overlap: 500,  width: 50  },
  { label: 'ПС 75×50',  value: 'ps75',  overlap: 750,  width: 75  },
  { label: 'ПС 100×50', value: 'ps100', overlap: 1000, width: 100 },
]

export const DEFAULT_PROFILE = PROFILES[0]

export function getProfile(value: string): Profile {
  return PROFILES.find(p => p.value === value) ?? DEFAULT_PROFILE
}
