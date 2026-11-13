export function circuitBreakerFetch({ fetcher = fetch, timeoutMs = 10000, resetMs = 15000, threshold = 3, now = Date.now, name = 'subgraph' } = {}) {
  let failures = 0, openUntil = 0, probing = false;
  return async (url, init) => {
    if (openUntil > now() || probing) throw new Error(`Сервис ${name} временно недоступен (circuit breaker)`);
    const probe = openUntil > 0;
    if (probe) probing = true;
    try {
      const result = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (result.status >= 500) { await result.body?.cancel(); throw new Error(`Сервис ${name}: HTTP ${result.status}`); }
      // A successful request started before the circuit opened must not close it.
      if (probe || openUntil === 0) { failures = 0; openUntil = 0; }
      return result;
    } catch (error) {
      if (probe || ++failures >= threshold) openUntil = now() + resetMs;
      throw error;
    } finally { if (probe) probing = false; }
  };
}
