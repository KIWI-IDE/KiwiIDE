/**
 * Kiwi's artwork, written down once.
 *
 * Three shapes, each far larger than the frame that clips them, drifting off
 * several edges at once. They are on the splash screen, behind the Project Hub,
 * and on the panel beside the Windows installer's pages — and until this file
 * they were three separate copies of the same numbers: CSS in the splash, CSS
 * again in the stylesheet, and a table of literals in the installer script. A
 * comment in that script claimed the two could not drift apart. They could;
 * nothing tied them together.
 *
 * The splash and the installer now both read from here. The stylesheet's copy
 * stays hand-written -- it is static CSS with no build step of its own -- but a
 * test measures it against these numbers, so it can no longer drift quietly.
 *
 * `inset` is CSS's own order, top right bottom left, and the percentages
 * resolve the way CSS resolves them: the vertical pair against the height of
 * the frame, the horizontal pair against its width. The eight border radii are
 * what turn a rectangle into a blob: each pair along an edge adds up to exactly
 * 100%, so the four corner arcs meet at the middle of every edge and no
 * straight side is left.
 */

/** What two of the three shapes are rounded with. */
const ROUNDED = { horizontal: [46, 54, 38, 62], vertical: [55, 42, 58, 45] };

const ARTWORK_SHAPES = [
  {
    name: "one",
    inset: [-52, -90, 34, -60],
    radius: ROUNDED,
    angle: 158,
    stops: [[0, "#f2fa7a"], [40, "#86e455"], [100, "#23bd77"]],
    opacity: 1,
    drift: { seconds: 15, reverse: false },
  },
  {
    name: "two",
    inset: [26, -104, -54, -22],
    radius: ROUNDED,
    angle: 196,
    stops: [[0, "#37cf8a"], [52, "#12967f"], [100, "#0a4a68"]],
    opacity: 1,
    drift: { seconds: 19, reverse: true },
  },
  {
    name: "three",
    inset: [58, -46, -62, -70],
    radius: { horizontal: [58, 42, 62, 38], vertical: [42, 58, 40, 60] },
    angle: 20,
    stops: [[0, "#0b3f5c"], [70, "#1d7f86"], [100, "#3fbf8e"]],
    opacity: 0.9,
    drift: { seconds: 24, reverse: false },
  },
];

/** The ground the shapes are laid on, and the drift they are given. */
const ARTWORK_GROUND = "#071a24";
const ARTWORK_DRIFT = "50% { transform: rotate(7deg) scale(1.08); }";

/** `46% 54% 38% 62% / 55% 42% 58% 45%`, from the pair of quadruples. */
function radiusRule(radius) {
  const share = (values) => values.map((value) => `${value}%`).join(" ");
  return `${share(radius.horizontal)} / ${share(radius.vertical)}`;
}

/** `linear-gradient(158deg, #f2fa7a 0%, #86e455 40%, #23bd77 100%)`. */
function gradientRule(shape) {
  const stops = shape.stops.map(([at, colour]) => `${colour} ${at}%`).join(", ");
  return `linear-gradient(${shape.angle}deg, ${stops})`;
}

/**
 * The rules that draw the artwork inside `scope`.
 *
 * `drift` names the keyframes to animate with, because the splash and the
 * stylesheet cannot share one name: the splash is a document of its own.
 */
function artworkCss(scope, drift) {
  const lines = [
    `${scope} i {`,
    "  position: absolute; display: block;",
    `  border-radius: ${radiusRule(ROUNDED)};`,
    "}",
  ];
  for (const shape of ARTWORK_SHAPES) {
    const rules = [
      `  inset: ${shape.inset.map((value) => `${value}%`).join(" ")};`,
    ];
    if (shape.radius !== ROUNDED) rules.push(`  border-radius: ${radiusRule(shape.radius)};`);
    rules.push(`  background: ${gradientRule(shape)};`);
    if (shape.opacity !== 1) rules.push(`  opacity: ${String(shape.opacity).replace(/^0/, "")};`);
    rules.push(`  animation: ${drift} ${shape.drift.seconds}s ease-in-out infinite${shape.drift.reverse ? " reverse" : ""};`);
    lines.push(`${scope} .${shape.name} {`, ...rules, "}");
  }
  return lines.join("\n");
}

/** `<i class="one"></i>…`, in the order the shapes are stacked. */
function artworkMarkup() {
  return ARTWORK_SHAPES.map((shape) => `<i class="${shape.name}"></i>`).join("");
}

/**
 * The radii a browser actually draws, in pixels.
 *
 * Two of the three shapes have pairs that add up to exactly 100% along every
 * edge, so their corner arcs meet in the middle of each side and no straight
 * piece is left. The third does not -- 42 + 60 down the left is 102 -- and CSS
 * has a rule for that: work out, for each edge, how much of it the two radii
 * are asking for, and if any edge is over-subscribed shrink *every* radius by
 * the worst of those ratios. Skipping this is why the installer's third shape
 * was not quite the splash's third shape.
 */
function scaledRadii(width, height, radius) {
  const horizontal = radius.horizontal.map((share) => (share / 100) * width);
  const vertical = radius.vertical.map((share) => (share / 100) * height);
  const [tlx, trx, brx, blx] = horizontal;
  const [tly, trY, bry, bly] = vertical;
  const ratios = [
    width / (tlx + trx),
    height / (trY + bry),
    width / (brx + blx),
    height / (tly + bly),
  ].filter((ratio) => Number.isFinite(ratio));
  const factor = Math.min(1, ...ratios);
  return {
    horizontal: horizontal.map((value) => value * factor),
    vertical: vertical.map((value) => value * factor),
    factor,
  };
}

/**
 * The shape a CSS border-radius makes, as an SVG path.
 *
 * Four corner arcs with whatever is left of each side drawn straight between
 * them. Where the radii meet exactly those straight runs are zero length and
 * the rectangle disappears entirely into a blob, which is what two of the three
 * shapes do; the third keeps a two-percent flat down one side, and it has to
 * keep it here too or the two renderings are different pictures.
 */
function blobPath(x, y, width, height, radius) {
  const { horizontal, vertical } = scaledRadii(width, height, radius);
  const [tlx, trx, brx, blx] = horizontal;
  const [tly, trY, bry, bly] = vertical;
  const round = (value) => Number(value.toFixed(3));
  return [
    `M ${round(x)} ${round(y + tly)}`,
    `A ${round(tlx)} ${round(tly)} 0 0 1 ${round(x + tlx)} ${round(y)}`,
    `L ${round(x + width - trx)} ${round(y)}`,
    `A ${round(trx)} ${round(trY)} 0 0 1 ${round(x + width)} ${round(y + trY)}`,
    `L ${round(x + width)} ${round(y + height - bry)}`,
    `A ${round(brx)} ${round(bry)} 0 0 1 ${round(x + width - brx)} ${round(y + height)}`,
    `L ${round(x + blx)} ${round(y + height)}`,
    `A ${round(blx)} ${round(bly)} 0 0 1 ${round(x)} ${round(y + height - bly)}`,
    "Z",
  ].join(" ");
}

/**
 * Where a CSS gradient at a given angle starts and ends.
 *
 * Zero degrees points up and the angle turns clockwise, which is neither what
 * SVG assumes nor what trigonometry assumes. The line runs through the centre
 * and is long enough that the corners fall inside it.
 */
function gradientLine(angle, x, y, width, height) {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = x + width / 2;
  const cy = y + height / 2;
  return {
    x1: cx - (dx * length) / 2,
    y1: cy - (dy * length) / 2,
    x2: cx + (dx * length) / 2,
    y2: cy + (dy * length) / 2,
  };
}

/** Where one shape's box sits, given the frame that clips it. */
function shapeBox(shape, width, height) {
  const [top, right, bottom, left] = shape.inset;
  const x = (left / 100) * width;
  const y = (top / 100) * height;
  return {
    x,
    y,
    width: width - (right / 100) * width - x,
    height: height - (bottom / 100) * height - y,
  };
}

module.exports = {
  ARTWORK_SHAPES,
  ARTWORK_GROUND,
  ARTWORK_DRIFT,
  artworkCss,
  artworkMarkup,
  blobPath,
  gradientLine,
  gradientRule,
  radiusRule,
  scaledRadii,
  shapeBox,
};
