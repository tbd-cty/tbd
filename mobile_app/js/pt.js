// pt.js - Phần giao việc của module Dự án (project_tracking), chép đúng quy tắc của modules/project_tracking/service.py:
// chuỗi giao việc Giám đốc -> Trưởng phòng -> Trưởng nhóm -> Công nhân, «tích - xác nhận», việc ngoài dự án chỉ giao cấp dưới trực tiếp.
// Sửa quy tắc ở Python thì sửa cả ở đây (test_mobile_compat.py kiểm tra hai bên khớp nhau).

import { ModuleData, UserError, nowIso, text, todayIso } from "./base.js";

export const SPEC = { id: "project_tracking", schema: 3, label: "Dự án",
  collections: { projects: "DA", tasks: "CV", surveys: "KS", site_logs: "NK", maintenance: "BT" } };

export const OPEN = "open", REPORTED = "reported", DONE = "done";
export const STATE_LABELS = { open: "Đang làm", reported: "Chờ xác nhận", done: "Đã hoàn thành" };
export const STAGE_LABELS = {
  new: "Mới tạo", planning: "Đang triển khai", surveying: "Đang khảo sát", quoting: "Đang lập báo giá",
  quote_review: "Chờ Giám đốc duyệt giá", negotiating: "Đã gửi khách / đàm phán", ordered: "Đã đặt hàng",
  procurement: "Đang mua vật tư", construction: "Đang thi công", acceptance: "Nghiệm thu / chờ thanh toán",
  maintenance: "Bảo trì sau nghiệm thu", closed: "Kết thúc", lost: "Khách từ chối / hủy",
};
const TERMINAL = new Set(["closed", "lost"]);
export const CHAIN = { director: "dept_head", dept_head: "team_leader", team_leader: "worker" };
export const ROLE_LABELS = { director: "Giám đốc", dept_head: "Trưởng phòng", team_leader: "Trưởng nhóm", worker: "Công nhân / Kỹ thuật viên",
  staff: "Nhân viên", purchasing_head: "Trưởng phòng vật tư", purchaser: "Nhân viên mua hàng", storekeeper: "Thủ kho" };
const DIRECTOR_STAGE_ITEMS = { new: "assign", quote_review: "review_quote", negotiating: "negotiate" };
const MANAGER_STAGE_ITEMS = { planning: "start_plan", quoting: "make_quote" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value, label) {
  const t = value == null ? "" : String(value).trim();
  if (!t) return "";
  if (!DATE_RE.test(t) || isNaN(new Date(t + "T00:00:00").getTime())) throw new UserError(`${label} không phải một ngày hợp lệ.`);
  return t;
}

export class ProjectTracking extends ModuleData {
  constructor(data, user, directory) {
    super(data, user, SPEC);
    this.directory = Object.fromEntries((directory || []).filter((u) => u.active !== false).map((u) => [u.username, u]));
  }

  get isDirector() {
    return this.user.role === "director";
  }

  standalone() {
    return { id: "", code: "", name: "Việc ngoài dự án", status: "planning", manager: "", status_history: [], created_at: "" };
  }

  isManager(p) {
    return !!p.manager && p.manager === this.me;
  }

  involved(p) {
    if (this.isDirector || this.isManager(p)) return true;
    for (const c of ["tasks", "surveys"]) {
      for (const r of this.active(c, (r) => r.project_id === p.id)) if (r.assignee === this.me || r.assigner === this.me) return true;
    }
    return false;
  }

  isSuperiorOf(username) {
    let cur = this.directory[username], hops = 0;
    while (cur && cur.supervisor && hops < 8) {
      if (cur.supervisor === this.me) return true;
      cur = this.directory[cur.supervisor];
      hops++;
    }
    return false;
  }

  project(id) {
    if (id === "") return this.standalone();
    const p = this.raw("projects", id);
    if (!this.involved(p)) throw new UserError("Bạn không có quyền truy cập dự án này.");
    return p;
  }

  code(p) {
    return p.id === "" ? "" : p.code || p.id;
  }

  taskVisible(t, p) {
    if (this.isDirector || this.isManager(p) || t.assignee === this.me || t.assigner === this.me) return true;
    return p.id === "" && this.isSuperiorOf(t.assigner);
  }

  children(id) {
    return this.active("tasks", (r) => r.parent_id === id);
  }

  name(username) {
    return (this.directory[username] || {}).full_name || username || "";
  }

  // ---------------- dự án ----------------
  myProjects() {
    return this.active("projects", (p) => this.involved(p) && !TERMINAL.has(p.status))
      .map((p) => ({ id: p.id, code: this.code(p), name: p.name, status: p.status, manager: p.manager }));
  }

  /** Dự án tôi được giao việc MỚI ở cấp đầu: Giám đốc - dự án đã có Trưởng phòng; Trưởng phòng - dự án mình phụ trách. */
  assignableProjects() {
    return this.myProjects().filter((p) => this.rootTaskRole(p.id));
  }

  rootTaskRole(projectId) {
    const p = this.project(projectId);
    if (projectId === "") return CHAIN[this.user.role] || "";
    if (TERMINAL.has(p.status)) return "";
    if (this.isDirector) return p.manager ? "dept_head" : "";
    if (this.user.role === "dept_head" && this.isManager(p)) return "team_leader";
    return "";
  }

  /** Người nhận được (giống AppController.assignee_candidates). */
  candidates(projectId, parentId = null) {
    const next = CHAIN[this.user.role];
    if (!next) return [];
    const people = Object.values(this.directory);
    const byName = (a, b) => a.full_name.localeCompare(b.full_name, "vi");
    if (projectId === "") return people.filter((u) => u.role === next && (this.isDirector || u.supervisor === this.me)).sort(byName);
    if (this.isDirector && !parentId) {
      const manager = this.project(projectId).manager;
      return people.filter((u) => u.username === manager);
    }
    return people.filter((u) => u.role === next).sort(byName);
  }

  // ---------------- công việc ----------------
  checkAssignee(username, role, p, rootOfDirector) {
    const person = this.directory[username];
    if (!person) throw new UserError(`Người dùng «${username}» không tồn tại hoặc đã bị khóa.`);
    if (person.role !== role) throw new UserError(`«${person.full_name}» không đúng cấp để nhận việc này.`);
    if (rootOfDirector && p.manager !== username) throw new UserError("Giám đốc chỉ giao việc cho Trưởng phòng phụ trách dự án này.");
  }

  createTask(projectId, title, assignee, parentId = null, description = "", dueDate = "") {
    this.requireEdit();
    const p = this.project(projectId);
    if (TERMINAL.has(p.status)) throw new UserError(`Dự án đã «${STAGE_LABELS[p.status]}», không thể thay đổi thêm.`);
    title = text(title, "Tiêu đề công việc", true, 200);
    description = text(description, "Mô tả công việc", false, 4000);
    const due = checkDate(dueDate, "Hạn hoàn thành");
    const role = this.user.role, standalone = projectId === "";
    let directorRoot = false;
    if (!parentId) {
      if (standalone) {
        if (!CHAIN[role]) throw new UserError("Công nhân không giao việc xuống cấp dưới.");
      } else if (role === "director") {
        directorRoot = true;
      } else if (!(role === "dept_head" && this.isManager(p))) {
        throw new UserError("Chỉ Giám đốc hoặc Trưởng phòng phụ trách dự án mới giao việc mới ở cấp đầu.");
      }
    } else {
      const parent = this.raw("tasks", parentId);
      if (parent.project_id !== projectId) throw new UserError("Việc lớn không thuộc dự án này.");
      if (parent.assignee !== this.me) throw new UserError("Chỉ người nhận việc mới được chia nhỏ việc này cho cấp dưới.");
      if (parent.state !== OPEN) throw new UserError("Việc lớn đã báo cáo hoặc hoàn thành, không thêm việc nhỏ được.");
    }
    const next = CHAIN[role];
    if (!next) throw new UserError("Công nhân không giao việc xuống cấp dưới.");
    this.checkAssignee(assignee, next, p, directorRoot);
    if (standalone) {
      const person = this.directory[assignee];
      if (person && !this.isDirector && person.supervisor !== this.me) throw new UserError("Việc ngoài dự án chỉ giao được cho cấp dưới trực tiếp của bạn.");
    }
    return this.create("tasks", {
      project_id: projectId, parent_id: parentId || null, title, description, assigner: this.me, assignee, due_date: due, state: OPEN,
      result_note: "", reported_at: "", confirmed_by: "", confirmed_at: "",
      history: [{ at: nowIso(), by: this.me, event: "Giao việc", note: assignee }],
    });
  }

  /** Giao cùng một việc cho nhiều người (mỗi người một việc), tất cả hoặc không ai. */
  createTasks(projectId, title, assignees, parentId, description, dueDate) {
    const names = [...new Set(assignees.filter(Boolean))];
    if (!names.length) throw new UserError("Hãy chọn ít nhất một người nhận việc.");
    return names.map((a) => this.createTask(projectId, title, a, parentId, description, dueDate));
  }

  guard(id) {
    this.requireEdit();
    const t = this.raw("tasks", id);
    const p = this.project(t.project_id);
    if (TERMINAL.has(p.status)) throw new UserError(`Dự án đã «${STAGE_LABELS[p.status]}», không thể thay đổi thêm.`);
    return t;
  }

  reportTask(id, note = "") {
    const t = this.guard(id);
    if (t.assignee !== this.me) throw new UserError("Chỉ người được giao mới báo cáo được.");
    const pending = this.children(id).filter((c) => c.state !== DONE);
    if (pending.length) throw new UserError(`Còn ${pending.length} việc nhỏ chưa được xác nhận hoàn thành.`);
    if (t.state !== OPEN) throw new UserError("Việc này đã được báo cáo hoặc đã hoàn thành.");
    note = text(note, "Ghi chú kết quả", false, 1000);
    return this.update("tasks", id, { state: REPORTED, result_note: note, reported_at: nowIso(), history: this.event(t, "Báo cáo xong", note) });
  }

  withdrawTask(id) {
    const t = this.guard(id);
    if (t.assignee !== this.me) throw new UserError("Chỉ người được giao mới báo cáo được.");
    if (t.state !== REPORTED) throw new UserError("Chỉ rút lại được báo cáo đang chờ xác nhận.");
    return this.update("tasks", id, { state: OPEN, reported_at: "", history: this.event(t, "Rút lại báo cáo") });
  }

  confirmTask(id) {
    const t = this.guard(id);
    if (t.assigner !== this.me) throw new UserError("Chỉ người giao việc mới được xác nhận hoàn thành.");
    if (t.state !== REPORTED) throw new UserError("Chỉ xác nhận được việc đã được báo cáo xong.");
    return this.update("tasks", id, { state: DONE, confirmed_by: this.me, confirmed_at: nowIso(), history: this.event(t, "Xác nhận hoàn thành") });
  }

  returnTask(id, reason) {
    const t = this.guard(id);
    if (t.assigner !== this.me) throw new UserError("Chỉ người giao việc mới được trả lại.");
    if (t.state !== REPORTED) throw new UserError("Chỉ trả lại được việc đang chờ xác nhận.");
    reason = text(reason, "Lý do trả lại", true, 1000);
    return this.update("tasks", id, { state: OPEN, reported_at: "", history: this.event(t, "Trả lại làm lại", reason) });
  }

  deleteTask(id) {
    const t = this.guard(id);
    if (t.assigner !== this.me) throw new UserError("Chỉ người giao việc mới được xóa công việc này.");
    if (t.state !== OPEN) throw new UserError("Việc đã báo cáo hoặc hoàn thành, không xóa được.");
    if (this.children(id).length) throw new UserError("Việc đã chia nhỏ, hãy xóa các việc nhỏ trước.");
    this.remove("tasks", id);
  }

  actions(t, p, kids) {
    if (TERMINAL.has(p.status)) return [];
    const out = [];
    if (t.assigner === this.me && t.state === OPEN) {
      out.push("edit");
      if (!kids.length) out.push("delete");
    }
    if (t.assignee === this.me) {
      if (t.state === OPEN) {
        if (CHAIN[this.user.role]) out.push("split");
        if (kids.every((c) => c.state === DONE)) out.push("report");
      } else if (t.state === REPORTED) out.push("withdraw");
    }
    if (t.assigner === this.me && t.state === REPORTED) out.push("confirm", "return");
    return out;
  }

  taskView(id) {
    const t = this.raw("tasks", id);
    const p = this.project(t.project_id);
    if (!this.taskVisible(t, p)) throw new UserError("Bạn không có quyền xem công việc này.");
    const kids = this.children(id);
    const visibleKids = kids.filter((k) => this.taskVisible(k, p));
    const today = todayIso();
    return { ...structuredClone(t), project_code: this.code(p), project_name: p.name, actions: this.actions(t, p, kids),
      overdue: t.state === OPEN && !!t.due_date && t.due_date < today,
      children: visibleKids.map((k) => ({ id: k.id, title: k.title, assignee: k.assignee, state: k.state })),
      parent_title: t.parent_id && this.col("tasks")[t.parent_id] ? this.col("tasks")[t.parent_id].title : "" };
  }

  /** Mọi việc tôi giao hoặc được giao (kể cả đã xong), mới nhất trước - cho thẻ «Tất cả việc». */
  myTasks() {
    const out = [];
    for (const t of this.active("tasks")) {
      if (t.assignee !== this.me && t.assigner !== this.me) continue;
      let p;
      try { p = this.project(t.project_id); } catch (e) { continue; }
      out.push({ id: t.id, title: t.title, state: t.state, assignee: t.assignee, assigner: t.assigner, due_date: t.due_date,
        project_code: this.code(p), project_name: p.name, updated_at: t.updated_at, terminal: TERMINAL.has(p.status) });
    }
    return out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  // ---------------- việc đang chờ tôi + thông báo (giống my_pending_items / my_notifications) ----------------
  static lastEvent(rec, event) {
    const h = rec.history || [];
    for (let i = h.length - 1; i >= 0; i--) if (h[i].event === event) return h[i];
    return null;
  }

  myPending() {
    const me = this.me, today = todayIso(), out = [];
    const taskItems = (pid, base) => {
      for (const t of this.active("tasks", (r) => r.project_id === pid)) {
        if (t.assignee === me && t.state === OPEN) {
          const back = ProjectTracking.lastEvent(t, "Trả lại làm lại");
          out.push({ ...base, kind: back ? "returned" : "todo", ref_type: "task", ref_id: t.id, title: t.title, other: t.assigner,
            since: back ? back.at : t.created_at, due: t.due_date, overdue: !!t.due_date && t.due_date < today, note: back ? back.note : "",
            pending_children: this.children(t.id).filter((c) => c.state !== DONE).length });
        } else if (t.assigner === me && t.state === REPORTED) {
          out.push({ ...base, kind: "to_confirm", ref_type: "task", ref_id: t.id, title: t.title, other: t.assignee, since: t.reported_at,
            due: t.due_date, overdue: false, note: t.result_note, pending_children: 0 });
        }
      }
    };
    for (const p of this.active("projects")) {
      if (TERMINAL.has(p.status) || !this.involved(p)) continue;
      const base = { project_id: p.id, project_code: this.code(p), project_name: p.name };
      const hist = p.status_history || [];
      if (this.isDirector && DIRECTOR_STAGE_ITEMS[p.status]) {
        out.push({ ...base, kind: DIRECTOR_STAGE_ITEMS[p.status], ref_type: "project", ref_id: p.id, title: p.name, other: p.manager || "",
          since: hist.length ? hist[hist.length - 1].at : p.created_at, due: "", overdue: false, note: "", pending_children: 0 });
      }
      if (p.manager === me && !this.isDirector && MANAGER_STAGE_ITEMS[p.status]) {
        const last = hist.length ? hist[hist.length - 1] : {};
        let kind = MANAGER_STAGE_ITEMS[p.status], note = "";
        if (kind === "make_quote" && ["quote_review", "negotiating"].includes(last.from)) { kind = "quote_returned"; note = last.note || ""; }
        out.push({ ...base, kind, ref_type: "project", ref_id: p.id, title: p.name, other: last.by || "", since: last.at || p.created_at,
          due: "", overdue: false, note, pending_children: 0 });
      }
      taskItems(p.id, base);
      for (const sv of this.active("surveys", (r) => r.project_id === p.id)) {
        if (sv.assignee === me && sv.state === OPEN) {
          const back = ProjectTracking.lastEvent(sv, "Trả lại làm lại");
          out.push({ ...base, kind: back ? "survey_returned" : "survey_todo", ref_type: "survey", ref_id: sv.id, title: sv.title, other: sv.assigner,
            since: back ? back.at : sv.created_at, due: sv.deadline, overdue: !!sv.deadline && sv.deadline < today, note: back ? back.note : "", pending_children: 0 });
        } else if (sv.assigner === me && sv.state === REPORTED) {
          out.push({ ...base, kind: "survey_to_confirm", ref_type: "survey", ref_id: sv.id, title: sv.title, other: sv.assignee, since: sv.reported_at,
            due: sv.deadline, overdue: false, note: sv.result_note, pending_children: 0 });
        }
      }
    }
    taskItems("", { project_id: "", project_code: "", project_name: "Việc ngoài dự án" });
    const order = { assign: 0, review_quote: 0, negotiate: 0, to_confirm: 0, survey_to_confirm: 0, quote_returned: 0,
      returned: 1, survey_returned: 1, start_plan: 1, make_quote: 1, todo: 2, survey_todo: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind] || (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
  }

  myNotifications(days = 21, limit = 40) {
    const me = this.me, boss = this.isDirector;
    const cutoff = nowIso(new Date(Date.now() - days * 86400000));
    const rows = [];
    for (const p of this.active("projects")) {
      if (!this.involved(p)) continue;
      const base = { project_id: p.id, project_code: this.code(p), project_name: p.name };
      for (const h of p.status_history || []) {
        if (h.by !== me && h.from && h.at >= cutoff) rows.push({ ...base, at: h.at, by: h.by, kind: "stage", ref_type: "project", ref_id: p.id,
          title: p.name, assigner: "", assignee: "", to: h.to, note: h.note });
      }
      for (const [c, refType] of [["tasks", "task"], ["surveys", "survey"]]) {
        for (const rec of this.active(c, (r) => r.project_id === p.id)) {
          if (!(boss || rec.assigner === me || rec.assignee === me)) continue;
          for (const h of rec.history || []) {
            if (h.by === me || h.at < cutoff) continue;
            rows.push({ ...base, at: h.at, by: h.by, kind: h.event, ref_type: refType, ref_id: rec.id, title: rec.title,
              assigner: rec.assigner, assignee: rec.assignee, to: "", note: h.note });
          }
        }
      }
    }
    const base0 = { project_id: "", project_code: "", project_name: "Việc ngoài dự án" };
    for (const rec of this.active("tasks", (r) => r.project_id === "")) {
      if (!(boss || rec.assigner === me || rec.assignee === me || this.isSuperiorOf(rec.assigner))) continue;
      for (const h of rec.history || []) {
        if (h.by === me || h.at < cutoff) continue;
        rows.push({ ...base0, at: h.at, by: h.by, kind: h.event, ref_type: "task", ref_id: rec.id, title: rec.title,
          assigner: rec.assigner, assignee: rec.assignee, to: "", note: h.note });
      }
    }
    rows.forEach((r, i) => (r.seq = i));
    rows.sort((a, b) => (a.at === b.at ? b.seq - a.seq : a.at < b.at ? 1 : -1));
    return rows.slice(0, limit);
  }
}
