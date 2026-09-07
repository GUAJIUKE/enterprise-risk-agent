/** 极简路由：/ 为产品页，/demo 为演示控制台（不引入额外依赖）。 */

import { useEffect, useState } from 'react'

export type RoutePath = '/' | '/demo'

function currentPath(): RoutePath {
  const p = window.location.pathname.replace(/\/+$/, '')
  return p === '/demo' ? '/demo' : '/'
}

export function useRoute(): RoutePath {
  const [path, setPath] = useState<RoutePath>(currentPath)

  useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  return path
}

export function navigate(to: RoutePath): void {
  if (currentPath() === to) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
