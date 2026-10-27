// crypto.js - Mã hóa tương thích 100% với core/crypto.py của phần mềm máy tính.
// File .enc: [4 byte "TBD1"][1 byte phiên bản = 1][12 byte nonce][dữ liệu AES-256-GCM + 16 byte thẻ], header là dữ liệu xác thực (AAD).

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const MAGIC = enc.encode("TBD1");
const HEADER = new Uint8Array([...MAGIC, 1]);

export class CryptoError extends Error {}

export function b64encode(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function b64decode(text) {
  const clean = String(text).replace(/-/g, "+").replace(/_/g, "/").replace(/[\s=]/g, "");
  const s = atob(clean + "===".slice((clean.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export async function importAesKey(raw) {
  if (raw.length !== 32) throw new CryptoError("Khóa mã hóa phải dài 32 byte.");
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(data, aesKey) {
  const nonce = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: HEADER }, aesKey, data));
  const out = new Uint8Array(HEADER.length + 12 + ct.length);
  out.set(HEADER, 0);
  out.set(nonce, HEADER.length);
  out.set(ct, HEADER.length + 12);
  return out;
}

export async function decryptBytes(blob, aesKey) {
  blob = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (blob.length < 5 + 12 + 16) throw new CryptoError("File quá ngắn hoặc không phải file .enc của hệ thống.");
  for (let i = 0; i < 4; i++) if (blob[i] !== MAGIC[i]) throw new CryptoError("File không đúng định dạng của hệ thống.");
  if (blob[4] !== 1) throw new CryptoError(`Phiên bản file (${blob[4]}) chưa được hỗ trợ.`);
  try {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(5, 17), additionalData: blob.subarray(0, 5) }, aesKey, blob.subarray(17));
    return new Uint8Array(plain);
  } catch (e) {
    throw new CryptoError("Không giải mã được: sai khóa, hoặc file đã bị hỏng.");
  }
}

// JSON gọn như Python json.dumps(ensure_ascii=False, separators=(",", ":"))
export async function encryptJson(obj, aesKey) {
  return encryptBytes(enc.encode(JSON.stringify(obj)), aesKey);
}

export async function decryptJson(blob, aesKey) {
  const raw = await decryptBytes(blob, aesKey);
  try {
    return JSON.parse(dec.decode(raw));
  } catch (e) {
    throw new CryptoError("Dữ liệu sau giải mã không phải JSON hợp lệ.");
  }
}

// ---- Khóa dẫn xuất từ mật khẩu (mã cài đặt, mã PIN) ----
export async function pbkdf2Key(password, salt, iterations) {
  const base = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function pbkdf2Bits(passwordBytes, salt, iterations, bytes) {
  const base = await subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, bytes * 8));
}

export async function sealText(text, password, iterations, aad = "TBDPIN") {
  const salt = randomBytes(16), nonce = randomBytes(12);
  const key = await pbkdf2Key(password, salt, iterations);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(aad) }, key, enc.encode(text)));
  return { salt: b64encode(salt), nonce: b64encode(nonce), data: b64encode(ct), iterations };
}

export async function openText(sealed, password, aad = "TBDPIN") {
  const key = await pbkdf2Key(password, b64decode(sealed.salt), sealed.iterations);
  try {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: b64decode(sealed.nonce), additionalData: enc.encode(aad) }, key, b64decode(sealed.data));
    return dec.decode(plain);
  } catch (e) {
    throw new CryptoError("Sai mã.");
  }
}

// ---- Mã cài đặt do tao_ma_dien_thoai.py tạo: TBDM1.<base64url(salt16 | nonce12 | AES-GCM)> ----
export const SETUP_PREFIX = "TBDM1";
export const SETUP_ITERATIONS = 250000;

export async function readSetupCode(code, password) {
  const text = String(code || "").trim();
  const dot = text.indexOf(".");
  if (dot < 0 || text.slice(0, dot) !== SETUP_PREFIX) throw new CryptoError("Mã cài đặt không đúng (phải bắt đầu bằng TBDM1.).");
  let blob;
  try {
    blob = b64decode(text.slice(dot + 1));
  } catch (e) {
    throw new CryptoError("Mã cài đặt bị thiếu hoặc sai ký tự. Hãy sao chép lại cả đoạn mã.");
  }
  if (blob.length < 16 + 12 + 16) throw new CryptoError("Mã cài đặt bị thiếu. Hãy sao chép lại cả đoạn mã.");
  const key = await pbkdf2Key(String(password || "").trim(), blob.subarray(0, 16), SETUP_ITERATIONS);
  let plain;
  try {
    plain = await subtle.decrypt({ name: "AES-GCM", iv: blob.subarray(16, 28), additionalData: enc.encode(SETUP_PREFIX) }, key, blob.subarray(28));
  } catch (e) {
    throw new CryptoError("Mật khẩu kích hoạt không đúng (hoặc mã bị sao chép thiếu).");
  }
  const payload = JSON.parse(dec.decode(plain));
  if (payload.v !== 1 || !payload.key || !payload.refresh_token) throw new CryptoError("Mã cài đặt không hợp lệ.");
  return payload;
}
