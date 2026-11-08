/**
 * The pictures the Windows installer shows.
 *
 * NSIS takes bitmaps and nothing else — no PNG, no alpha — at two fixed sizes
 * that have not changed since the nineties: 150×57 for the strip along the top
 * of every page and 164×314 for the panel beside the welcome and finish pages.
 *
 * Both are the splash screen, cut to those sizes. The same artwork, the same
 * stacked wordmark, the same green rule underneath — because the installer is
 * the first thing anybody sees of Kiwi, and it should be the thing that opens
 * afterwards. The shapes are not copied here: they come from the file the
 * splash itself draws them from, and are rebuilt at these sizes rather than
 * exported by hand, so a change to the artwork reaches the installer whether
 * or not anybody remembers it exists.
 *
 * The header sits on the installer's own white bar and is drawn light to match
 * it; the side panel is the one surface that is entirely ours.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import brandArtwork from "../electron/services/brand-artwork.cjs";

// The three shapes and the geometry that turns them into a path, from the file
// the splash draws them from. Both used to be a second copy sitting here.
const { ARTWORK_SHAPES, ARTWORK_GROUND, blobPath, gradientLine, shapeBox } = brandArtwork;

const root = process.cwd();
// `npm run icons` rasterises the icon set immediately before this script, and
// the small sizes in it are drawn for small placements. Downsampling the
// 512-pixel master to twenty-odd pixels here would throw that work away.
const icons = path.join(root, "assets", "icons");
const output = path.join(root, "assets", "installer");
const version = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;

/** The splash screen's palette, name for name. */
const INK = { r: 6, g: 16, b: 15 };
const GROUND = "#06100f";
const TEXT = "#e8f0f2";
const GREEN = "#8fd96a";
const MUTED = "#6d8781";
const HEADER_GROUND = "#ffffff";
const HEADER_INK = "#0e1c22";

/** The rule that runs under every crest in the application. */
const RULE = [
  { at: 0, colour: "#3f9e2a" },
  { at: 60, colour: "#71cc3e" },
  { at: 100, colour: "#d6f36e" },
];

/**
 * A 24-bit bitmap, written by hand because sharp cannot.
 *
 * Bottom-up rows and BGR channel order are what the format asks for, and every
 * row is padded to a multiple of four bytes. Getting either wrong produces a
 * file that opens fine in a viewer and renders as noise in NSIS.
 */
function encodeBitmap(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = rowSize * height;
  const file = Buffer.alloc(54 + pixels, 0);
  file.write("BM", 0, "ascii");
  file.writeUInt32LE(54 + pixels, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(pixels, 34);
  file.writeInt32LE(2835, 38);
  file.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const from = (height - 1 - y) * width * 3;
    const to = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      file[to + x * 3] = rgb[from + x * 3 + 2];
      file[to + x * 3 + 1] = rgb[from + x * 3 + 1];
      file[to + x * 3 + 2] = rgb[from + x * 3];
    }
  }
  return file;
}

async function writeBitmap(image, width, height, target) {
  const rgb = await image.removeAlpha().raw().toBuffer();
  await fs.writeFile(target, encodeBitmap(rgb, width, height));
  return target;
}

/** The splash's artwork, drawn into a frame of the given size and clipped to it. */
export function artwork(width, height, id) {
  const shapes = [];
  const gradients = [];
  ARTWORK_SHAPES.forEach((shape, index) => {
    const box = shapeBox(shape, width, height);
    const line = gradientLine(shape.angle, box.x, box.y, box.width, box.height);
    const name = `${id}-blob-${index}`;
    gradients.push(`<linearGradient id="${name}" gradientUnits="userSpaceOnUse"
      x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}">
      ${shape.stops.map(([at, colour]) => `<stop offset="${at / 100}" stop-color="${colour}"/>`).join("")}
    </linearGradient>`);
    shapes.push(`<path d="${blobPath(box.x, box.y, box.width, box.height, shape.radius)}"
      fill="url(#${name})" opacity="${shape.opacity}"/>`);
  });
  return { gradients: gradients.join(""), shapes: shapes.join("") };
}

/** The rule that runs under every crest, as a gradient definition and a bar. */
function ruleGradient(id) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
    ${RULE.map((stop) => `<stop offset="${stop.at / 100}" stop-color="${stop.colour}"/>`).join("")}
  </linearGradient>`;
}

async function rasterise(svg, width, height) {
  return sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
}

/**
 * The strip along the top of every installer page.
 *
 * NSIS puts this at the right-hand end of a bar it paints white itself, so the
 * panel's dark ground would read as a rectangle stuck onto the dialog. What
 * carries over instead is the lockup and the rule under it: the name light,
 * the category solid, the green line beneath — the crest, on white.
 */
async function buildHeader() {
  const width = 150;
  const height = 57;
  const markSize = 30;
  const wordsRight = width - 12;
  const markLeft = 20;

  const face = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>${ruleGradient("header-rule")}</defs>
    <rect width="${width}" height="${height}" fill="${HEADER_GROUND}"/>
    <text x="${wordsRight}" y="34" text-anchor="end"
      font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="300" fill="${HEADER_INK}">Kiwi<tspan
      dx="3" font-weight="600">IDE</tspan></text>
    <rect x="${wordsRight - 78}" y="41" width="78" height="2" fill="url(#header-rule)"/>
  </svg>`;

  const mark = await sharp(path.join(icons, "kiwi-32.png"))
    .resize({ width: markSize, height: markSize, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const image = sharp(await rasterise(face, width, height))
    .composite([{ input: mark, left: markLeft, top: Math.round((height - markSize) / 2) - 3 }])
    .flatten({ background: { r: 255, g: 255, b: 255 } });
  return writeBitmap(image, width, height, path.join(output, "header.bmp"));
}

/**
 * The panel beside the welcome and finish pages.
 *
 * The splash turned on its side: artwork across the head, cut off at a hard
 * edge with the green rule along it, then the name stacked underneath — light,
 * solid, and the version in green — with the maker's line and the caption at
 * the foot. The wordmark asset is dark on one half and would disappear against
 * this ground, so the words are set here instead of pasted in.
 */
async function buildSidebar(name, caption) {
  const width = 164;
  const height = 314;
  const pad = 16;
  // The splash gives the artwork 37% of its width. Handing this panel the same
  // 37% of its height was measurably wrong: at 164×118 the three shapes are so
  // much wider than they are tall that they flatten into stripes. Half the
  // panel is what lets the same picture read as the same picture.
  const artHeight = 156;
  const markSize = 22;
  const markTop = 264;
  const art = artwork(width, artHeight, "side");

  const face = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      ${art.gradients}
      ${ruleGradient("side-rule")}
      <clipPath id="side-frame"><rect width="${width}" height="${artHeight}"/></clipPath>
    </defs>
    <rect width="${width}" height="${height}" fill="${GROUND}"/>
    <g clip-path="url(#side-frame)">
      <rect width="${width}" height="${artHeight}" fill="${ARTWORK_GROUND}"/>
      ${art.shapes}
    </g>
    <rect x="0" y="${artHeight}" width="${width}" height="2" fill="url(#side-rule)"/>
    <text x="${pad}" y="192" font-family="Segoe UI, Arial, sans-serif"
      font-size="30" font-weight="300" letter-spacing="-.5" fill="${TEXT}">Kiwi</text>
    <text x="${pad}" y="224" font-family="Segoe UI, Arial, sans-serif"
      font-size="30" font-weight="600" letter-spacing="-.5" fill="${TEXT}">IDE</text>
    <text x="${pad}" y="246" font-family="Segoe UI, Arial, sans-serif"
      font-size="18" font-weight="300" fill="${GREEN}">${version}</text>
    <text x="${pad + markSize + 8}" y="${markTop + 14}" font-family="Segoe UI, Arial, sans-serif"
      font-size="10" font-weight="700" letter-spacing="1.1" fill="${TEXT}">KIWI <tspan
      fill="${GREEN}" letter-spacing="0">IDEs</tspan></text>
    <text x="${pad}" y="300" font-family="Segoe UI, Arial, sans-serif"
      font-size="10" fill="${MUTED}">${caption}</text>
  </svg>`;

  const mark = await sharp(path.join(icons, "kiwi-32.png"))
    .resize({ width: markSize, height: markSize, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const image = sharp(await rasterise(face, width, height))
    .composite([{ input: mark, left: pad, top: markTop }])
    .flatten({ background: INK });
  return writeBitmap(image, width, height, path.join(output, name));
}

await fs.mkdir(output, { recursive: true });
const written = [
  await buildHeader(),
  await buildSidebar("sidebar.bmp", "Java-Entwicklung, lokal"),
  await buildSidebar("uninstaller-sidebar.bmp", "Deinstallation"),
];
for (const file of written) {
  const { size } = await fs.stat(file);
  console.log(`Installer-Grafik: ${path.relative(root, file)} (${Math.round(size / 1024)} KiB)`);
}
