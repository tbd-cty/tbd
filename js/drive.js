// drive.js - Đọc/ghi dữ liệu mã hóa trên Google Drive giống hệt core/drive_sync.py (thư mục TBD/<module>/data.enc,
// ghi «không khóa» có kiểm tra số phiên bản, sao lưu bản cũ vào backups/, file đính kèm trong <module>/files).

import { decryptBytes, decryptJson, encryptBytes, encryptJson } from "./crypto.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const BACKUP_MIN_INTERVAL_MS = 600 * 1000;
const BACKUPS_TO_KEEP = 5;

export class DriveError extends Error {}
export class OfflineError extends DriveError {}
export class ConflictError extends DriveError {}
export class AuthExpiredError extends DriveError {}

function esc(name) {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function pyStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export class Drive {
  /**
   * secrets: {client_id, client_secret, refresh_token, token_uri, root_id}; aesKey: CryptoKey
   * fetchFn: thay được khi kiểm thử; sleep: hàm chờ (ms)
   */
  constructor(secrets, aesKey, { fetchFn = globalThis.fetch.bind(globalThis), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 4 } = {}) {
    this.secrets = secrets;
    this.key = aesKey;
    this.fetch = fetchFn;
    this.sleep = sleep;
    this.retries = retries;
    this.token = null;
    this.tokenExpires = 0;
    this.rootId = secrets.root_id || null;
    this.folders = new Map();
    this.lastBackup = new Map();
  }

  // ---------------- kết nối ----------------
  async accessToken() {
    if (this.token && Date.now() < this.tokenExpires - 60000) return this.token;
    let res;
    try {
      res = await this.fetch(this.secrets.token_uri || "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token", refresh_token: this.secrets.refresh_token,
          client_id: this.secrets.client_id, client_secret: this.secrets.client_secret,
        }).toString(),
      });
    } catch (e) {
      throw new OfflineError("Không kết nối được máy chủ (kiểm tra mạng 4G/Wi-Fi).");
    }
    if (res.status === 400 || res.status === 401) {
      throw new AuthExpiredError("Quyền truy cập Google Drive đã hết hạn hoặc bị thu hồi. Hãy nhờ Giám đốc tạo mã cài đặt mới.");
    }
    if (!res.ok) throw new DriveError(`Máy chủ đăng nhập báo lỗi ${res.status}.`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpires = Date.now() + (data.expires_in || 3600) * 1000;
    return this.token;
  }

  async call(method, url, { body, headers = {}, as = "json" } = {}) {
    let last;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      let res;
      try {
        const token = await this.accessToken();
        res = await this.fetch(url, { method, body, headers: { ...headers, Authorization: `Bearer ${token}` } });
      } catch (e) {
        if (e instanceof AuthExpiredError) throw e;
        last = e instanceof DriveError ? e : new OfflineError("Không kết nối được máy chủ (kiểm tra mạng 4G/Wi-Fi).");
        if (attempt < this.retries - 1) await this.sleep(800 * 2 ** attempt);
        continue;
      }
      if (res.ok) {
        if (as === "bytes") return new Uint8Array(await res.arrayBuffer());
        if (as === "none" || res.status === 204) return null;
        return res.json();
      }
      if (res.status === 404) throw new DriveError("Không tìm thấy file trên máy chủ.");
      if (res.status === 401) {
        this.token = null;                                   // token hết hạn sớm: lấy lại rồi thử tiếp
        last = new DriveError("Phiên truy cập hết hạn.");
        continue;
      }
      let reason = "";
      try {
        reason = (await res.json()).error.errors[0].reason;
      } catch (e) { /* bỏ qua */ }
      const retryable = [429, 500, 502, 503, 504].includes(res.status) || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded|backendError/.test(reason));
      if (!retryable) {
        if (reason === "storageQuotaExceeded") throw new DriveError("Tài khoản Google đã hết dung lượng lưu trữ.");
        if (res.status === 403) throw new DriveError("Máy chủ từ chối quyền truy cập. Hãy nhờ Giám đốc tạo mã cài đặt mới.");
        throw new DriveError(`Máy chủ báo lỗi ${res.status}.`);
      }
      last = new DriveError("Máy chủ đang quá tải, vui lòng thử lại sau ít phút.");
      if (attempt < this.retries - 1) await this.sleep(800 * 2 ** attempt);
    }
    throw last;
  }

  // ---------------- thư mục ----------------
  async find(name, parent, folder = false) {
    let q = `name = '${esc(name)}' and '${parent}' in parents and trashed = false`;
    if (folder) q += ` and mimeType = '${FOLDER_MIME}'`;
    const params = new URLSearchParams({ q, fields: "files(id, name, version, createdTime)", orderBy: "createdTime", pageSize: "10",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const res = await this.call("GET", `${API}/files?${params}`);
    return (res.files || [])[0] || null;
  }

  async ensureFolder(name, parent) {
    const found = await this.find(name, parent, true);
    if (found) return found.id;
    const res = await this.call("POST", `${API}/files?fields=id&supportsAllDrives=true`, {
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }), headers: { "Content-Type": "application/json" },
    });
    return res.id;
  }

  async root() {
    if (!this.rootId) this.rootId = await this.ensureFolder("TBD", "root");
    return this.rootId;
  }

  async folder(path) {
    // path: ["expense_receipts"] hoặc ["expense_receipts", "files"]
    const key = path.join("/");
    if (this.folders.has(key)) return this.folders.get(key);
    const parent = path.length === 1 ? await this.root() : await this.folder(path.slice(0, -1));
    const id = await this.ensureFolder(path[path.length - 1], parent);
    this.folders.set(key, id);
    return id;
  }

  // ---------------- dữ liệu module ----------------
  async load(module) {
    const folder = await this.folder([module]);
    const meta = await this.find("data.enc", folder);
    if (!meta) return { data: null, version: null };
    const blob = await this.call("GET", `${API}/files/${meta.id}?alt=media&supportsAllDrives=true`, { as: "bytes" });
    return { data: await decryptJson(blob, this.key), version: String(meta.version) };
  }

  multipart(metadata, bytes) {
    const boundary = "tbd" + Math.random().toString(16).slice(2);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const te = new TextEncoder();
    const a = te.encode(head), c = te.encode(tail);
    const body = new Uint8Array(a.length + bytes.length + c.length);
    body.set(a, 0); body.set(bytes, a.length); body.set(c, a.length + bytes.length);
    return { body, headers: { "Content-Type": `multipart/related; boundary=${boundary}` } };
  }

  async createFile(name, parent, bytes, fields = "id, version") {
    const { body, headers } = this.multipart({ name, parents: [parent] }, bytes);
    return this.call("POST", `${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, { body, headers });
  }

  async backup(module, dataId) {
    const bfolder = await this.folder([module, "backups"]);
    await this.call("POST", `${API}/files/${dataId}/copy?fields=id&supportsAllDrives=true`, {
      body: JSON.stringify({ name: `data_${pyStamp()}.enc`, parents: [bfolder] }), headers: { "Content-Type": "application/json" },
    });
    try {
      const params = new URLSearchParams({ q: `'${bfolder}' in parents and trashed = false`, fields: "files(id, name, createdTime)",
        orderBy: "createdTime desc", pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      const list = (await this.call("GET", `${API}/files?${params}`)).files || [];
      for (const old of list.slice(BACKUPS_TO_KEEP)) await this.call("DELETE", `${API}/files/${old.id}?supportsAllDrives=true`, { as: "none" });
    } catch (e) { /* dọn bản cũ lỗi thì bỏ qua */ }
  }

  /** Ghi không khóa: phiên bản trên Drive phải còn đúng bản đã đọc (expected), nếu khác thì ConflictError. */
  async saveUnlocked(module, data, expected) {
    const blob = await encryptJson(data, this.key);
    const folder = await this.folder([module]);
    const meta = await this.find("data.enc", folder);
    let res;
    if (!meta) {
      if (expected !== null) throw new ConflictError("File dữ liệu trên máy chủ đã bị xóa.");
      res = await this.createFile("data.enc", folder, blob);
    } else {
      if (expected === null || String(meta.version) !== String(expected)) throw new ConflictError("Dữ liệu vừa được người khác thay đổi.");
      if (Date.now() - (this.lastBackup.get(module) || -Infinity) >= BACKUP_MIN_INTERVAL_MS) {
        await this.backup(module, meta.id);
        this.lastBackup.set(module, Date.now());
      }
      res = await this.call("PATCH", `${UPLOAD}/files/${meta.id}?uploadType=media&fields=id,version&supportsAllDrives=true`, {
        body: blob, headers: { "Content-Type": "application/octet-stream" },
      });
    }
    return String(res.version);
  }

  /** Đọc bản mới nhất, chạy mutate(data) (sửa trực tiếp), ghi; người khác ghi xen vào thì đọc lại và làm lại (tối đa 4 lần). */
  async edit(module, mutate) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, version } = await this.load(module);
      const result = await mutate(data);
      if (!result || !result.data) return result && result.value;
      try {
        await this.saveUnlocked(module, result.data, version);
        return result.value;
      } catch (e) {
        if (e instanceof ConflictError) continue;
        throw e;
      }
    }
    throw new DriveError("Nhiều người đang sửa cùng lúc nên chưa lưu được, bạn thử lại sau ít giây.");
  }

  // ---------------- file đính kèm (ảnh hóa đơn) ----------------
  async uploadAttachment(module, name, bytes) {
    const folder = await this.folder([module, "files"]);
    const res = await this.createFile(name, folder, await encryptBytes(bytes, this.key), "id");
    return res.id;
  }

  async downloadAttachment(fileId) {
    const blob = await this.call("GET", `${API}/files/${fileId}?alt=media&supportsAllDrives=true`, { as: "bytes" });
    return decryptBytes(blob, this.key);
  }

  async deleteFile(fileId) {
    try {
      await this.call("DELETE", `${API}/files/${fileId}?supportsAllDrives=true`, { as: "none" });
    } catch (e) { /* bỏ qua */ }
  }
}
