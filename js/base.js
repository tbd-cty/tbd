// base.js - Khung dữ liệu chung, giống core/module_base.py: {schema_version, counters, collections}, mã tự sinh (CV-0001),
// trường ghi vết created_at/created_by/updated_at/updated_by, xóa mềm. Cùng định dạng thời gian với Python (isoformat, giây).

export class UserError extends Error {}           // lỗi nghiệp vụ: hiện nguyên văn cho người dùng

export function nowIso(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function todayIso(date = new Date()) {
  return nowIso(date).slice(0, 10);
}

// Mức quyền theo vai trò (trích core/auth.py PERMISSIONS cho các module điện thoại dùng). 0 không thấy, 1 xem, 2 sửa, 3 duyệt.
const PERMS = {
  project_tracking: { director: 3, dept_head: 2, team_leader: 2, worker: 2 },
  expense_receipts: { director: 3, dept_head: 2, team_leader: 2, worker: 2, staff: 2, purchasing_head: 2, purchaser: 2, storekeeper: 2 },
};

export function level(user, module) {
  if (!user || !user.active) return 0;
  if (user.role !== "director" && user.overrides && module in user.overrides) return +user.overrides[module];
  return (PERMS[module] || {})[user.role] || 0;
}

export function can(user, module, action) {
  return level(user, module) >= { view: 1, edit: 2, approve: 3 }[action];
}

export function text(value, label, required, maxLen) {
  const t = value == null ? "" : String(value).trim();
  if (required && !t) throw new UserError(`${label} không được để trống.`);
  if (t.length > maxLen) throw new UserError(`${label} quá dài (tối đa ${maxLen} ký tự).`);
  return t;
}

export class ModuleData {
  /**
   * data: nội dung data.enc đã giải mã (null nếu module chưa có dữ liệu); user: người đang dùng
   * spec: {id, schema, collections: {tên: tiền tố}, label}
   */
  constructor(data, user, spec) {
    this.user = user;
    this.spec = spec;
    if (data == null) data = { schema_version: spec.schema, counters: {}, collections: {} };
    const v = data.schema_version || 1;
    if (v > spec.schema) {
      throw new UserError(`Dữ liệu «${spec.label}» do phần mềm bản mới hơn tạo ra. Hãy tải lại ứng dụng điện thoại (kéo xuống để làm mới) hoặc báo Giám đốc.`);
    }
    this.outdated = v < spec.schema;          // dữ liệu cũ: phần mềm máy tính bản mới sẽ tự nâng cấp khi mở; điện thoại chỉ xem
    data.counters = data.counters || {};
    data.collections = data.collections || {};
    for (const name of Object.keys(spec.collections)) data.collections[name] = data.collections[name] || {};
    this.data = data;
    this.dirty = false;
  }

  get me() {
    return this.user.username;
  }

  requireEdit() {
    if (this.outdated) throw new UserError(`Dữ liệu «${this.spec.label}» cần được phần mềm trên máy tính (bản mới) mở một lần trước khi sửa trên điện thoại.`);
    if (!can(this.user, this.spec.id, "edit")) throw new UserError(`Bạn chỉ có quyền xem «${this.spec.label}».`);
  }

  col(name) {
    return this.data.collections[name];
  }

  active(name, where) {
    return Object.values(this.col(name)).filter((r) => !r.deleted && (!where || where(r)));
  }

  raw(name, id) {
    const r = this.col(name)[id];
    if (!r || r.deleted) throw new UserError(`Không tìm thấy bản ghi ${id}.`);
    return r;
  }

  create(name, fields) {
    this.requireEdit();
    const n = (this.data.counters[name] || 0) + 1;
    const now = nowIso();
    const record = { ...fields, id: `${this.spec.collections[name]}-${String(n).padStart(4, "0")}`, deleted: false,
      created_at: now, created_by: this.me, updated_at: now, updated_by: this.me };
    this.data.counters[name] = n;
    this.col(name)[record.id] = record;
    this.dirty = true;
    return record;
  }

  update(name, id, changes) {
    this.requireEdit();
    const current = this.raw(name, id);
    const merged = { ...current, ...changes, updated_at: nowIso(), updated_by: this.me };
    this.col(name)[id] = merged;
    this.dirty = true;
    return merged;
  }

  remove(name, id) {
    this.requireEdit();
    const r = this.raw(name, id);
    const now = nowIso();
    Object.assign(r, { deleted: true, deleted_at: now, deleted_by: this.me, updated_at: now, updated_by: this.me });
    this.dirty = true;
  }

  event(record, event, note = "") {
    return [...(record.history || []), { at: nowIso(), by: this.me, event, note }];
  }
}
