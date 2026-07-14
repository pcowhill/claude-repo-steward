/** Content hashing for the simulator's blob store (FNV-1a, hex). Collisions
 * across a few dozen fixture files are not a realistic concern; hashes are
 * salted with length to be extra safe. */
export function contentHash(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const a = (h >>> 0).toString(16).padStart(8, '0');
  // Second pass with a different seed for a wider key.
  let g = 0x1b873593;
  for (let i = content.length - 1; i >= 0; i--) {
    g ^= content.charCodeAt(i);
    g = Math.imul(g, 0x85ebca6b);
  }
  const b = (g >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}-${content.length}`;
}

/** Store content in the blob map, returning its hash. */
export function putBlob(blobs: Record<string, string>, content: string): string {
  const hash = contentHash(content);
  if (!(hash in blobs)) blobs[hash] = content;
  return hash;
}
