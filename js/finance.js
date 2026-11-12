// finance.js - Tài chính trên điện thoại (phiếu chi, phiếu thu), chép đúng modules/finance_accounting/service.py (cùng file dữ liệu với máy tính).
// Giám đốc: xem, DUYỆT, TRẢ LẠI phiếu chi. Trưởng phòng vật tư (làm kế toán): lập phiếu chi (một nút «Gửi duyệt»: lưu và gửi duyệt cùng lúc), ghi đã chi, rút về nháp, hủy,
// ghi và hủy phiếu thu. Công nợ, báo cáo, loại chi phí: làm trên máy tính.

import { ModuleData, UserError, can, nowIso, text, todayIso } from "./base.js";

export const SPEC = { id: "finance_accounting", schema: 1, label: "Tài chính", collections: { vouchers: "PC", categories: "LC", incomes: "PT", receivables: "PW" } };
export const STATE_LABELS = { draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", paid: "Đã chi", cancelled: "Đã hủy" };
export const METHODS = { cash: "Tiền mặt", transfer: "Chuyển khoản" };
export const INCOME_KINDS = { advance: "Tạm ứng", final: "Thanh toán sau nghiệm thu", other: "Khác" };
const MAX_AMOUNT = 10_000_000_000;
const GENERAL_LABEL = "Chi phí chung";
const sq = (v) => String(v == null ? "" : v).split(/\s+/).filter(Boolean).join(" ");

/** Chữ để so khớp: giống normalize ở máy tính (chữ thường, bỏ dấu tiếng Việt, ký tự lạ thành khoảng trắng, gộp khoảng trắng). */
export function key(v) {
  const t = String(v == null ? "" : v).toLowerCase().replace(/(\d),(?=\d)/g, "$1.").replace(/đ/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t.replace(/[^a-z0-9.,/x+-]+/g, " ").trim();
}

/** Người nhận tiền của phiếu; phiếu lập trước khi có ô này lấy tên ở ô «Nhà cung cấp». */
export const recipientOf = (r) => String(r.recipient || r.payee || "").trim();

/** Tổng tiền CẦN CHI (đã duyệt, chưa ghi đã chi, gồm VAT) theo từng người nhận tiền; text = chữ gõ vào ô tìm. Giống recipient_totals ở máy tính. */
export function recipientTotals(vouchers, text = "") {
  const needle = key(text), groups = new Map();
  for (const v of [...vouchers].sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))) {
    if (v.state !== "approved") continue;
    const name = recipientOf(v), k = key(name);
    if (needle && !k.includes(needle)) continue;
    if (!groups.has(k)) groups.set(k, { key: k, name: name || "(chưa ghi người nhận)", count: 0, total: 0, ids: [] });
    const g = groups.get(k);
    g.name = name || g.name;
    g.count += 1;
    g.total += v.total;
    g.ids.push(v.id);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Số tiền đồng: nhận 1250000, '1.250.000', '1 250 000'. Số nguyên không âm. */
export function parseMoney(value, label, allowEmpty = false) {
  let number;
  if (typeof value === "number") number = value;
  else {
    const t = String(value == null ? "" : value).replace(/[ .,đĐdD]/g, "");
    if (!t) {
      if (allowEmpty) return 0;
      throw new UserError(`Hãy nhập ${label.toLowerCase()}.`);
    }
    if (!/^\d+$/.test(t)) throw new UserError(`${label} chỉ gồm chữ số (ví dụ 1.250.000).`);
    number = Number(t);
  }
  if (!Number.isInteger(number) || number < 0) throw new UserError(`${label} phải là số nguyên không âm (đồng).`);
  if (number > MAX_AMOUNT) throw new UserError(`${label} quá lớn, hãy kiểm tra lại số 0.`);
  return number;
}

function isoDate(value, label) {
  const t = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new UserError(`${label} phải ghi dạng ngày/tháng/năm.`);
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) throw new UserError(`${label} không hợp lệ.`);
  if (y < 2000 || y > 2100) throw new UserError(`${label} không hợp lệ (năm ${y}).`);
  return t;
}

const isoLocal = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export class FinanceAccounting extends ModuleData {
  constructor(data, user, directory = []) {
    super(data, user, SPEC);
    this.directory = directory;
  }

  get isDirector() {
    return this.user.role === "director";
  }

  get isAccountant() {
    return !this.isDirector && can(this.user, "finance_accounting", "edit");
  }

  requireAccountant() {
    this.requireEdit();
    if (this.isDirector) throw new UserError("Phiếu chi do Trưởng phòng vật tư (kế toán) lập; Giám đốc duyệt, trả lại hoặc hủy.");
  }

  requireDirector() {
    if (!can(this.user, "finance_accounting", "approve")) throw new UserError("Chỉ Giám đốc mới làm được việc này.");
  }

  event(record, event, note = "") {
    return [...(record.history || []), { at: nowIso(), by: this.me, event, note }];
  }

  // ---- loại chi phí (chỉ đọc; Giám đốc thêm bớt trên máy tính) ----
  categories(includeInactive = false) {
    return this.active("categories", (r) => includeInactive || r.active !== false).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }

  // ---- phiếu chi ----
  view(r) {
    const returned = r.state === "draft" && !!r.return_reason;
    let actions = [];
    if (this.isDirector) actions = { pending: ["approve", "return", "cancel"], approved: ["cancel"] }[r.state] || [];
    else if (this.isAccountant) actions = { draft: ["edit", "submit", "cancel"], pending: ["withdraw", "cancel"], approved: ["pay", "cancel"] }[r.state] || [];
    return { ...r, state_label: returned ? "Bị trả lại" : STATE_LABELS[r.state], returned, method_label: METHODS[r.method] || r.method, recipient: recipientOf(r), actions };
  }

  vouchers() {
    return this.active("vouchers").map((r) => this.view(r)).sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  }

  voucher(id) {
    return this.view(this.raw("vouchers", id));
  }

  /** Tên người nhận tiền đã dùng ở phiếu chưa hủy, để gợi ý khi gõ (mỗi người một lần, cách viết ở phiếu mới nhất), xếp theo tên. */
  recipientNames() {
    const seen = new Map();
    for (const r of this.active("vouchers", (r) => r.state !== "cancelled").sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1))) {
      const name = recipientOf(r);
      if (name) seen.set(key(name), name);
    }
    return [...seen.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  /** {mã hóa đơn khẩn: mã phiếu chi đang dùng nó} (không tính phiếu đã hủy). */
  receiptLinks() {
    const out = {};
    for (const r of this.active("vouchers", (r) => r.receipt_id && r.state !== "cancelled")) out[r.receipt_id] = r.id;
    return out;
  }

  checkReceiptFree(receiptId, excludeId) {
    if (!receiptId) return;
    for (const o of this.active("vouchers", (o) => o.id !== excludeId && o.receipt_id === receiptId && o.state !== "cancelled")) {
      throw new UserError(`Hóa đơn khẩn ${receiptId} đã có phiếu chi ${o.id}.`);
    }
  }

  clean(fields, excludeId) {
    const category = this.col("categories")[String(fields.category_id || "")];
    if (!category || category.deleted) throw new UserError("Hãy chọn loại chi phí.");
    if (category.active === false) throw new UserError(`Loại chi phí «${category.name}» đã ngừng dùng.`);
    const projectId = String(fields.project_id || "").trim().slice(0, 20);
    const projectLabel = projectId === "" ? GENERAL_LABEL : text(sq(fields.project_label || projectId), "Tên dự án", true, 250);
    const net = parseMoney(fields.amount_net, "Số tiền chưa VAT");
    const vat = parseMoney(fields.vat, "Tiền VAT", true);
    if (net <= 0) throw new UserError("Số tiền chưa VAT phải lớn hơn 0.");
    if (net + vat > MAX_AMOUNT) throw new UserError("Tổng tiền quá lớn, hãy kiểm tra lại số 0.");
    const method = String(fields.method || "");
    if (!METHODS[method]) throw new UserError("Hãy chọn hình thức chi: tiền mặt hoặc chuyển khoản.");
    const receiptId = String(fields.receipt_id || "").trim().slice(0, 20);
    this.checkReceiptFree(receiptId, excludeId);
    return {
      date: isoDate(fields.date, "Ngày chứng từ"), category_id: category.id, category_name: category.name, project_id: projectId, project_label: projectLabel,
      content: text(sq(fields.content), "Nội dung chi", true, 300), recipient: text(sq(fields.recipient), "Người nhận tiền", true, 120), payee: text(sq(fields.payee), "Nhà cung cấp", false, 120),
      invoice_no: text(sq(fields.invoice_no), "Số hóa đơn", false, 60), amount_net: net, vat, total: net + vat, method, note: text(sq(fields.note), "Ghi chú", false, 500), receipt_id: receiptId,
    };
  }

  /** Lập phiếu chi mới (Nháp) hoặc sửa phiếu Nháp (kể cả phiếu bị trả lại). Chỉ Trưởng phòng vật tư. */
  saveVoucher(id, fields) {
    this.requireAccountant();
    if (id) {
      const record = this.raw("vouchers", id);
      if (record.state !== "draft") throw new UserError(`Phiếu ${id} đang «${STATE_LABELS[record.state]}», không sửa được. Muốn sửa hãy rút lại về Nháp (phiếu chờ duyệt) hoặc nhờ Giám đốc trả lại.`);
      const clean = this.clean(fields, id);
      if (!("invoice_no" in fields)) clean.invoice_no = record.invoice_no || "";                 // giao diện mới không còn ô Số hóa đơn: giữ số cũ của phiếu
      return this.view(this.update("vouchers", id, { ...clean, history: this.event(record, "Sửa", clean.content) }));
    }
    const clean = this.clean(fields, null);
    return this.view(this.create("vouchers", {
      ...clean, state: "draft", return_reason: "", cancel_reason: "", approved_by: "", approved_at: "", paid_at: "", paid_by: "", receipt_images_purged_at: "",
      history: [{ at: nowIso(), by: this.me, event: "Lập phiếu", note: clean.content }],
    }));
  }

  move(id, allowed, to, event, note = "", extra = {}) {
    const record = this.raw("vouchers", id);
    if (!allowed.includes(record.state)) throw new UserError(`Phiếu ${id} đang «${STATE_LABELS[record.state]}», không làm được thao tác này.`);
    return this.view(this.update("vouchers", id, { state: to, history: this.event(record, event, note), ...extra }));
  }

  submit(id) {
    this.requireAccountant();
    return this.move(id, ["draft"], "pending", "Gửi duyệt", "", { return_reason: "" });
  }

  withdraw(id) {
    this.requireAccountant();
    return this.move(id, ["pending"], "draft", "Rút lại");
  }

  approve(id) {
    this.requireDirector();
    return this.move(id, ["pending"], "approved", "Duyệt", "", { approved_by: this.me, approved_at: nowIso() });
  }

  returnVoucher(id, reason) {
    this.requireDirector();
    const r = text(sq(reason), "Lý do trả lại", true, 500);
    return this.move(id, ["pending"], "draft", "Trả lại", r, { return_reason: r });
  }

  /** Ghi «Đã chi» (ngày chi thật, mặc định hôm nay, không quá ngày mai). */
  markPaid(id, paidDate = null) {
    this.requireAccountant();
    const paid = isoDate(paidDate || todayIso(), "Ngày chi");
    const limit = new Date();
    limit.setDate(limit.getDate() + 1);
    if (paid > todayIso(limit)) throw new UserError("Ngày chi không được ở tương lai.");
    return this.move(id, ["approved"], "paid", "Đã chi", paid, { paid_at: paid, paid_by: this.me });
  }

  cancel(id, reason) {
    this.requireEdit();
    const r = text(sq(reason), "Lý do hủy", true, 500);
    return this.move(id, this.isDirector ? ["pending", "approved"] : ["draft", "pending", "approved"], "cancelled", "Hủy phiếu", r, { cancel_reason: r });
  }

  // ---- việc chờ và thông báo ----
  myPending() {
    const out = [];
    for (const r of this.active("vouchers")) {
      const last = (r.history || [])[(r.history || []).length - 1] || {};
      const base = { id: r.id, content: r.content, total: r.total, project_label: r.project_label, since: last.at || r.created_at };
      if (this.isDirector && r.state === "pending") out.push({ ...base, kind: "voucher_to_approve", by: r.created_by });
      else if (this.isAccountant) {
        if (r.state === "draft" && r.return_reason) out.push({ ...base, kind: "voucher_returned", by: last.by || "", reason: r.return_reason });
        else if (r.state === "approved") out.push({ ...base, kind: "voucher_to_pay", by: r.approved_by || "" });
      }
    }
    return out.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
  }

  myNotifications(days = 21) {
    const cutoff = isoLocal(new Date(Date.now() - days * 86400000));
    const rows = [];
    for (const r of this.active("vouchers")) {
      for (const h of r.history || []) {
        if (h.by === this.me || h.at < cutoff) continue;
        if ((this.isDirector && h.event === "Gửi duyệt") || (this.isAccountant && ["Duyệt", "Trả lại", "Hủy phiếu"].includes(h.event))) {
          rows.push({ at: h.at, by: h.by, event: h.event, note: h.note, id: r.id, content: r.content, total: r.total });
        }
      }
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  // ---- phiếu thu ----
  incomeView(r) {
    return { ...r, state_label: r.state === "active" ? "Đã ghi" : "Đã hủy", kind_label: INCOME_KINDS[r.kind] || r.kind, method_label: METHODS[r.method] || r.method,
      actions: r.state === "active" && (this.isDirector || this.isAccountant) ? ["cancel"] : [] };
  }

  incomes() {
    return this.active("incomes").map((r) => this.incomeView(r)).sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  }

  /** Ghi một phiếu thu (Trưởng phòng vật tư): có hiệu lực ngay, không cần Giám đốc duyệt. */
  saveIncome(fields) {
    this.requireAccountant();
    const projectId = String(fields.project_id || "").trim().slice(0, 20);
    if (!projectId) throw new UserError("Hãy chọn dự án đã thu tiền.");
    const net = parseMoney(fields.amount_net, "Số tiền chưa VAT");
    const vat = parseMoney(fields.vat, "Tiền VAT", true);
    if (net <= 0) throw new UserError("Số tiền chưa VAT phải lớn hơn 0.");
    if (net + vat > MAX_AMOUNT) throw new UserError("Tổng tiền quá lớn, hãy kiểm tra lại số 0.");
    const kind = String(fields.kind || ""), method = String(fields.method || "");
    if (!INCOME_KINDS[kind]) throw new UserError("Hãy chọn loại thu: tạm ứng, thanh toán sau nghiệm thu hoặc khác.");
    if (!METHODS[method]) throw new UserError("Hãy chọn hình thức thu: tiền mặt hoặc chuyển khoản.");
    const total = net + vat;
    return this.incomeView(this.create("incomes", {
      date: isoDate(fields.date, "Ngày thu"), project_id: projectId, project_label: text(sq(fields.project_label || projectId), "Tên dự án", true, 250), kind, amount_net: net, vat, total, method,
      invoice_no: text(sq(fields.invoice_no), "Số hóa đơn", false, 60), note: text(sq(fields.note), "Ghi chú", false, 500), state: "active", cancel_reason: "",
      history: [{ at: nowIso(), by: this.me, event: "Ghi thu", note: `${INCOME_KINDS[kind]}: ${String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} đ` }],
    }));
  }

  cancelIncome(id, reason) {
    this.requireEdit();
    const r = text(sq(reason), "Lý do hủy", true, 500);
    const record = this.raw("incomes", id);
    if (record.state !== "active") throw new UserError(`Phiếu thu ${id} đã hủy.`);
    return this.incomeView(this.update("incomes", id, { state: "cancelled", cancel_reason: r, history: this.event(record, "Hủy phiếu thu", r) }));
  }

  /** Dự án để chọn khi lập phiếu: chỉ mã, tên và giai đoạn (đọc từ dữ liệu dự án; kế toán không có quyền module Dự án). Dự án còn chạy xếp trước. */
  static projectLabels(pt) {
    return Object.values(pt.col("projects")).filter((p) => !p.deleted)
      .map((p) => ({ id: p.id, label: `${pt.code(p)} ${p.name}`, live: p.status !== "lost" }))
      .sort((a, b) => (a.live === b.live ? (a.label < b.label ? -1 : 1) : a.live ? -1 : 1));
  }
}
