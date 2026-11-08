import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = process.cwd();
const source = path.join(root, "assets", "branding", "kiwi-logo-mark.png");
const output = path.join(root, "assets", "icons");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

await fs.mkdir(output, { recursive: true });
const pngs = [];
for (const size of sizes) {
  const target = path.join(output, `kiwi-${size}.png`);
  await sharp(source)
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(target);
  if ([16, 24, 32, 48, 64, 128, 256].includes(size)) pngs.push(target);
}

await fs.writeFile(path.join(output, "kiwi.ico"), await pngToIco(pngs));
console.log(`Generated Kiwi icon set (${sizes.join(", ")}px).`);
