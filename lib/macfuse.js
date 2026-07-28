const MACFUSE_URL = 'https://macfuse.github.io/'

function wrapMacFuseLoadError (err) {
  const message = err && err.message ? err.message : String(err)
  if (!/(?:macfuse|libfuse(?:\.\d+)*\.dylib)/i.test(message)) return err

  const wrapped = new Error(
    'fuse-napi requires macFUSE with its libfuse 2 compatibility library. ' +
    `Install and enable macFUSE from ${MACFUSE_URL}, then restart macOS if requested. ` +
    `Original error: ${message}`
  )
  wrapped.code = 'EMACFUSEDEPENDENCY'
  wrapped.cause = err
  return wrapped
}

module.exports = {
  MACFUSE_URL,
  wrapMacFuseLoadError
}
