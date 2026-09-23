// ── Lab PDF storage (SERVER ONLY) ────────────────────────────────────────────
//
// Uploaded lab PDFs are stored CONTENT-ADDRESSED: the file is named after the
// SHA-256 of its own bytes, so the same document uploaded twice occupies one
// file and a re-parse reads exactly the bytes the hash names.
//
// The path is derived from the hash, never from the uploaded filename: a
// filename is attacker-controlled and must never reach the filesystem. Only
// `[a-f0-9]{64}.pdf` is ever constructed or read.

import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;

/** The path a content hash is stored at. Throws on a malformed hash. */
export function storedPath(dir: string, sha256: string): string {
  const hash = sha256.trim().toLowerCase();
  if (!SHA256.test(hash)) throw new Error('A stored file path requires a 64-character lowercase hex SHA-256.');
  return join(dir, `${hash}.pdf`);
}

/** Write the bytes at their content address, creating the directory. Returns the path. */
export async function storeBytes(dir: string, sha256: string, bytes: Uint8Array): Promise<string> {
  const path = storedPath(dir, sha256);
  await mkdir(dir, { recursive: true });
  await writeFile(path, bytes);
  return path;
}

/** The stored bytes, or null when the file is not there. */
export async function readStoredBytes(dir: string, sha256: string): Promise<Uint8Array | null> {
  try {
    const buffer = await readFile(storedPath(dir, sha256));
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/** True when the content address is already on disk. */
export async function storedFileExists(dir: string, sha256: string): Promise<boolean> {
  try {
    await stat(storedPath(dir, sha256));
    return true;
  } catch {
    return false;
  }
}

/** Delete a stored file. Missing is not an error. Returns true when one was removed. */
export async function deleteStoredBytes(dir: string, sha256: string): Promise<boolean> {
  try {
    await unlink(storedPath(dir, sha256));
    return true;
  } catch {
    return false;
  }
}