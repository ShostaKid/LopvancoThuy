// A2. Điểm danh (SPEC 7): chọn ngày + lớp, mặc định cả lớp có mặt, chạm tên để chuyển vắng, lưu 1 lần
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadTerms, loadClasses } from '../data.js';
import { formatDate, vnToday, weekdayOf, addDays, compareVnNames } from '../format.js';
import { button, busy, field, input, select, callout, toast } from '../ui.js';

// Giữ ngày và lớp đang chọn khi chuyển qua lại giữa các màn hình
const state = { date: null, classId: '' };

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
  const rosterBox = h('div');

  // Lớp có học hôm đó (theo thứ) lên đầu, lớp khác xếp dưới
  function fillClassOptions() {
    const wd = weekdayOf(state.date);
    const today = active.filter((c) => c.weekdays.includes(wd));
    const other = active.filter((c) => !c.weekdays.includes(wd));
    classSelect.replaceChildren();
    const group = (label, list) => {
      if (!list.length) return;
      const g = h('optgroup');
      g.label = label;
      for (const c of list) {
        const o = h('option', null, c.name);
        o.value = c.id;
        g.append(o);
      }
      classSelect.append(g);
    };
    if (today.length) { group('Lớp có học hôm nay', today); group('Lớp khác', other); }
    else group('Tất cả lớp', other);
    const keep = active.some((c) => c.id === state.classId) ? state.classId : (today[0] ?? active[0]).id;
    classSelect.value = keep;
    state.classId = keep;
  }

  const confirmLeave = () => !dirty || confirm('Điểm danh chưa lưu sẽ mất. Vẫn chuyển?');

  function setDate(value) {
    if (!value) { dateInput.value = state.date; return; }
    if (!confirmLeave()) { dateInput.value = state.date; return; }
    state.date = value;
    dateInput.value = value;
    fillClassOptions();
    load();
  }

  dateInput.addEventListener('change', () => setDate(dateInput.value));
  classSelect.addEventListener('change', () => {
    if (!confirmLeave()) { classSelect.value = state.classId; return; }
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
  controls.append(dateField, field('Lớp', classSelect));
  el.replaceChildren(title, controls, rosterBox);

  // Cảnh báo khi rời trang với điểm danh chưa lưu (đóng tab, tải lại). Gỡ khi màn hình bị thay.
  const guard = (e) => { if (dirty) e.preventDefault(); };
  window.addEventListener('beforeunload', guard);
  const watch = new MutationObserver(() => {
    if (!el.isConnected || !el.contains(controls)) { window.removeEventListener('beforeunload', guard); watch.disconnect(); }
  });
  watch.observe(document.getElementById('view'), { childList: true });

  async function load() {
    const token = ++loadToken;
    dirty = false;
    rosterBox.replaceChildren(h('p', 'muted', 'Đang tải danh sách…'));
    const date = state.date;
    const classId = state.classId;
    try {
      const [enrolled, session, closed] = await Promise.all([
        q(db.from('enrollments')
          .select('student_id, left_on, students(id, code, full_name, active)')
          .eq('class_id', classId).eq('term_id', current.id)),
        q(db.from('sessions')
          .select('id, attendance(student_id, present, marked_at)')
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
    const saved = new Map((session?.attendance ?? []).map((a) => [a.student_id, a.present]));

    // Em còn học lớp tại ngày đó + em đã có dòng điểm danh (giữ nguyên dù sau này nghỉ)
    const roster = new Map();
    for (const e of enrolled) {
      const stillIn = !e.left_on || e.left_on > date;
      if ((stillIn && e.students.active) || saved.has(e.student_id)) roster.set(e.student_id, e.students);
    }
    const students = [...roster.values()].sort((a, b) => compareVnNames(a.full_name, b.full_name));
    const present = new Map(students.map((s) => [s.id, saved.get(s.id) ?? true]));
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
      const n = [...present.values()].filter(Boolean).length;
      summary.replaceChildren(h('strong', null, `Có mặt ${n}/${students.length}`), h('span', 'muted', ` · Vắng ${students.length - n}`));
    };

    for (const s of students) {
      const row = h('button', 'roster__item');
      row.type = 'button';
      row.disabled = locked;
      const badge = h('span', 'pill');
      const paint = () => {
        const p = present.get(s.id);
        row.setAttribute('aria-pressed', String(p));
        row.classList.toggle('is-absent', !p);
        badge.className = 'pill ' + (p ? 'pill--success' : 'pill--danger');
        badge.textContent = p ? 'Có mặt' : 'Vắng';
      };
      row.append(h('span', 'roster__code', s.code), h('span', 'roster__name', s.full_name), badge);
      row.addEventListener('click', () => {
        present.set(s.id, !present.get(s.id));
        dirty = true;
        paint();
        updateSummary();
      });
      paint();
      list.append(row);
    }
    updateSummary();

    const allPresent = button('Đánh dấu cả lớp có mặt', 'outline btn--sm', () => {
      for (const s of students) present.set(s.id, true);
      dirty = true;
      list.querySelectorAll('.roster__item').forEach((r) => { r.setAttribute('aria-pressed', 'true'); r.classList.remove('is-absent'); const p = r.querySelector('.pill'); p.className = 'pill pill--success'; p.textContent = 'Có mặt'; });
      updateSummary();
    });
    allPresent.disabled = locked;

    const error = h('p', 'form-error');
    saveBtn.addEventListener('click', () => busy(saveBtn, error, async () => {
      const records = students.map((s) => ({ student_id: s.id, present: present.get(s.id) }));
      const res = await q(db.rpc('save_attendance', { p_class_id: classId, p_date: date, p_records: records }));
      const n = records.filter((r) => r.present).length;
      dirty = false;
      toast(`Đã lưu ${className} ngày ${formatDate(date)}: có mặt ${n}, vắng ${res.saved - n}.`);
      load();
    }));

    const bar = h('div', 'attendance-bar');
    bar.append(summary, saveBtn);
    const head = h('div', 'section__head');
    head.append(h('span', 'muted small', 'Chạm vào tên để chuyển Có mặt ↔ Vắng.'), allPresent);
    rosterBox.replaceChildren(...parts, head, list, error, bar);
  }

  fillClassOptions();
  load();
}
