/** Addresses documentation may open in the system's registered handler. */
function assertExternalLinkUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Der externe Link ist ungültig.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Der externe Link ist ungültig.");
  }
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
    throw new Error("Externe Links müssen HTTP, HTTPS oder mailto verwenden.");
  }
  if (url.username || url.password) {
    throw new Error("Externe Links dürfen keine Zugangsdaten enthalten.");
  }
  return url.toString();
}

module.exports = { assertExternalLinkUrl };
