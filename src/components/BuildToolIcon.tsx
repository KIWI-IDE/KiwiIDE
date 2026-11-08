/**
 * The build tool's own mark, drawn rather than fetched.
 *
 * Gradle's elephant and Maven's feather are what somebody looks for in a rail
 * of near-identical grey glyphs, and a hammer said only "something builds
 * here". Both are traced by hand: no network, no binary asset, and they take
 * the surrounding colour like every other icon in the rail.
 *
 * Drawn front-on with the ears outside the head, because that is the shape
 * that still reads as an elephant at 21 px — a head and trunk alone looked
 * like a mushroom, and a side view lost the trunk entirely.
 */
export function GradleIcon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M7.6 7.2C5.3 5.6 2.6 6 2.1 8.6c-.5 2.6.9 5.2 3.2 6.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16.4 7.2c2.3-1.6 5-1.2 5.5 1.4.5 2.6-.9 5.2-3.2 6.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Head and trunk in one outline, so the trunk narrows out of the head
          instead of being a line stuck onto it. */}
      <path
        d="M12 3.9c2.6 0 4.4 2.1 4.4 5v3.4c0 1.4-.6 2.5-1.6 3.1v3.4a2.8 2.8 0 0 1-5.6 0v-3.4c-1-.6-1.6-1.7-1.6-3.1V8.9c0-2.9 1.8-5 4.4-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10.1" cy="9.6" r=".9" fill="currentColor" />
      <circle cx="13.9" cy="9.6" r=".9" fill="currentColor" />
    </svg>
  );
}

export function MavenIcon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {/* The quill: a nib below, the vane above it, and barbs off the rachis —
          without those it reads as a leaf rather than a feather. */}
      <path d="M5 20l4.2-4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M9.2 15.8c-2-3.6-1.4-8.2 1.8-11 2.6-2.3 6-3.1 9.1-2.6.5 3.2-.4 6.6-2.9 8.9-3 2.7-7.4 3.3-11 .8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M19 3.2 9.6 12.6M13.2 5.4l1.2 3.3M10.9 8.3l1.3 3.3M16.4 4l.9 2.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity=".7"
      />
    </svg>
  );
}

/** Whichever mark belongs to the project that is open. */
export function BuildToolIcon({ type, size = 21 }: { type: string; size?: number }) {
  if (type === "Maven") return <MavenIcon size={size} />;
  return <GradleIcon size={size} />;
}
