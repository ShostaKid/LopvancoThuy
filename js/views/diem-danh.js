// A2. Điểm danh (SPEC 7): chọn ngày, chỉ hiện lớp có tiết hôm đó; mặc định cả lớp có mặt,
// chạm tên để chuyển vắng, mỗi em có thể đổi Offline/Online cho riêng buổi đó; lưu 1 lần
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadTerms, loadClasses } from '../data.js';
import { formatDate, formatWeekdays, vnToday, weekdayOf, addDays, compareVnNames } from '../format.js';
import { button, busy, field, input, select, callout, toast, confirmDialog } from '../ui.js';

// Giữ ngày và lớp đang chọn khi chuyển qua lại giữa các màn hình
const state = { date: null, classId: '' };
const MODE_LABEL = { offline: 'Offline', online: 'Online' };

export async function renderDiemDanh(el) {
  const title = h('h1', 'page-title', 'Điểm danh');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let terms, classes;
  try {
    [terms, classes] = await Promise.all([loadTerms(), loadClasses()]);
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }
  const current = terms.find((t) => t.is_current);
  const active = classes.filter((c) => c.active);
  if (!current) {
    el.replaceChildren(title, callout('Chưa có khóa hiện tại. Đặt khóa hiện tại ở màn hình Lớp & khóa.', 'warning'));
    return;
  }
  if (!active.length) {
    el.replaceChildren(title, callout('Chưa có lớp nào đang dạy. Tạo lớp ở màn hình Lớp & khóa.', 'warning'));
    return;
  }

  state.date ??= vnToday();
  let dirty = false;
  let loadToken = 0;   // bỏ kết quả tải cũ nếu người dùng đã đổi ngày/lớp trong lúc chờ

  const dateInput = input('date', 'date', state.date);
  const classSelect = select('class', [], '');
  const classField = field('Lớp', classSelect);
  const rosterBox = h('div');

  const lessonsOn = (date) => active.filter((c) => c.weekdays.includes(weekdayOf(date)));

  // Ngày gần nhất (không quá hôm nay) có ít nhất 1 lớp có tiết
  function lastLessonDate() {
    for (let i = 0, d = vnToday(); i < 14; i += 1, d = addDays(d, -1)) if (lessonsOn(d).length) return d;
    return null;
  }

  function fillClassOptions() {
    const list = lessonsOn(state.date);
    classSelect.replaceChildren(...list.map((c) => { const o = h('option', null, c.name); o.value = c.id; return o; }));
    classField.hidden = !list.length;
    if (!list.length) return;
    state.classId = list.some((c) => c.id === state.classId) ? state.classId : list[0].id;
    classSelect.value = state.classId;
  }

  const confirmLeave = async () => !dirty || confirmDialog('Điểm danh chưa lưu', 'Điểm danh chưa lưu sẽ mất. Vẫn chuyển?', 'Vẫn chuyển', 'danger');

  async function setDate(value) {
    if (!value) { dateInput.value = state.date; return; }
    if (!(await confirmLeave())) { dateInput.value = state.date; return; }
    state.date = value;
    dateInput.value = value;
    fillClassOptions();
    load();
  }

  dateInput.addEventListener('change', () => setDate(dateInput.value));
  classSelect.addEventListener('change', async () => {
    if (!(await confirmLeave())) { classSelect.value = state.classId; return; }
    state.classId = classSelect.value;
    load();
  });

  const prev = button('‹', 'outline btn--sm', () => setDate(addDays(state.date, -1)));
  const next = button('›', 'outline btn--sm', () => setDate(addDays(state.date, 1)));
  const todayBtn = button('Hôm nay', 'outline btn--sm', () => setDate(vnToday()));
  prev.setAttribute('aria-label', 'Ngày trước');
  next.setAttribute('aria-label', 'Ngày sau');
  const dateRow = h('div', 'date-row');
  dateRow.append(prev, dateInput, next, todayBtn);
  const dateField = h('div', 'field');
  dateField.append(h('span', 'field__label', 'Ngày'), dateRow);

  const controls = h('div', 'card card--panel');
  controls.append(dateField, classField);
  el.replaceChildren(title, controls, rosterBox);

  // Cảnh báo khi rời trang với điểm danh chưa lưu (đóng tab, tải lại). Gỡ khi màn hình bị thay.
  const guard = (e) => { if (dirty) e.preventDefault(); };
  window.addEventListener('beforeunload', guard);
  const watch = new MutationObserver(() => {
    if (!el.isConnected || !el.contains(controls)) { window.removeEventListener('beforeunload', guard); watch.disconnect(); }
  });
  watch.observe(document.getElementById('view'), { childList: true });

  function renderNoLesson() {
    const box = h('div');
    box.append(callout(`Ngày ${formatDate(state.date)} không có lớp nào có tiết nên không điểm danh được.`, 'warning'));
    const schedule = h('ul', 'perm-list');
    for (const c of active) {
      const li = h('li');
      li.append(h('span', null, c.name), h('span', 'pill pill--muted', formatWeekdays(c.weekdays)));
      schedule.append(li);
    }
    box.append(h('p', 'muted small', 'Lịch các lớp:'), schedule);
    const last = lastLessonDate();
    if (last) box.append(h('div', 'btn-row'), button(`Đến ngày có tiết gần nhất (${formatDate(last)})`, 'primary', () => setDate(last)));
    rosterBox.replaceChildren(box);
  }

  async function load() {
    const token = ++loadToken;
    dirty = false;
    if (!lessonsOn(state.date).length) { renderNoLesson(); return; }
    rosterBox.replaceChildren(h('p', 'muted', 'Đang tải danh sách…'));
    const date = state.date;
    const classId = state.classId;
    try {
      const [enrolled, session, closed] = await Promise.all([
        q(db.from('enrollments')
          .select('student_id, left_on, students(id, code, full_name, active, mode)')
          .eq('class_id', classId).eq('term_id', current.id)),
        q(db.from('sessions')
          .select('id, attendance(student_id, present, mode, marked_at)')
          .eq('class_id', classId).eq('date', date).maybeSingle()),
        q(db.from('month_closings').select('month').eq('month', date.slice(0, 7)).maybeSingle()),
      ]);
      if (token !== loadToken) return;
      renderRoster({ date, classId, enrolled, session, closed: !!closed });
    } catch (err) {
      if (token !== loadToken) return;
      rosterBox.replaceChildren(callout(err.message, 'error'));
    }
  }

  function renderRoster({ date, classId, enrolled, session, closed }) {
    const saved = new Map((session?.attendance ?? []).map((a) => [a.student_id, a]));

    // Em còn học lớp tại ngày đó + em đã có dòng điểm danh (giữ nguyên dù sau này nghỉ)
    const roster = new Map();
    for (const e of enrolled) {
      const stillIn = !e.left_on || e.left_on > date;
      if ((stillIn && e.students.active) || saved.has(e.student_id)) roster.set(e.student_id, e.students);
    }
    const students = [...roster.values()].sort((a, b) => compareVnNames(a.full_name, b.full_name));
    const present = new Map(students.map((s) => [s.id, saved.get(s.id)?.present ?? true]));
    const mode = new Map(students.map((s) => [s.id, saved.get(s.id)?.mode ?? s.mode]));
    const className = classSelect.selectedOptions[0].textContent;
    const future = date > vnToday();

    const parts = [];
    if (closed) parts.push(callout(`Tháng ${date.slice(5, 7)}/${date.slice(0, 4)} đã chốt, không sửa được điểm danh. Muốn sửa, nhờ Admin mở lại tháng ở màn hình Học phí.`, 'warning'));
    else if (future) parts.push(callout('Ngày này chưa tới nên chưa điểm danh được.', 'warning'));
    else if (session) {
      const last = (session.attendance ?? []).map((a) => a.marked_at).sort().pop();
      const when = last ? new Date(last).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
      parts.push(callout(`Buổi này đã điểm danh${when ? ' (lưu lúc ' + when + ')' : ''}. Sửa rồi bấm Lưu để cập nhật.`, 'info'));
    }

    if (!students.length) {
      parts.push(callout('Lớp này chưa có học sinh nào trong khóa hiện tại. Thêm ở màn hình Học sinh.'));
      rosterBox.replaceChildren(...parts);
      return;
    }

    const locked = closed || future;
    const summary = h('span', 'attendance-bar__sum');
    const list = h('div', 'roster');
    const saveBtn = button('Lưu điểm danh', 'primary');
    saveBtn.disabled = locked;

    const updateSummary = () => {
      const here = students.filter((s) => present.get(s.id));
      const online = here.filter((s) => mode.get(s.id) === 'online').length;
      summary.replaceChildren(
        h('strong', null, `Có mặt ${here.length}/${students.length}`),
        h('span', 'muted', ` · Vắng ${students.length - here.length}`),
        ...(online ? [h('span', 'muted', ` · Online ${online}`)] : []),
      );
    };

    const rows = students.map((s) => {
      const row = h('div', 'roster__item');
      const main = h('button', 'roster__main');
      main.type = 'button';
      main.disabled = locked;
      const badge = h('span', 'pill');
      main.append(h('span', 'roster__code', s.code), h('span', 'roster__name', s.full_name), badge);

      const modeBtn = h('button', 'roster__mode');
      modeBtn.type = 'button';
      modeBtn.disabled = locked;

      const paint = () => {
        const p = present.get(s.id);
        main.setAttribute('aria-pressed', String(p));
        row.classList.toggle('is-absent', !p);
        badge.className = 'pill ' + (p ? 'pill--success' : 'pill--danger');
        badge.textContent = p ? 'Có mặt' : 'Vắng';
        modeBtn.textContent = MODE_LABEL[mode.get(s.id)];
        modeBtn.classList.toggle('is-online', mode.get(s.id) === 'online');
        modeBtn.setAttribute('aria-label', `Hình thức học của ${s.full_name}: ${MODE_LABEL[mode.get(s.id)]}. Chạm để đổi.`);
      };
      main.addEventListener('click', () => { present.set(s.id, !present.get(s.id)); dirty = true; paint(); updateSummary(); });
      modeBtn.addEventListener('click', () => { mode.set(s.id, mode.get(s.id) === 'online' ? 'offline' : 'online'); dirty = true; paint(); updateSummary(); });
      row.append(main, modeBtn);
      paint();
      list.append(row);
      return paint;
    });
    updateSummary();

    const allPresent = button('Đánh dấu cả lớp có mặt', 'outline btn--sm', () => {
      for (const s of students) present.set(s.id, true);
      dirty = true;
      rows.forEach((paint) => paint());
      updateSummary();
    });
    allPresent.disabled = locked;

    const error = h('p', 'form-error');
    saveBtn.addEventListener('click', () => busy(saveBtn, error, async () => {
      const records = students.map((s) => ({ student_id: s.id, present: present.get(s.id), mode: mode.get(s.id) }));
      const res = await q(db.rpc('save_attendance', { p_class_id: classId, p_date: date, p_records: records }));
      const n = records.filter((r) => r.present).length;
      dirty = false;
      toast(`Đã lưu ${className} ngày ${formatDate(date)}: có mặt ${n}, vắng ${res.saved - n}.`);
      load();
    }));

    const bar = h('div', 'attendance-bar');
    bar.append(summary, saveBtn);
    const head = h('div', 'section__head');
    head.append(h('span', 'muted small', 'Chạm vào tên để đổi Có mặt ↔ Vắng. Nút bên phải đổi Offline ↔ Online cho buổi này.'), allPresent);
    rosterBox.replaceChildren(...parts, head, list, error, bar);
  }

  fillClassOptions();
  load();
}
