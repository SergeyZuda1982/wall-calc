import { useState, useEffect } from 'react'

/** true если ширина окна меньше брейкпоинта (по умолчанию 768px) */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  )

  useEffect(() => {
    function update() { setIsMobile(window.innerWidth < breakpoint) }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [breakpoint])

  return isMobile
}
