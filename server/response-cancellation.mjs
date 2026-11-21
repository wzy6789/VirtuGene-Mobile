/** Non-streaming provider calls remain owned by the client response until the
 * complete provider body is read. No model inputs or authorization change. */
export function responseCancellation(res, timeoutMs) {
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError'));
  };
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  res.once('close', cancel);
  if (res.destroyed) cancel();
  return { signal: controller.signal, cleanup() { clearTimeout(timer); res.removeListener('close', cancel); } };
}
