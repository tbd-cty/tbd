// receipts.js - Hóa đơn mua khẩn (module expense_receipts), chép đúng quy tắc của modules/expense_receipts/service.py.

import { ModuleData, UserError, nowIso } from "./base.js";

export const SPEC = { id: "expense_receipts", schema: 1, label: "Hóa đơn mua khẩn", collections: { receipts: "HD" } };
export const STATE_LABELS = { submitted: "Chờ xác nhận", returned: "Bị trả lại", confirmed: "Đã xác nhận" };
export const OUTSIDE_LABEL = "Việc ngoài dự án";
const MAX_IMAGES = 10;
const MAX_AMOUNT = 10_000_000_000;

function clean(value, label, required, maxLen) {
  const t = String(value == null ? "" : value).split(/\s+/).filter(Boolean).join(" ");
  if (required && !t) throw new UserError(`${label} không được để trống.`);
  if (t.length > maxLen) throw new UserError(`${label} quá dài (tối đa ${maxLen} ký tự).`);
  return t;
}

export function parseAmount(value) {
  if (typeof value === "boolean") throw new UserError("Tổng tiền phải là số.");
  let n;
  if (typeof value === "number") n = value;
  else {
    const t = String(value == null ? "" : value).replace(/[ ., đĐdD]/g, "");
    if (!t) throw new UserError("Hãy nhập tổng tiền theo hóa đơn.");
    if (!/^\d+$/.test(t)) throw new UserError("Tổng tiền chỉ gồm chữ số (ví dụ 1.250.000).");
    n = parseInt(t, 10);
  }
  if (!Number.isInteger(n) || n <= 0) throw new UserError("Tổng tiền phải là số nguyên lớn hơn 0 (đồng).");
  if (n > MAX_AMOUNT) throw new UserError("Tổng tiền quá lớn, hãy kiểm tra lại số 0.");
  return n;
}

export function money(n) {
  return n == null ? "-" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function cleanImages(images) {
  return (images || []).map((img) => {
    if (!img.file_id) throw new UserError("Ảnh hóa đơn chưa tải lên máy chủ.");
    return { file_id: String(img.file_id).slice(0, 200), name: String(img.name || "anh.jpg").slice(0, 120), size: +img.size || 0,
      added_at: String(img.added_at || nowIso()).slice(0, 19) };
  });
}

export class Receipts extends ModuleData {
  constructor(data, user, directory) {
    super(data, user, SPEC);
    this.directory = Object.fromEntries((directory || []).filter((u) => u.active !== false).map((u) => [u.username, u]));
  }

  get isDirector() {
    return this.user.role === "director";
  }

  mayReview(r) {
    if (this.isDirector || r.reviewer === this.me) return true;
    const person = this.directory[r.submitter];
    return !!person && person.supervisor === this.me;
  }

  visible(r) {
    return r.submitter === this.me || this.mayReview(r);
  }

  actions(r) {
    const out = [], mine = r.submitter === this.me;
    if (this.mayReview(r) && !mine) {
      if (r.state === "submitted") out.push("confirm", "return");
      else if (r.state === "confirmed") out.push("reclassify");
    }
    if (mine && r.state === "returned") out.push("resubmit");
    if (mine && (r.state === "submitted" || r.state === "returned")) out.push("cancel");
    return out;
  }

  submit(note, images) {
    this.requireEdit();
    if (this.isDirector) throw new UserError("Giám đốc không gửi hóa đơn chờ xác nhận.");
    note = clean(note, "Ghi chú (mua cho việc gì)", true, 500);
    images = cleanImages(images);
    if (!images.length) throw new UserError("Hãy chụp ít nhất một ảnh hóa đơn.");
    if (images.length > MAX_IMAGES) throw new UserError(`Tối đa ${MAX_IMAGES} ảnh cho một hóa đơn.`);
    const reviewer = (this.directory[this.me] || {}).supervisor || this.user.supervisor || "";
    const now = nowIso();
    return this.create("receipts", {
      submitter: this.me, reviewer, note, images, source: "mobile", state: "submitted", submitted_at: now,
      project_id: null, project_label: "", amount: null, reviewed_by: "", reviewed_at: "", return_reason: "",
      history: [{ at: now, by: this.me, event: "Gửi hóa đơn", note }],
    });
  }

  resubmit(id, note, addImages) {
    this.requireEdit();
    const r = this.raw("receipts", id);
    if (r.submitter !== this.me) throw new UserError("Chỉ người gửi mới gửi lại được hóa đơn này.");
    if (r.state !== "returned") throw new UserError("Chỉ gửi lại được hóa đơn đang bị trả lại.");
    const images = [...r.images, ...cleanImages(addImages)];
    if (images.length > MAX_IMAGES) throw new UserError(`Tối đa ${MAX_IMAGES} ảnh cho một hóa đơn.`);
    const n = note == null ? r.note : clean(note, "Ghi chú (mua cho việc gì)", true, 500);
    return this.update("receipts", id, { note: n, images, state: "submitted", submitted_at: nowIso(), return_reason: "",
      history: this.event(r, "Gửi lại", n) });
  }

  cancel(id) {
    this.requireEdit();
    const r = this.raw("receipts", id);
    if (r.submitter !== this.me) throw new UserError("Chỉ người gửi mới hủy được hóa đơn này.");
    if (r.state === "confirmed") throw new UserError("Hóa đơn đã được xác nhận, không hủy được.");
    this.remove("receipts", id);
  }

  classification(projectId, label, amount) {
    if (projectId == null) throw new UserError("Hãy chọn dự án (hoặc «Việc ngoài dự án»).");
    projectId = String(projectId).trim().slice(0, 20);
    const projectLabel = projectId === "" ? OUTSIDE_LABEL : clean(label || projectId, "Tên dự án", true, 250);
    return { project_id: projectId, project_label: projectLabel, amount: parseAmount(amount) };
  }

  confirm(id, projectId, label, amount) {
    this.requireEdit();
    const r = this.raw("receipts", id);
    if (!this.mayReview(r) || r.submitter === this.me) throw new UserError("Chỉ cấp trên của người gửi (hoặc Giám đốc) mới xác nhận được hóa đơn này.");
    if (r.state !== "submitted") throw new UserError("Hóa đơn không ở trạng thái chờ xác nhận.");
    const f = this.classification(projectId, label, amount);
    return this.update("receipts", id, { ...f, state: "confirmed", reviewed_by: this.me, reviewed_at: nowIso(),
      history: this.event(r, "Xác nhận", `${f.project_label} · ${money(f.amount)} đ`) });
  }

  reclassify(id, projectId, label, amount) {
    this.requireEdit();
    const r = this.raw("receipts", id);
    if (!this.mayReview(r) || r.submitter === this.me) throw new UserError("Bạn không sửa được hóa đơn này.");
    if (r.state !== "confirmed") throw new UserError("Chỉ sửa phân loại của hóa đơn đã xác nhận.");
    const f = this.classification(projectId, label, amount);
    return this.update("receipts", id, { ...f, history: this.event(r, "Sửa phân loại", `${f.project_label} · ${money(f.amount)} đ`) });
  }

  returnReceipt(id, reason) {
    this.requireEdit();
    const r = this.raw("receipts", id);
    if (!this.mayReview(r) || r.submitter === this.me) throw new UserError("Chỉ cấp trên của người gửi (hoặc Giám đốc) mới trả lại được hóa đơn này.");
    if (r.state !== "submitted") throw new UserError("Chỉ trả lại được hóa đơn đang chờ xác nhận.");
    reason = clean(reason, "Lý do trả lại", true, 500);
    return this.update("receipts", id, { state: "returned", return_reason: reason, reviewed_by: this.me, reviewed_at: nowIso(),
      history: this.event(r, "Trả lại", reason) });
  }

  view(id) {
    const r = this.raw("receipts", id);
    if (!this.visible(r)) throw new UserError("Bạn không có quyền xem hóa đơn này.");
    return { ...structuredClone(r), actions: this.actions(r) };
  }

  list() {
    return this.active("receipts", (r) => this.visible(r)).map((r) => ({ ...structuredClone(r), actions: this.actions(r) }))
      .sort((a, b) => (a.submitted_at === b.submitted_at ? (a.id < b.id ? 1 : -1) : a.submitted_at < b.submitted_at ? 1 : -1));
  }

  myPending() {
    const out = [];
    for (const r of this.active("receipts")) {
      if (r.state === "submitted" && r.submitter !== this.me) {
        const person = this.directory[r.submitter];
        if (r.reviewer === this.me || (person && person.supervisor === this.me)) {
          out.push({ kind: "receipt_to_review", id: r.id, submitter: r.submitter, note: r.note, since: r.submitted_at, images: r.images.length });
        }
      } else if (r.state === "returned" && r.submitter === this.me) {
        out.push({ kind: "receipt_returned", id: r.id, submitter: r.submitter, note: r.return_reason, since: r.reviewed_at, images: r.images.length });
      }
    }
    return out.sort((a, b) => (a.since < b.since ? -1 : 1));
  }

  myNotifications(days = 21) {
    const cutoff = nowIso(new Date(Date.now() - days * 86400000));
    const rows = [];
    for (const r of this.active("receipts", (r) => this.visible(r))) {
      for (const h of r.history || []) {
        if (h.by === this.me || h.at < cutoff) continue;
        const sent = h.event === "Gửi hóa đơn" || h.event === "Gửi lại";
        const relevant = (r.submitter === this.me && ["Xác nhận", "Trả lại", "Sửa phân loại"].includes(h.event))
          || (sent && this.mayReview(r) && !this.isDirector)
          || (sent && this.isDirector && r.reviewer === this.me)
          || (this.isDirector && (h.event === "Xác nhận" || h.event === "Sửa phân loại"));
        if (relevant) rows.push({ at: h.at, by: h.by, event: h.event, note: h.note, id: r.id, submitter: r.submitter });
      }
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  totalsByProject() {
    const sums = new Map();
    for (const r of this.active("receipts", (r) => r.state === "confirmed" && this.visible(r))) {
      const e = sums.get(r.project_id) || { project_id: r.project_id, label: r.project_label, total: 0, count: 0 };
      e.total += +r.amount || 0;
      e.count += 1;
      e.label = r.project_label || e.label;
      sums.set(r.project_id, e);
    }
    return [...sums.values()].sort((a, b) => b.total - a.total);
  }
}
