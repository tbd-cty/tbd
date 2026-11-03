// attendance.js - Chấm công của Trưởng nhóm trên điện thoại, chép đúng modules/attendance/service.py (cùng file dữ liệu với máy tính).
// Trưởng nhóm tick công nhân đi làm (kèm tăng ca ½ công hoặc 1 công) khi ghi nhật ký «Hôm nay tôi đang làm». Xác nhận và chốt tháng làm trên máy tính.

import { ModuleData, UserError, nowIso, text, todayIso } from "./base.js";

export const SPEC = { id: "attendance", schema: 1, label: "Chấm công", collections: { people: "NS", days: "CC", periods: "KC" } };
export const OT_VALUES = [0, 0.5, 1];
export const EDIT_DAYS_BACK = 3;
const KINDS = { official: "Chính thức", seasonal: "Thời vụ" };
const NO_PROJECT_LABEL = "Không thuộc dự án";

const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayIso(d);
};

export class Attendance extends ModuleData {
  constructor(data, user, directory = []) {
    super(data, user, SPEC);
    this.directory = directory;
  }

  nameOf(username) {
    const u = (this.directory || []).find((d) => d.username === username);
    return u ? u.full_name : username;
  }

  isLeader() {
    return this.user.role === "team_leader";
  }

  /** Các ngày được chấm công: hôm nay và 3 ngày trước, mới nhất trước. */
  dates() {
    const today = todayIso();
    return [0, 1, 2, 3].map((i) => addDays(today, -i));
  }

  /** Công nhân của tổ tôi (đang dùng), xếp theo tên. */
  people(includeInactive = false) {
    return this.active("people", (r) => r.leader === this.me && (includeInactive || r.active !== false))
      .sort((a, b) => (norm(a.name) < norm(b.name) ? -1 : norm(a.name) > norm(b.name) ? 1 : 0));
  }

  nameFree(name, excludeId = null) {
    for (const o of this.active("people")) {
      if (o.id !== excludeId && o.active !== false && norm(o.name) === norm(name)) throw new UserError(`Đã có «${o.name}» trong danh sách nhân sự.`);
    }
  }

  /** Thêm một hoặc nhiều công nhân vào tổ của tôi (mỗi dòng một họ tên). Một dòng lỗi thì không thêm ai. */
  addPeople(block, kind = "seasonal") {
    this.requireEdit();
    if (!this.isLeader()) throw new UserError("Chỉ Trưởng nhóm thêm công nhân vào tổ của mình trên điện thoại.");
    if (!KINDS[kind]) throw new UserError("Loại nhân sự phải là chính thức hoặc thời vụ.");
    const names = String(block || "").split("\n").filter((l) => l.trim()).map((l) => text(l.split(/\s+/).filter(Boolean).join(" "), "Họ tên", true, 80));
    if (!names.length) throw new UserError("Hãy nhập ít nhất một họ tên (mỗi dòng một người).");
    const seen = new Set();
    for (const n of names) {
      if (seen.has(norm(n))) throw new UserError(`«${n}» bị ghi hai lần.`);
      seen.add(norm(n));
      this.nameFree(n);
    }
    return names.map((name) => this.create("people", { name, kind, leader: this.me, linked_username: "", active: true }));
  }

  myDay(dayIso = todayIso()) {
    return this.active("days", (r) => r.leader === this.me && r.date === dayIso)[0] || null;
  }

  /** Các ngày công gần đây của tôi, mới nhất trước. */
  recentDays(limit = 7) {
    return this.active("days", (r) => r.leader === this.me).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
  }

  locked(month) {
    return this.active("periods", (p) => p.month === month && p.locked).length > 0;
  }

  /** Trưởng nhóm chấm công cả tổ cho một ngày (hôm nay hoặc 3 ngày trước): dự án chung, nội dung nhật ký, người đi làm kèm tăng ca 0, 0.5 hoặc 1. Ghi lại cùng ngày thì cập nhật. */
  saveDay(dayIso, projectId, projectLabel, textValue, entries, leaderOvertime = 0) {
    this.requireEdit();
    if (!this.isLeader()) throw new UserError("Chỉ Trưởng nhóm chấm công cho tổ của mình.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayIso || ""))) throw new UserError("Ngày chấm công không hợp lệ.");
    const today = todayIso();
    if (dayIso > today) throw new UserError("Không chấm công cho ngày chưa tới.");
    if (dayIso < addDays(today, -EDIT_DAYS_BACK)) throw new UserError(`Chỉ chấm công cho hôm nay và ${EDIT_DAYS_BACK} ngày trước. Ngày cũ hơn hãy nhờ Trưởng phòng vật tư.`);
    if (this.locked(dayIso.slice(0, 7))) throw new UserError("Tháng này đã chốt công, không sửa được. Hãy nhờ Trưởng phòng vật tư mở khóa.");
    const existing = this.myDay(dayIso);
    if (existing && existing.state === "confirmed") throw new UserError("Ngày công này đã được Trưởng phòng dự án xác nhận. Nhờ họ bỏ xác nhận nếu cần sửa.");
    const ot = (v) => {
      const n = Number(v || 0);
      if (!OT_VALUES.includes(n)) throw new UserError("Tăng ca chỉ có thể là không, nửa công hoặc một công.");
      return n;
    };
    const previous = new Set(existing ? existing.entries.map((e) => e.person_id) : []);
    const clean = [], seen = new Set();
    for (const raw of entries || []) {
      const pid = String(raw.person_id || "");
      if (seen.has(pid)) throw new UserError("Một người không được chấm hai lần trong ngày.");
      seen.add(pid);
      const person = this.raw("people", pid);
      if (person.leader !== this.me) throw new UserError(`«${person.name}» không thuộc tổ của bạn.`);
      if (person.active === false && !previous.has(pid)) throw new UserError(`«${person.name}» đã ngừng sử dụng.`);
      for (const other of this.active("days", (d) => d.date === dayIso && d.leader !== this.me)) {
        if (other.entries.some((e) => e.person_id === pid)) throw new UserError(`«${person.name}» đã được ${this.nameOf(other.leader)} chấm công ngày này.`);
      }
      clean.push({ person_id: pid, person_name: person.name, overtime: ot(raw.overtime), project_id: String(raw.project_id || "").slice(0, 20), project_label: text(raw.project_label, "Tên dự án", false, 250) });
    }
    const pid = String(projectId || "").trim().slice(0, 20);
    const fields = {
      project_id: pid, project_label: pid ? text(projectLabel || pid, "Tên dự án", true, 250) : NO_PROJECT_LABEL,
      text: text(String(textValue || "").split(/\s+/).filter(Boolean).join(" "), "Nội dung nhật ký", true, 300), entries: clean, leader_overtime: ot(leaderOvertime),
    };
    if (existing) {
      return this.update("days", existing.id, { ...fields, history: [...(existing.history || []), { at: nowIso(), by: this.me, event: "Sửa", note: fields.text }] });
    }
    return this.create("days", {
      leader: this.me, date: dayIso, ...fields, state: "open", confirmed_by: "", confirmed_at: "",
      history: [{ at: nowIso(), by: this.me, event: "Chấm công", note: fields.text }],
    });
  }
}
