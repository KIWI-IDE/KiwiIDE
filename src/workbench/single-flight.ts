export type SingleFlightState<T> = { current: Promise<T> | null };

/**
 * Starts an action unless the same UI boundary already has one in flight.
 * Concurrent callers share the pending result; a later call may start again
 * after either success or failure.
 */
export function runSingleFlight<T>(
  state: SingleFlightState<T>,
  action: () => T | PromiseLike<T>,
): Promise<T> {
  if (state.current) return state.current;

  const pending = Promise.resolve().then(action);
  state.current = pending;

  const clear = () => {
    if (state.current === pending) state.current = null;
  };
  void pending.then(clear, clear);
  return pending;
}
