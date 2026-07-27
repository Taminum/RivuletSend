// Round-trip correctness for the E2EE primitives, wrong-passphrase rejection,
// and — the security-critical case — that tampering with the AAD (as a chunk
// spliced from a different transfer/position would) makes decryption FAIL
// rather than silently returning wrong-but-plausible bytes.
//
// Runs under Node's WebCrypto, no browser needed.
import {
  deriveKey,
  buildIv,
  buildAad,
  encryptChunk,
  decryptChunk,
  randomSalt,
  randomNonce,
  toBase64,
  fromBase64,
} from "../src/crypto.ts";

let failures = 0;
function check(name: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

async function expectReject(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(name, false, "expected a rejection, got success");
  } catch {
    check(name, true);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function main(): Promise<void> {
  const salt = randomSalt();
  const nonce = randomNonce();
  const transferId = "transfer-abc";
  const key = await deriveKey("correct horse battery staple", salt);

  // --- Round trip ---
  const plain = enc.encode("hello world, this is chunk zero");
  const iv0 = buildIv(nonce, 0);
  const aad0 = buildAad(transferId, 0);
  const ct = await encryptChunk(key, plain.buffer as ArrayBuffer, iv0, aad0);
  check("ciphertext differs from plaintext", dec.decode(ct) !== dec.decode(plain));
  const round = await decryptChunk(key, ct, iv0, aad0);
  check("decrypt recovers the plaintext", dec.decode(round) === dec.decode(plain));

  // --- Deterministic key derivation (same passphrase+salt -> same key) ---
  const key2 = await deriveKey("correct horse battery staple", salt);
  const round2 = await decryptChunk(key2, ct, iv0, aad0);
  check("re-derived key decrypts", dec.decode(round2) === dec.decode(plain));

  // --- Wrong passphrase fails loudly ---
  const wrongKey = await deriveKey("wrong passphrase", salt);
  await expectReject("wrong passphrase rejects", () => decryptChunk(wrongKey, ct, iv0, aad0));

  // --- Tampered AAD fails (chunk spliced from a different seq/transfer) ---
  const aadWrongSeq = buildAad(transferId, 1); // same transfer, different position
  await expectReject("AAD with a different seq rejects", () => decryptChunk(key, ct, iv0, aadWrongSeq));
  const aadWrongTransfer = buildAad("transfer-xyz", 0); // different transfer, same seq
  await expectReject("AAD from a different transfer rejects", () =>
    decryptChunk(key, ct, iv0, aadWrongTransfer),
  );

  // --- Wrong IV fails ---
  const ivWrong = buildIv(nonce, 1);
  await expectReject("wrong IV rejects", () => decryptChunk(key, ct, ivWrong, aad0));

  // --- IV construction: unique per seq, nonce prefix preserved ---
  const ivA = buildIv(nonce, 42);
  check("IV is 12 bytes", ivA.length === 12);
  check("IV keeps the 4-byte nonce prefix", ivA.slice(0, 4).every((b, i) => b === nonce[i]));
  check("different seqs give different IVs", toBase64(buildIv(nonce, 42)) !== toBase64(buildIv(nonce, 43)));

  // --- base64 round trip (salt/nonce transit as base64 in the manifest) ---
  check("base64 round trip", toBase64(fromBase64(toBase64(salt))) === toBase64(salt));

  console.log(`\n${failures === 0 ? "ALL E2EE TESTS PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
