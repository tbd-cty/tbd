// session.js - Cài đặt điện thoại, đăng nhập, mã PIN, và các thao tác đọc/ghi dữ liệu dùng chung với phần mềm máy tính.

import { b64decode, importAesKey, openText, readSetupCode, sealText } from "./crypto.js";
import { verifyPassword } from "./scrypt.js";
import { Drive } from "./drive.js";
import { UserError } from "./base.js";
import { ProjectTracking } from "./pt.js";
import { Receipts } from "./receipts.js";
import { compressImage } from "./image.js";

const STORE_KEY = "tbd_mobile_v1";
const PIN_ITERATIONS = 300000;
const MAX_PIN_FAILS = 5;

function storage() {
  try {
    return globalThis.localStorage;
  } catch (e) {
    return null;
  }
}

export function loadStored() {
  try {
    const raw = storage() && storage().getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveStored(obj) {
  try {
    storage().setItem(STORE_KEY, JSON.stringify(obj));
  } catch (e) {
    throw new UserError("Điện thoại không cho lưu dữ liệu (đang ở chế độ ẩn danh?). Hãy mở bằng trình duyệt thường.");
  }
}

export function wipe() {
  try {
    const s = storage();
    if (!s) return;
    const keys = [];
    for (let i = 0; i < s.length; i++) keys.push(s.key(i));
    for (const k of keys) if (k && k.startsWith("tbd_")) s.removeItem(k);
  } catch (e) { /* bỏ qua */ }
}

export function seenAt(username) {
  try { return storage().getItem(`tbd_seen_${username}`) || ""; } catch (e) { return ""; }
}

export function setSeenAt(username, at) {
  try { if (at) storage().setItem(`tbd_seen_${username}`, at); } catch (e) { /* bỏ qua */ }
}

function publicUser(r) {
  return { username: r.username, full_name: r.full_name, role: r.role, department: r.department || "", active: r.active !== false,
    supervisor: r.supervisor || "", overrides: r.overrides || {}, must_change_password: !!r.must_change_password };
}

export class Session {
  constructor(secrets, drive) {
    this.secrets = secrets;
    this.drive = drive;
    this.user = null;
    this.directory = [];
  }

  static async fromSecrets(secrets, driveOptions = {}) {
    const key = await importAesKey(b64decode(secrets.key));
    return new Session(secrets, new Drive(secrets, key, driveOptions));
  }

  /** Bước 1: mã cài đặt + mật khẩu kích hoạt -> phiên chưa đăng nhập (chưa lưu gì vào máy). */
  static async setup(code, activationPassword, driveOptions) {
    const secrets = await readSetupCode(code, activationPassword);
    return Session.fromSecrets(secrets, driveOptions);
  }

  async usersDb() {
    const { data } = await this.drive.load("users");
    if (!data || !data.users || !Object.keys(data.users).length) throw new UserError("Chưa có tài khoản nào trong hệ thống.");
    return data;
  }

  setDirectory(db) {
    this.directory = Object.values(db.users).filter((r) => r.active !== false).map(publicUser);
  }

  /** Bước 2: đăng nhập bằng tài khoản của phần mềm máy tính. */
  async login(username, password) {
    const uname = String(username || "").trim().toLowerCase();
    const db = await this.usersDb();
    const record = db.users[uname];
    const ok = record ? await verifyPassword(password || "", record.password_hash) : false;
    if (!record || !ok) throw new UserError("Tên đăng nhập hoặc mật khẩu không đúng.");
    if (record.active === false) throw new UserError("Tài khoản đã bị khóa. Vui lòng liên hệ Giám đốc.");
    if (record.must_change_password) throw new UserError("Tài khoản đang dùng mật khẩu tạm. Hãy đăng nhập trên máy tính để đổi mật khẩu trước, rồi đăng nhập lại ở đây.");
    this.user = publicUser(record);
    this.setDirectory(db);
    return this.user;
  }

  /** Bước 3: lưu khóa + quyền truy cập vào máy, khóa bằng mã PIN. */
  async savePin(pin) {
    if (!/^\d{6}$/.test(pin)) throw new UserError("Mã PIN gồm đúng 6 chữ số.");
    const sealed = await sealText(JSON.stringify({ secrets: this.secrets, username: this.user.username }), pin, PIN_ITERATIONS);
    saveStored({ username: this.user.username, full_name: this.user.full_name, sealed, fails: 0 });
  }

  /** Mở khóa bằng mã PIN. Sai 5 lần thì xóa sạch, phải cài lại bằng mã cài đặt. */
  static async unlock(pin, driveOptions) {
    const stored = loadStored();
    if (!stored) throw new UserError("Chưa cài đặt.");
    let inner;
    try {
      inner = JSON.parse(await openText(stored.sealed, pin));
    } catch (e) {
      stored.fails = (stored.fails || 0) + 1;
      if (stored.fails >= MAX_PIN_FAILS) {
        wipe();
        throw new UserError("Nhập sai mã PIN quá 5 lần. Ứng dụng đã xóa dữ liệu trên máy, hãy cài đặt lại bằng mã cài đặt.");
      }
      saveStored(stored);
      throw new UserError(`Mã PIN không đúng (còn ${MAX_PIN_FAILS - stored.fails} lần thử).`);
    }
    if (stored.fails) saveStored({ ...stored, fails: 0 });
    const session = await Session.fromSecrets(inner.secrets, driveOptions);
    session.pendingUsername = inner.username;
    return session;
  }

  /** Sau khi mở khóa: tải lại tài khoản (bị khóa / đổi vai trò trên máy tính thì cập nhật ngay). */
  async refreshUser() {
    const db = await this.usersDb();
    const record = db.users[this.user ? this.user.username : this.pendingUsername];
    if (!record || record.active === false) {
      wipe();
      throw new UserError("Tài khoản đã bị khóa hoặc không còn. Ứng dụng đã đăng xuất khỏi điện thoại này.");
    }
    this.user = publicUser(record);
    this.setDirectory(db);
    return this.user;
  }

  name(username) {
    const u = this.directory.find((d) => d.username === username);
    return u ? u.full_name : username || "";
  }

  // ---------------- đọc / ghi ----------------
  async readPT() {
    const { data } = await this.drive.load("project_tracking");
    return new ProjectTracking(data, this.user, this.directory);
  }

  async readRC() {
    const { data } = await this.drive.load("expense_receipts");
    return new Receipts(data, this.user, this.directory);
  }

  async editPT(fn) {
    return this.drive.edit("project_tracking", async (data) => {
      const pt = new ProjectTracking(data, this.user, this.directory);
      const value = await fn(pt);
      return { data: pt.dirty ? pt.data : null, value };
    });
  }

  async editRC(fn) {
    return this.drive.edit("expense_receipts", async (data) => {
      const rc = new Receipts(data, this.user, this.directory);
      const value = await fn(rc);
      return { data: rc.dirty ? rc.data : null, value };
    });
  }

  /** Tải ảnh lên (nén, mã hóa), trả về danh sách ảnh cho phiếu. Lỗi giữa chừng thì xóa ảnh đã tải. */
  async uploadPhotos(files, onProgress = () => {}) {
    const uploaded = [];
    try {
      for (let i = 0; i < files.length; i++) {
        onProgress(i, files.length);
        const bytes = await compressImage(files[i]);
        const name = `img_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.enc`;
        const fileId = await this.drive.uploadAttachment("expense_receipts", name, bytes);
        uploaded.push({ file_id: fileId, name: (files[i].name || `anh_${i + 1}.jpg`).replace(/\.\w+$/, ".jpg"), size: bytes.length });
      }
      onProgress(files.length, files.length);
      return uploaded;
    } catch (e) {
      for (const u of uploaded) await this.drive.deleteFile(u.file_id);
      throw e;
    }
  }

  async submitReceipt(note, files, onProgress) {
    if (!String(note || "").trim()) throw new UserError("Hãy ghi mua cho việc gì.");
    if (!files.length) throw new UserError("Hãy chụp ít nhất một ảnh hóa đơn.");
    const images = await this.uploadPhotos(files, onProgress);
    try {
      return await this.editRC((rc) => rc.submit(note, images));
    } catch (e) {
      for (const u of images) await this.drive.deleteFile(u.file_id);
      throw e;
    }
  }

  async resubmitReceipt(id, note, files, onProgress) {
    const images = files.length ? await this.uploadPhotos(files, onProgress) : [];
    try {
      return await this.editRC((rc) => rc.resubmit(id, note, images));
    } catch (e) {
      for (const u of images) await this.drive.deleteFile(u.file_id);
      throw e;
    }
  }

  async photo(fileId) {
    return this.drive.downloadAttachment(fileId);
  }
}
