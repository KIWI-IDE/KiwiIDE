/** Showing a ready window must never await JDK probes, Gradle or indexing. */
function revealStartupWindow({ window, splash, startedAt, minimumMs = 0, background, schedule = setTimeout, now = Date.now }) {
  const reveal = () => {
    if (window.isDestroyed()) return;
    window.show();
    if (splash && !splash.isDestroyed()) splash.destroy();
    schedule(() => { if (!window.isDestroyed()) void Promise.resolve().then(background).catch(() => undefined); }, 0);
  };
  const remaining = Math.max(0, minimumMs - (now() - startedAt));
  if (remaining) return schedule(reveal, remaining);
  reveal();
  return null;
}
module.exports = { revealStartupWindow };
