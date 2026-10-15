function object(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { throw new Error('MEDIA_MODEL_INVALID_CONFIG') }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function resolveMediaModel(redis, type, { decrypt = value => value, modelId } = {}) {
  if (!['IMAGE_GENERATION', 'TTS'].includes(type)) throw new Error('MEDIA_MODEL_INVALID_TYPE')
  let raw
  if (modelId) {
    const data = await redis.hget('byai:aimodel:config', modelId)
    if (data) raw = object(data)
  } else {
    const data = await redis.hget('byai:aimodel:typelist', type)
    let values
    try { values = data ? JSON.parse(data) : [] } catch { throw new Error('MEDIA_MODEL_INVALID_CONFIG') }
    if (!Array.isArray(values)) throw new Error('MEDIA_MODEL_INVALID_CONFIG')
    const candidates = values.filter(value => String(value.modelType).toUpperCase() === type && Number(value.isDefault) === 1)
    if (candidates.length > 1) throw new Error('MEDIA_MODEL_AMBIGUOUS_DEFAULT')
    raw = candidates[0]
  }
  if (!raw) throw new Error(`MEDIA_MODEL_NOT_CONFIGURED: ${type}`)
  if (String(raw.modelType).toUpperCase() !== type || Number(raw.status) !== 1) throw new Error(`MEDIA_MODEL_UNAVAILABLE: ${type}`)
  const params = object(raw.instanceParam)
  const provider = String(params.providerName ?? raw.providerName ?? '').trim()
  const protocol = String(params.modelProtocol ?? raw.modelProtocol ?? '').trim()
  const model = String(raw.modelCode ?? '').trim()
  const endpoint = String(raw.url ?? '').trim()
  if (!provider || !protocol || !model || !endpoint) throw new Error('MEDIA_MODEL_INCOMPLETE')
  const headers = {}
  const configuredHeaders = params.headers ?? []
  if (Array.isArray(configuredHeaders)) {
    for (const header of configuredHeaders) {
      const key = header.key ?? header.name
      if (typeof key === 'string' && key.trim() && typeof header.value === 'string') headers[key.trim()] = decrypt(header.value)
    }
  } else for (const [key, value] of Object.entries(object(configuredHeaders))) if (typeof value === 'string') headers[key] = decrypt(value)
  const seconds = Number(params.readTimeoutSec ?? 180)
  return {
    id: String(raw.instanceId ?? modelId ?? ''), provider, protocol, model, endpoint,
    apiKey: decrypt(String(raw.authToken ?? '')), headers,
    options: object(params.extendParam ?? {}), timeoutMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 600000) : 180000,
  }
}
