const fs = require("node:fs");
const path = require("node:path");

const normalizeAccent = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : "#88c0d0";
const luminance = (r, g, b) => .3 * r + .59 * g + .11 * b;

/** SVG's color blend: keep the mark's shading, transparency and silhouette. */
function tintBitmap(bitmap, accent) {
  accent = normalizeAccent(accent);
  const channels = [1, 3, 5].map(offset => parseInt(accent.slice(offset, offset + 2), 16));
  const colorLight = luminance(...channels);
  const result = Buffer.from(bitmap);
  // NativeImage uses Chromium's premultiplied N32 (BGRA on supported CPUs).
  for (let index = 0; index < bitmap.length; index += 4) {
    const alpha = bitmap[index + 3];
    if (!alpha) continue;
    const light = luminance(bitmap[index + 2], bitmap[index + 1], bitmap[index]) * 255 / alpha;
    let rgb = channels.map(channel => channel + light - colorLight);
    const low = Math.min(...rgb);
    if (low < 0) rgb = rgb.map(channel => light + (channel - light) * light / (light - low));
    const high = Math.max(...rgb);
    if (high > 255) rgb = rgb.map(channel => light + (channel - light) * (255 - light) / (high - light));
    for (let channel = 0; channel < 3; channel++) result[index + 2 - channel] = Math.round(Math.max(0, Math.min(255, rgb[channel])) * alpha / 255);
  }
  return result;
}

function pngToIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  // Zero width/height denotes a 256px PNG image in an ICO directory.
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

class ApplicationIconService {
  constructor(nativeImage, app, BrowserWindow, source, iconDirectory, platform = process.platform) {
    Object.assign(this, { nativeImage, app, BrowserWindow, source, iconDirectory, platform });
    this.cache = new Map(); this.applied = new Map(); this.accent = "";
  }
  get(accent) {
    accent = normalizeAccent(accent);
    if (this.cache.has(accent)) return this.cache.get(accent);
    this.original ||= this.nativeImage.createFromPath(this.source);
    if (this.original.isEmpty()) return null;
    const size = this.original.getSize();
    const image = this.nativeImage.createFromBitmap(tintBitmap(this.original.toBitmap(), accent), size);
    if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(accent, image);
    return image;
  }
  apply(accent) {
    accent = normalizeAccent(accent);
    const image = this.get(accent);
    if (!image || image.isEmpty()) return;
    this.accent = accent;
    let appIconPath = "";
    if (this.platform === "win32") {
      try {
        fs.mkdirSync(this.iconDirectory, { recursive: true });
        appIconPath = path.join(this.iconDirectory, `kiwi-${accent.slice(1)}.ico`);
        if (!fs.existsSync(appIconPath)) fs.writeFileSync(appIconPath, pngToIco(image.resize({ width: 256, height: 256 }).toPNG()));
      } catch (error) { console.error("[Icon]", error.message); }
    }
    for (const window of this.BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      try {
        if (this.platform !== "darwin") window.setIcon(image);
        if (appIconPath) window.setAppDetails({ appIconPath, appIconIndex: 0 });
        if (!this.applied.has(window.id)) window.once("closed", () => this.applied.delete(window.id));
        this.applied.set(window.id, accent);
      } catch (error) { console.error("[Icon]", error.message); }
    }
    if (this.platform === "darwin") this.app.dock?.setIcon(image);
  }
}
module.exports = { ApplicationIconService, tintBitmap, normalizeAccent, pngToIco };
