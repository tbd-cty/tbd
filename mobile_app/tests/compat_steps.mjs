// compat_steps.mjs - Các bước chạy mã điện thoại bằng Node.js cho test_mobile_compat.py (không đưa lên mạng cùng ứng dụng).
// node compat_steps.mjs <bước> '<json tham số>'   -> in một dòng JSON kết quả.

import fs from "fs";

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
} else {
  throw new Error(`Bước lạ: ${step}`);
}

console.log(JSON.stringify(out));
