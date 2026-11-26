function resolveRuntimeDocument(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, 'document')) {
    return options.document || null
  }
  return typeof document !== 'undefined' ? document : null
}

function resolveRuntimeWindow(options) {
  if (options && Object.prototype.hasOwnProperty.call(options, 'window')) {
    return options.window || null
  }
  return typeof window !== 'undefined' ? window : null
}

function containsNode(parent, node) {
  if (!parent || !node || parent === node) return false
  return typeof parent.contains === 'function' && parent.contains(node)
}

// Shadow DOM hosts may retarget document.fullscreenElement to the host.
// Read the target's own root first and keep unrelated fullscreen elements intact.
function nativeFullscreenElement(runtimeDocument, target) {
  let root = null
  try { root = target?.getRootNode?.() } catch { /* restricted host */ }
  const current = root?.fullscreenElement || root?.webkitFullscreenElement
    || runtimeDocument?.fullscreenElement || runtimeDocument?.webkitFullscreenElement || null
  if (current) return current
  try { if (target?.matches?.(':fullscreen')) return target } catch { /* older browser */ }
  try { if (target?.matches?.(':-webkit-full-screen')) return target } catch { /* unsupported selector */ }
  return null
}

function nativeExitMethod(runtimeDocument) {
  const method = runtimeDocument?.exitFullscreen || runtimeDocument?.webkitExitFullscreen || runtimeDocument?.webkitCancelFullScreen
  return typeof method === 'function' ? method.bind(runtimeDocument) : null
}

function safelyExitNative(runtimeDocument, target, requestRecord = null) {
  if (requestRecord?.exitRequested) return
  const current = nativeFullscreenElement(runtimeDocument, target)
  const ownsFullscreen = Boolean(
    target && (current === target || containsNode(target, current)),
  )
  if (!ownsFullscreen || !nativeExitMethod(runtimeDocument)) return

  if (requestRecord) requestRecord.exitRequested = true
  try {
    Promise.resolve(nativeExitMethod(runtimeDocument)()).catch(() => {})
  } catch {
    // Native exit is best-effort while a canceled request settles.
  }
}

/**
 * Keep a workbench in a CSS-expanded state while opportunistically using the
 * browser fullscreen API. The runtime objects are injectable so the hook can
 * be exercised without a browser.
 */
export function useWorkbenchFullscreen(React, elementRef, options = {}) {
  const [expanded, setExpanded] = React.useState(false)
  const activeRef = React.useRef(false)
  const nativeTargetRef = React.useRef(null)
  const mountedRef = React.useRef(false)
  const operationRef = React.useRef(0)
  const pendingRequestRef = React.useRef(null)
  const ownedExitRef = React.useRef(null)
  const targetRef = React.useRef(null)
  const documentRef = React.useRef(null)
  const windowRef = React.useRef(null)

  if (elementRef?.current) targetRef.current = elementRef.current
  documentRef.current = resolveRuntimeDocument(options)
  windowRef.current = resolveRuntimeWindow(options)

  const readTarget = () => {
    const target = elementRef?.current || null
    if (target) targetRef.current = target
    return target
  }

  const setActive = React.useCallback((next) => {
    const value = Boolean(next)
    activeRef.current = value
    if (mountedRef.current) setExpanded(value)
  }, [setExpanded])

  const enter = React.useCallback(async () => {
    const operation = ++operationRef.current
    ownedExitRef.current = null
    const target = readTarget()
    const runtimeDocument = documentRef.current

    // Mark the CSS fallback synchronously so a user gesture is not lost while
    // requestFullscreen waits for the browser's permission/gesture handling.
    setActive(true)

    if (!target || typeof target.requestFullscreen !== 'function') return true

    const requestRecord = {
      operation,
      target,
      cancelled: false,
      exitRequested: false,
    }
    pendingRequestRef.current = requestRecord

    let request
    try {
      request = target.requestFullscreen()
    } catch {
      if (pendingRequestRef.current === requestRecord) pendingRequestRef.current = null
      return true
    }

    try {
      await request
    } catch {
      // A rejected native request leaves the CSS viewport-max fallback active.
      if (pendingRequestRef.current === requestRecord) pendingRequestRef.current = null
      return true
    }

    const stillPending = pendingRequestRef.current === requestRecord
    if (stillPending) pendingRequestRef.current = null
    if (!mountedRef.current || operationRef.current !== operation) {
      if (stillPending && requestRecord.cancelled) {
        safelyExitNative(runtimeDocument, target, requestRecord)
      }
      return false
    }
    if (nativeFullscreenElement(runtimeDocument, target) === target) {
      nativeTargetRef.current = target
    }
    return true
  }, [elementRef, setActive])

  const exit = React.useCallback(async () => {
    const operation = ++operationRef.current
    const pendingRequest = pendingRequestRef.current
    if (pendingRequest) pendingRequest.cancelled = true
    const target = readTarget()
    const runtimeDocument = documentRef.current
    const current = nativeFullscreenElement(runtimeDocument, target)
    const ownsFullscreen = Boolean(
      target && (current === target || containsNode(target, current)),
    )

    const exitRecord = ownsFullscreen ? { operation, target } : null
    ownedExitRef.current = exitRecord

    setActive(false)
    nativeTargetRef.current = null

    if (!ownsFullscreen || !nativeExitMethod(runtimeDocument)) {
      if (ownedExitRef.current === exitRecord) ownedExitRef.current = null
      return false
    }

    let exited = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (operationRef.current !== operation || ownedExitRef.current !== exitRecord) break

      const fullscreenElement = nativeFullscreenElement(runtimeDocument, target)
      const stillOwned = fullscreenElement === target || containsNode(target, fullscreenElement)
      if (!stillOwned || !nativeExitMethod(runtimeDocument)) break

      if (pendingRequest) pendingRequest.exitRequested = true
      let request
      try {
        request = nativeExitMethod(runtimeDocument)()
      } catch {
        break
      }
      try { await request } catch { break }
      exited = true

      // A browser may pop a nested child to its parent workbench in one call.
      // Re-check and drain again, but stop when the API is stuck at one level.
      if (nativeFullscreenElement(runtimeDocument, target) === fullscreenElement) break
    }

    if (ownedExitRef.current === exitRecord) {
      ownedExitRef.current = null
      if (operationRef.current === operation) setActive(false)
    }
    return exited
  }, [elementRef, setActive])

  const toggle = React.useCallback(() => (
    activeRef.current ? exit() : enter()
  ), [enter, exit])

  const isExpanded = React.useCallback(() => activeRef.current, [])

  React.useEffect(() => {
    const runtimeDocument = documentRef.current
    const runtimeWindow = windowRef.current
    const eventTarget = runtimeDocument && typeof runtimeDocument.addEventListener === 'function'
      ? runtimeDocument
      : runtimeWindow && typeof runtimeWindow.addEventListener === 'function'
        ? runtimeWindow
        : null

    const onFullscreenChange = () => {
      const target = readTarget()
      const current = nativeFullscreenElement(runtimeDocument, target)
      if (!target) return

      if (current === target) {
        const ownedExit = ownedExitRef.current
        if (ownedExit?.target === target && ownedExit.operation === operationRef.current) {
          nativeTargetRef.current = null
          setActive(false)
          return
        }
        const pendingRequest = pendingRequestRef.current
        if (pendingRequest?.target === target && pendingRequest.cancelled) {
          nativeTargetRef.current = null
          setActive(false)
          safelyExitNative(runtimeDocument, target, pendingRequest)
          return
        }
        nativeTargetRef.current = target
        setActive(true)
        return
      }

      // A nested SessionMap or shot overlay owns its own fullscreen session.
      // It must not activate the outer workbench, and it must not deactivate an
      // already-active fallback/native workbench while the child is open.
      if (containsNode(target, current)) return

      if (nativeTargetRef.current === target) {
        nativeTargetRef.current = null
        setActive(false)
      }
    }

    const onKeyDown = (event) => {
      if (event?.key !== 'Escape' || !activeRef.current) return

      const target = readTarget()
      const current = nativeFullscreenElement(runtimeDocument, target)
      if (containsNode(target, current)) return

      const nestedOverlay = typeof target?.querySelector === 'function'
        && target.querySelector(
          '.rt-session-map-expanded,.rt-shot-zoom,.dshp-modal-bg,.dshp-restart-mask,.dshp-auth-mask,.rt-modal,[role="dialog"][aria-modal="true"]',
        )
      if (nestedOverlay) return

      event.preventDefault?.()
      event.stopPropagation?.()
      void exit()
    }

    mountedRef.current = true
    eventTarget?.addEventListener('fullscreenchange', onFullscreenChange)
    eventTarget?.addEventListener('keydown', onKeyDown)
    onFullscreenChange()

    return () => {
      mountedRef.current = false
      ++operationRef.current
      const pendingRequest = pendingRequestRef.current
      if (pendingRequest) pendingRequest.cancelled = true
      eventTarget?.removeEventListener('fullscreenchange', onFullscreenChange)
      eventTarget?.removeEventListener('keydown', onKeyDown)

      const target = elementRef?.current || targetRef.current
      const current = nativeFullscreenElement(runtimeDocument, target)
      const ownsFullscreen = Boolean(
        target
          && (
            nativeTargetRef.current === target
              || pendingRequest?.target === target
          )
          && (current === target || containsNode(target, current)),
      )
      nativeTargetRef.current = null
      activeRef.current = false

      if (ownsFullscreen) safelyExitNative(runtimeDocument, target, pendingRequest)
    }
  }, [elementRef, exit, setActive])

  return { expanded, enter, exit, toggle, isExpanded }
}
