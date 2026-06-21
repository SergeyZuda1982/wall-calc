import { useEffect, useRef, useState } from 'react'

/**
 * Меряет реальную доступную ширину контейнера через ResizeObserver и
 * возвращает её, ограниченную сверху maxWidth (и снизу разумным минимумом,
 * чтобы canvas не схлопывался в нечитаемую полоску).
 *
 * На десктопе контейнер обычно шире maxWidth — возвращается maxWidth как
 * есть (поведение не меняется). На телефоне контейнер уже maxWidth —
 * возвращается реальная ширина экрана за вычетом inset (padding контейнера),
 * и вся перегородка/облицовка целиком влезает в видимую область без
 * горизонтального скролла, который на canvas всё равно перехватывается
 * Konva и блокирует обычный скролл страницы пальцем.
 *
 * @param maxWidth верхний предел (desktop-ширина canvas, как было раньше)
 * @param inset    суммарный горизонтальный padding измеряемого контейнера —
 *                 вычитается из clientWidth, чтобы не упереться в его край
 */
export function useContainerWidth(maxWidth: number, inset = 0) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(maxWidth)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => {
      const w = el.clientWidth - inset
      if (w > 0) setWidth(Math.max(260, Math.min(maxWidth, Math.floor(w))))
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxWidth, inset])

  return [ref, width] as const
}
