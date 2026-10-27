// scrypt.js - Kiểm tra mật khẩu đăng nhập: cùng thuật toán scrypt với core/auth.py (hashlib.scrypt, N=2^14, r=8, p=1).
// Viết thuần JavaScript (RFC 7914), dùng PBKDF2-HMAC-SHA256 của trình duyệt cho hai bước đầu/cuối.

import { b64decode, pbkdf2Bits } from "./crypto.js";

function R(a, b) {
  return (a << b) | (a >>> (32 - b));
}

function salsa208(B, x) {
  // B: Uint32Array(16) vào/ra; x: Uint32Array(16) tạm
  x.set(B);
  for (let i = 0; i < 8; i += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9);
    x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9);
    x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9);
    x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9);
    x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9);
    x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9);
    x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9);
    x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9);
    x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}

function blockMix(B, Y, r, X, tmp) {
  // B: 32*r từ (2r khối 16 từ); kết quả ghi lại vào B (dùng Y làm vùng tạm)
  X.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) X[j] ^= B[i * 16 + j];
    salsa208(X, tmp);
    Y.set(X, i * 16);
  }
  for (let i = 0; i < r; i++) B.set(Y.subarray(2 * i * 16, 2 * i * 16 + 16), i * 16);
  for (let i = 0; i < r; i++) B.set(Y.subarray((2 * i + 1) * 16, (2 * i + 1) * 16 + 16), (i + r) * 16);
}

function roMix(Bbytes, N, r) {
  const words = 32 * r;
  const X = new Uint32Array(words);
  const dv = new DataView(Bbytes.buffer, Bbytes.byteOffset, Bbytes.byteLength);
  for (let i = 0; i < words; i++) X[i] = dv.getUint32(i * 4, true);
  const V = new Uint32Array(words * N);
  const Y = new Uint32Array(words), T = new Uint32Array(16), tmp = new Uint32Array(16);
  for (let i = 0; i < N; i++) {
    V.set(X, i * words);
    blockMix(X, Y, r, T, tmp);
  }
  for (let i = 0; i < N; i++) {
    const j = X[(2 * r - 1) * 16] & (N - 1);
    const off = j * words;
    for (let k = 0; k < words; k++) X[k] ^= V[off + k];
    blockMix(X, Y, r, T, tmp);
  }
  for (let i = 0; i < words; i++) dv.setUint32(i * 4, X[i], true);
}

export async function scrypt(passwordBytes, salt, N, r, p, dkLen) {
  if (N < 2 || (N & (N - 1)) !== 0) throw new Error("N phải là lũy thừa của 2");
  const B = await pbkdf2Bits(passwordBytes, salt, 1, p * 128 * r);
  for (let i = 0; i < p; i++) roMix(B.subarray(i * 128 * r, (i + 1) * 128 * r), N, r);
  return pbkdf2Bits(passwordBytes, B, 1, dkLen);
}

// Kiểm tra mật khẩu với chuỗi băm dạng "scrypt$N$r$p$salt_b64$hash_b64" (core/auth.py hash_password)
export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = b64decode(hashB64);
  const got = await scrypt(new TextEncoder().encode(password || ""), b64decode(saltB64), +n, +r, +p, expected.length);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i];
  return diff === 0 && got.length === expected.length;
}
