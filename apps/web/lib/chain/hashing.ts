import { keccak256, toBytes } from "viem";
import stableStringify from "fast-json-stable-stringify";

/**
 * Canonical JSON hash using fast-json-stable-stringify + viem keccak256.
 * Both the API and the worker must use this function so hashes match.
 */
export function canonicalHash(obj: unknown): `0x${string}` {
  const json = stableStringify(obj as object);
  return keccak256(toBytes(json));
}

/** Keccak-256 hash of raw UTF-8 source text. */
export function sourceHash(source: string): `0x${string}` {
  return keccak256(toBytes(source));
}
