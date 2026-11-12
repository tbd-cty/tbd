// compat_steps.mjs - Các bước chạy mã điện thoại bằng Node.js cho test_mobile_compat.py (không đưa lên mạng cùng ứng dụng).
// node compat_steps.mjs <bước> '<json tham số>'   -> in một dòng JSON kết quả.

import fs from "fs";

globalThis.TBD_OLD_FLOW = process.env.TBD_OLD_FLOW === "1";        // test_mobile_compat.py chạy dòng chảy CŨ; test_mobile_flow.py chạy dòng chảy MỚI
const [step, rawArgs] = process.argv.slice(2);
const args = JSON.parse(rawArgs);

// localStorage giả, lưu ra file để các bước sau (lần chạy Node sau) dùng lại như trên điện thoại thật
const file = args.store;
const mem = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); fs.writeFileSync(file, JSON.stringify(mem)); },
  removeItem: (k) => { delete mem[k]; fs.writeFileSync(file, JSON.stringify(mem)); },
};
Object.defineProperty(globalThis.localStorage, "length", { get: () => Object.keys(mem).length });
globalThis.localStorage.key = (i) => Object.keys(mem)[i] ?? null;

const { Session, loadStored } = await import("../js/session.js");

let touchBeforePatch = false;
const fetchFn = async (url, opts) => {
  url = String(url).replace("https://oauth2.googleapis.com", args.base).replace("https://www.googleapis.com", args.base);
  const res = await fetch(url, opts);
  if (touchBeforePatch && url.includes("alt=media")) {          // ngay sau khi điện thoại đọc xong dữ liệu: máy khác ghi xen vào
    touchBeforePatch = false;
    await fetch(`${args.base}/__test/touch`, { method: "POST", headers: { Authorization: "Bearer AT" } });
  }
  return res;
};
const driveOptions = { fetchFn, sleep: async () => {} };
const fileOf = (b64, name) => ({ name, arrayBuffer: async () => Buffer.from(b64, "base64") });
const out = {};

async function err(fn) {
  try { await fn(); return "(không lỗi)"; } catch (e) { return e.message; }
}

async function unlocked() {
  const s = await Session.unlock(args.pin, driveOptions);
  await s.refreshUser();
  return s;
}

if (step === "setup") {
  out.bad_activation = await err(() => Session.setup(args.code, "sai-mat-khau", driveOptions));
  const s = await Session.setup(args.code, args.activation, driveOptions);
  out.bad_password = await err(() => s.login(args.user, "sai"));
  out.temp_password = await err(() => s.login("cn.01", args.temp_pw || "x"));
  out.user = await s.login(args.user, args.password);
  await s.savePin(args.pin);
  out.stored_has_secret = JSON.stringify(mem).includes("REFRESH-OK") || JSON.stringify(mem).includes(s.secrets.key);
  out.bad_pin = await err(() => Session.unlock("000000", driveOptions));
  const again = await unlocked();
  out.unlocked = again.user.username;
  out.fails_after_ok = loadStored().fails;
} else if (step === "tn_work") {
  const s = await unlocked();
  const pt = await s.readPT();
  out.pending = pt.myPending().map((i) => ({ kind: i.kind, ref_id: i.ref_id }));
  out.candidates = pt.candidates("").map((u) => u.username);
  await s.editPT((m) => m.reportTask(args.task, "Đã đấu xong, chờ kiểm tra"));
  await s.editPT((m) => m.createTasks("", "Dọn kho cuối tuần", ["cn.01"], null, "Sắp xếp lại vật tư", ""));
  out.receipt = await s.submitReceipt("Mua 20m dây 2.5 cho tủ A", [fileOf(args.photos[0], "a.jpg"), fileOf(args.photos[1], "b.png")]);
} else if (step === "tp_work") {
  const s = await unlocked();
  const [pt, rc] = [await s.readPT(), await s.readRC()];
  out.pending = [...pt.myPending(), ...rc.myPending()].map((i) => ({ kind: i.kind }));
  const r = rc.view("HD-0001");
  const bytes = await s.photo(r.images[0].file_id);
  out.photo_ok = bytes.length === 256 * 50 && bytes[255] === 255;
  out.assignable = pt.assignableProjects().map((p) => p.id);
  out.candidates = pt.candidates(args.project).map((u) => u.username);
  out.notif_count = pt.myNotifications().length + rc.myNotifications().length;
  out.notif_kinds = pt.myNotifications().map((n) => n.kind);
  await s.editPT((m) => m.confirmTask(args.task));
  const proj = pt.myProjects().find((p) => p.id === args.project);
  await s.editRC((m) => m.confirm("HD-0001", proj.id, `${proj.code} ${proj.name}`, "1.250.000"));
  await s.editPT((m) => m.reportTask(args.boss_task, "Đã gặp"));
  await s.editPT((m) => m.createTasks(args.project, "Lắp máng cáp", ["ks.hien"], null, "", "2026-12-15"));
  touchBeforePatch = true;                                       // người khác ghi xen: phải tự đọc lại và làm lại
  await s.editPT((m) => m.createTasks("", "Ghi sau khi bị xen", ["ks.hien"], null, "", ""));
} else if (step === "tn_send_again") {
  const s = await unlocked();
  out.id = (await s.submitReceipt("Mua ốc vít", [fileOf(args.photo, "c.jpg")])).id;
} else if (step === "tn_resubmit") {
  const s = await unlocked();
  const rc = await s.readRC();
  out.pending_before = rc.myPending().map((i) => ({ kind: i.kind, note: i.note }));
  const r = await s.resubmitReceipt(args.id, null, [fileOf(args.photo, "d.jpg")]);
  out.state_after = r.state;
  out.images_after = r.images.length;
} else if (step === "tn_diary") {
  const s = await unlocked();
  const saved = await s.editWL((m) => m.setToday(args.text, args.project || ""));
  out.entry = { id: saved.id, user: saved.user, date: saved.date, source: saved.source, text: saved.text };
  const wl = await s.readWL();
  out.mine = wl.mineToday() && wl.mineToday().text;
} else if (step === "tn_attendance") {
  const s = await unlocked();
  out.people_before = (await s.readAT()).people().length;
  const added = await s.editAT((m) => m.addPeople("Vũ Quang Giới\nNguyễn Công Lê", "seasonal"));
  out.added = added.map((p) => ({ id: p.id, name: p.name, leader: p.leader, kind: p.kind, active: p.active }));
  out.dup = await err(() => s.editAT((m) => m.addPeople("vu quang gioi")));
  const ids = (await s.readAT()).people().map((p) => p.id);                  // xếp theo tên: Nguyễn Công Lê, Vũ Quang Giới
  const day = await s.editAT((m) => m.saveDay(args.day, args.project, args.label, "Đi dây tủ A", [{ person_id: ids[0], overtime: 0.5 }, { person_id: ids[1], overtime: 0 }], 1));
  out.day = { id: day.id, date: day.date, state: day.state, entries: day.entries.length, leader_overtime: day.leader_overtime, project_label: day.project_label };
  out.bad_ot = await err(() => s.editAT((m) => m.saveDay(args.day, "", "", "x", [{ person_id: ids[0], overtime: 0.75 }], 0)));
  out.future = await err(() => s.editAT((m) => m.saveDay(args.future, "", "", "x", [], 0)));
  out.old = await err(() => s.editAT((m) => m.saveDay(args.old, "", "", "x", [], 0)));
  out.again = (await s.editAT((m) => m.saveDay(args.day, args.project, args.label, "Đi dây tủ A và B", [{ person_id: ids[1], overtime: 0 }], 0))).id;
} else if (step === "tn_attendance_after") {
  const s = await unlocked();
  const d = (await s.readAT()).myDay(args.day);
  out.state = d.state;
  out.confirmed_by = d.confirmed_by;
  out.edit_error = await err(() => s.editAT((m) => m.saveDay(args.day, "", "", "sửa lại", [], 0)));
} else if (step === "pt_pending") {
  const s = await unlocked();
  const pt = await s.readPT();
  const { STAGE_LABELS } = await import("../js/pt.js");
  out.pending = pt.myPending().map((i) => ({ kind: i.kind, ref_id: i.ref_id }));
  out.projects = pt.myProjects().map((p) => ({ id: p.id, status: p.status }));
  out.labels = Object.fromEntries(out.projects.map((p) => [p.id, STAGE_LABELS[p.status]]));
} else if (step === "fa_do") {
  const s = await unlocked();
  const ops = {
    save_submit: (m, a) => m.submit(m.saveVoucher(a.id || null, a.fields).id),
    save: (m, a) => m.saveVoucher(a.id || null, a.fields),
    submit: (m, a) => m.submit(a.id),
    withdraw: (m, a) => m.withdraw(a.id),
    approve: (m, a) => m.approve(a.id),
    return: (m, a) => m.returnVoucher(a.id, a.reason),
    pay: (m, a) => m.markPaid(a.id, a.date || null),
    cancel: (m, a) => m.cancel(a.id, a.reason),
    income: (m, a) => m.saveIncome(a.fields),
    income_cancel: (m, a) => m.cancelIncome(a.id, a.reason),
  };
  out.error = null;
  if (args.op) {
    try {
      const v = await s.editFA((m) => ops[args.op](m, args));
      out.result = { id: v.id, state: v.state, total: v.total, actions: v.actions };
    } catch (e) {
      out.error = e.message;
    }
  }
  const fa = await s.readFA();
  out.pending = fa.myPending().map((i) => ({ kind: i.kind, id: i.id }));
  out.notes = fa.myNotifications().map((n) => [n.event, n.id]);
  out.vouchers = fa.vouchers().map((v) => ({ id: v.id, state: v.state, total: v.total, actions: v.actions, returned: v.returned, label: v.state_label }));
  out.incomes = fa.incomes().map((i) => ({ id: i.id, state: i.state, total: i.total, actions: i.actions }));
  out.links = fa.receiptLinks();
  out.categories = fa.categories().map((c) => c.name);
  const { recipientTotals } = await import("../js/finance.js");
  out.names = fa.recipientNames();
  out.owed = recipientTotals(fa.vouchers(), args.q || "").map((g) => ({ name: g.name, count: g.count, total: g.total, ids: g.ids }));
  out.search = fa.vouchers().length;
} else {
  throw new Error(`Bước lạ: ${step}`);
}

console.log(JSON.stringify(out));
