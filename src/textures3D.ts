/**
 * textures3D.ts — процедурные текстуры материалов кладки/бетона для 3D-вида
 * (Scene3D.tsx). Намеренно ОТДЕЛЬНО от core/planTo3D.ts — тот файл сознательно
 * не импортирует three.js (чистая математика, тестируется без браузера), а
 * здесь ровно наоборот: THREE.CanvasTexture, реальные canvas-рисунки.
 *
 * Идея (см. обсуждение с пользователем, KONSPEKT.md): не геометрия отдельных
 * кирпичей/блоков (это тысячи мешей на объект, убьёт производительность), а
 * ОДНА текстура на материал, нарисованная один раз на <canvas> и переиспользуемая
 * для всех стен — только repeat (масштаб повтора) у каждой стены свой, чтобы
 * кладка была в правильном реальном масштабе (иначе кирпичи "поплывут" на
 * стенах разной длины).
 *
 * Базовые текстуры рисуются ОДИН РАЗ и кэшируются на модуле (lazy) — при
 * запросе под конкретную стену возвращается .clone() с выставленным под неё
 * repeat, сам canvas и WebGL-текстура при этом не пересоздаются.
 *
 * Швы кирпича/блока при этом всегда получаются РОВНО между рядами и
 * "кирпичами" в текстуре (не приблизительно) — тайл текстуры построен так,
 * что каждый кирпич/блок с раствором вокруг занимает ЦЕЛОЕ число пикселей
 * тайла, и сам тайл — это ровно 1 модуль по ширине и 2 ряда по высоте
 * (перевязка "вразбежку" по горизонтали, поэтому тайл бесшовно повторяется
 * и по X, и по Y только при чётном числе рядов).
 *
 * Известное упрощение (как и остальная геометрия стены — прямоугольная
 * коробка, см. planTo3D.ts): repeat считается по размеру ГЛАВНОЙ грани стены
 * (sx × sy — длина × высота, то, что видно спереди/сзади), торцевые и
 * верх/низ грани получают тот же repeat, хоть их реальные пропорции другие —
 * для тонких боковых граней стены это малозаметно.
 */

import * as THREE from 'three'
import type { WallMaterialKind } from './core/planTo3D'

// ─── Модули кладки (реальные размеры, метры, "кирпич/блок + шов") ──────────

const BRICK_MODULE_W_M = 0.26   // кирпич 250мм + шов ~10мм
const BRICK_MODULE_H_M = 0.075  // кирпич "на ребро" ~65мм + шов ~10мм (1 ряд)
const BLOCK_MODULE_W_M = 0.61   // блок 600мм + шов ~10мм
const BLOCK_MODULE_H_M = 0.205  // блок 200мм + шов ~5мм (тонкий клеевой шов)
const CONCRETE_TILE_M = 2.0     // просто масштаб шума, не модуль кладки

// ─── Детерминированный псевдослучайный шум (без внешних зависимостей) ─────

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function jitterColor(hex: string, amount: number, rnd: () => number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const d = (rnd() * 2 - 1) * amount
  return `rgb(${clamp(r + d)}, ${clamp(g + d)}, ${clamp(b + d)})`
}

// ─── Рисование базовых тайлов ──────────────────────────────────────────────

/** Кирпичная кладка, перевязка вразбежку (стандартная "цепная"/"крестовая" вперевязку). */
function drawBrickTile(): HTMLCanvasElement {
  const PX_PER_M = 400
  const w = Math.round(BRICK_MODULE_W_M * PX_PER_M)
  const h = Math.round(BRICK_MODULE_H_M * PX_PER_M * 2) // 2 ряда — чтобы вразбежку тайлилось бесшовно
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rnd = mulberry32(1337)
  const mortar = '#b8ab9c'
  const brickBase = '#9c5a3c'
  const joint = Math.max(2, Math.round(w * 0.035))

  ctx.fillStyle = mortar
  ctx.fillRect(0, 0, w, h)

  const rowH = h / 2
  // Ряд 1: один целый кирпич на всю ширину тайла
  ctx.fillStyle = jitterColor(brickBase, 18, rnd)
  ctx.fillRect(joint / 2, joint / 2, w - joint, rowH - joint)
  // Ряд 2: смещён на половину — два полукирпича по краям тайла
  ctx.fillStyle = jitterColor(brickBase, 18, rnd)
  ctx.fillRect(joint / 2, rowH + joint / 2, w / 2 - joint, rowH - joint)
  ctx.fillStyle = jitterColor(brickBase, 18, rnd)
  ctx.fillRect(w / 2 + joint / 2, rowH + joint / 2, w / 2 - joint, rowH - joint)

  return canvas
}

/** Блочная кладка (газоблок/пеноблок/блок) — крупнее модуль, тоньше шов, меньше разброс тона. */
function drawBlockTile(): HTMLCanvasElement {
  const PX_PER_M = 220
  const w = Math.round(BLOCK_MODULE_W_M * PX_PER_M)
  const h = Math.round(BLOCK_MODULE_H_M * PX_PER_M * 2)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const rnd = mulberry32(4242)
  const mortar = '#cfc9bd'
  const blockBase = '#d8d2c2'
  const joint = Math.max(2, Math.round(w * 0.012))

  ctx.fillStyle = mortar
  ctx.fillRect(0, 0, w, h)

  const rowH = h / 2
  ctx.fillStyle = jitterColor(blockBase, 10, rnd)
  ctx.fillRect(joint / 2, joint / 2, w - joint, rowH - joint)
  ctx.fillStyle = jitterColor(blockBase, 10, rnd)
  ctx.fillRect(joint / 2, rowH + joint / 2, w / 2 - joint, rowH - joint)
  ctx.fillStyle = jitterColor(blockBase, 10, rnd)
  ctx.fillRect(w / 2 + joint / 2, rowH + joint / 2, w / 2 - joint, rowH - joint)

  return canvas
}

/** Монолитный бетон — без швов, просто лёгкий "шум" (разводы опалубки/заполнитель). */
function drawConcreteTile(): HTMLCanvasElement {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rnd = mulberry32(9001)
  const base = '#9a9a96'

  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  // Крупные бледные разводы (следы опалубки/затирки)
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.03})`
    const rw = 40 + rnd() * 120, rh = 10 + rnd() * 30
    ctx.fillRect(rnd() * size, rnd() * size, rw, rh)
  }
  // Мелкая крапинка (заполнитель)
  for (let i = 0; i < 900; i++) {
    const v = rnd()
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.05})` : `rgba(255,255,255,${0.03 + rnd() * 0.05})`
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2)
  }

  return canvas
}

// ─── Кэш базовых текстур (создаются один раз, лениво) ──────────────────────

const baseTextureCache = new Map<Exclude<WallMaterialKind, 'unknown'>, THREE.Texture>()

function getBaseTexture(kind: Exclude<WallMaterialKind, 'unknown'>): THREE.Texture {
  const cached = baseTextureCache.get(kind)
  if (cached) return cached

  const canvas = kind === 'brick' ? drawBrickTile() : kind === 'block' ? drawBlockTile() : drawConcreteTile()
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  baseTextureCache.set(kind, tex)
  return tex
}

/**
 * Текстура для конкретной стены/плиты/колонны нужного материала, с repeat,
 * посчитанным из реальных размеров главной грани (метры) — чтобы кладка была
 * в правильном масштабе. Возвращает null для 'unknown' — там остаётся
 * прежний плоский цвет без текстуры (нет данных о материале).
 *
 * Каждый вызов возвращает НОВЫЙ клон (repeat у каждой стены свой), но сам
 * canvas/WebGL-текстура выше по цепочке (getBaseTexture) переиспользуется —
 * клонирование THREE.Texture дешёвое, повторной загрузки на GPU не будет.
 */
export function getWallTexture(kind: WallMaterialKind, widthM: number, heightM: number): THREE.Texture | null {
  if (kind === 'unknown') return null
  const base = getBaseTexture(kind)
  const tex = base.clone()
  tex.needsUpdate = true

  const moduleW = kind === 'brick' ? BRICK_MODULE_W_M : kind === 'block' ? BLOCK_MODULE_W_M : CONCRETE_TILE_M
  const moduleH = kind === 'brick' ? BRICK_MODULE_H_M * 2 : kind === 'block' ? BLOCK_MODULE_H_M * 2 : CONCRETE_TILE_M
  tex.repeat.set(Math.max(widthM / moduleW, 0.1), Math.max(heightM / moduleH, 0.1))
  return tex
}

/** Лёгкий цветной оттенок поверх текстуры (сохраняет читаемость типа линии на плане —
 *  новое/существующее/облицовка), см. обсуждение с пользователем перед стартом задачи. */
export function tintOverTexture(hex: string): THREE.Color {
  const white = new THREE.Color('#ffffff')
  const target = new THREE.Color(hex)
  return white.lerp(target, 0.22)
}
