// Максимальные высоты облицовок по Кнауф
// Ключ: {liningType}_{profile}_{step} → макс высота мм

const MAX_HEIGHT: Record<string, number> = {
  // С625 (1 слой, от ПС75)
  'c625_ps75_600': 4800,
  'c625_ps75_400': 5700,
  'c625_ps75_300': 6000,
  'c625_ps100_600': 6000,
  'c625_ps100_400': 6300,
  'c625_ps100_300': 6900,

  // С626 (2 слоя, от ПС50)
  'c626_ps50_600': 3300,
  'c626_ps50_400': 3900,
  'c626_ps50_300': 4500,
  'c626_ps75_600': 4800,
  'c626_ps75_400': 5700,
  'c626_ps75_300': 6300,
  'c626_ps100_600': 6000,
  'c626_ps100_400': 6600,
  'c626_ps100_300': 7200,

  // С623 — макс 10м (ограничение по подвесам, не по профилю)
  'c623__600': 10000,
  'c623__400': 10000,
  'c623__300': 10000,
}

export function getLiningMaxHeight(
  liningType: string,
  profile: string,
  step: number
): number {
  const key = `${liningType}_${profile}_${step}`
  return MAX_HEIGHT[key] ?? 0
}
