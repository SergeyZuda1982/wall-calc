/**
 * numInput.ts — помощники для числовых полей.
 * Убирают «залипший» ведущий ноль (022800 → 22800) и ставят выделение содержимого при входе в поле.
 */

/** Убирает ведущие нули целой части: «022800» → «22800», «-007» → «-7», «0.5» и «0» не меняет. */
export function stripLeadingZeros(raw: string): string {
  return raw.replace(/^(-?)0+(?=\d)/, '$1')
}

/** Текст поля → число (пусто, «-», «.» → 0). */
export function parseNumText(raw: string): number {
  const v = parseFloat(raw.replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

/** Значение → текст для поля (округление до сотых, без хвостов). */
export function numToText(v: number): string {
  return String(Number.isFinite(v) ? Math.round(v * 100) / 100 : 0)
}

/**
 * При входе в числовое поле выделяет всё содержимое, чтобы набор заменял старое значение (и «0»).
 * Ставится один раз на документ. Возвращает функцию отмены.
 */
export function installSelectOnFocus(doc: Document = document): () => void {
  let pending: EventTarget | null = null
  const isNum = (t: EventTarget | null): t is HTMLInputElement =>
    t instanceof HTMLInputElement && t.type === 'number' && !t.readOnly && !t.disabled
  const onFocusIn = (e: FocusEvent) => {
    if (!isNum(e.target)) return
    pending = e.target
    const el = e.target
    setTimeout(() => { if (doc.activeElement === el) el.select() }, 0)
  }
  // Отпускание мыши сразу после фокуса не должно снимать выделение.
  const onMouseUp = (e: MouseEvent) => {
    if (pending && e.target === pending) e.preventDefault()
    pending = null
  }
  doc.addEventListener('focusin', onFocusIn)
  doc.addEventListener('mouseup', onMouseUp, true)
  return () => { doc.removeEventListener('focusin', onFocusIn); doc.removeEventListener('mouseup', onMouseUp, true) }
}
