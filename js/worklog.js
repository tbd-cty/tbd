// worklog.js - Nhật ký làm việc «Hôm nay tôi đang làm», chép đúng modules/worklog/service.py (cùng file dữ liệu với máy tính).
// Mỗi người một bản ghi cho mỗi ngày; ghi lại trong ngày thì cập nhật bản ghi đó (giữ giờ bắt đầu).

import { ModuleData, UserError, nowIso, todayIso } from "./base.js";

export const SPEC = { id: "worklog", schema: 1, label: "Nhật ký làm việc", collections: { entries: "NK" } };

export class Worklog extends ModuleData {
  constructor(data, user) {
    super(data, user, SPEC);
  }

  mineToday() {
    const today = todayIso();
    return this.active("entries", (e) => e.user === this.me && e.date === today)[0] || null;
  }

  setToday(text, projectId = "", taskId = "") {
    this.requireEdit();
    text = String(text || "").split(/\s+/).filter(Boolean).join(" ");
    if (!text) throw new UserError("Hãy ghi hôm nay bạn đang làm gì.");
    if (text.length > 300) throw new UserError("Nội dung quá dài (tối đa 300 ký tự).");
    const fields = { text, project_id: String(projectId || "").slice(0, 20), task_id: String(taskId || "").slice(0, 20), source: "mobile" };
    const existing = this.mineToday();
    if (existing) {
      if (existing.status === "confirmed") throw new UserError("Nhật ký hôm nay đã được xác nhận, không sửa được.");
      return this.update("entries", existing.id, fields);
    }
    return this.create("entries", {
      user: this.me, date: todayIso(), ...fields, started_at: nowIso(), ended_at: "", status: "open", confirmed_by: "", confirmed_at: "",
    });
  }

  /** Các ngày gần đây của tôi, mới nhất trước. */
  mine(limit = 7) {
    return this.active("entries", (e) => e.user === this.me)
      .sort((a, b) => (a.date === b.date ? (a.updated_at < b.updated_at ? 1 : -1) : a.date < b.date ? 1 : -1))
      .slice(0, limit);
  }
}
