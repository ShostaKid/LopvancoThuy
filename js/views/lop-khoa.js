// A4. Lớp & khóa (SPEC 7): CRUD lớp, tạo khóa, đặt khóa hiện tại, chuyển khóa
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadTerms, loadClasses, loadEnrollments, loadBankAccounts } from '../data.js';
import { formatDate, formatWeekdays, vnToday, WEEKDAYS, WEEKDAY_LABELS } from '../format.js';
import { openDialog, button, busy, field, group, input, select, checkbox, chipGroup, callout, toast, confirmDialog } from '../ui.js';

const MODE_LABELS = { online: 'Online', offline: 'Offline' };
let showInactive = false;   // giữ lựa chọn khi vẽ lại

export async function renderLopKhoa(el) {
  const title = h('h1', 'page-title', 'Lớp & khóa');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let terms, classes, enrollments, accounts;
  try {
    [terms, classes, accounts] = await Promise.all([loadTerms(), loadClasses(), loadBankAccounts()]);
    const current = terms.find((t) => t.is_current);
    enrollments = current ? await loadEnrollments(current.id) : [];
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }

  const refresh = () => renderLopKhoa(el);
  const current = terms.find((t) => t.is_current);
  el.replaceChildren(
    title,
    classesSection(classes, enrollments, current, refresh, accounts),
    termsSection(terms, refresh),
    transferSection(terms, classes, refresh),
  );
}

function sectionHead(titleText, ...actions) {
  const head = h('div', 'section__head');
  head.append(h('h2', 'section__title', titleText), ...actions);
  return head;
}

// ---------------- Lớp ----------------

function classesSection(classes, enrollments, current, refresh, accounts) {
  const section = h('section', 'section');
  section.append(sectionHead('Lớp', button('+ Thêm lớp', 'primary', () => classDialog(null, refresh, accounts))));

  const size = new Map();
  for (const e of enrollments) if (!e.left_on) size.set(e.class_id, (size.get(e.class_id) ?? 0) + 1);

  const inactiveCount = classes.filter((c) => !c.active).length;
  const shown = classes.filter((c) => showInactive || c.active);

  if (!shown.length) {
    section.append(callout('Chưa có lớp nào. Bấm “+ Thêm lớp” để tạo.'));
  } else {
    const table = h('table', 'table');
    const head = h('tr');
    // Bấm vào tên lớp để sửa; điện thoại ẩn Khối, Hình thức cho bảng vừa màn hình
    head.append(h('th', null, 'Lớp'), h('th', 'hide-sm', 'Khối'), h('th', 'hide-sm', 'Hình thức'), h('th', null, 'Thứ học'),
      h('th', 'num', current ? `Sĩ số ${current.name}` : 'Sĩ số'));
    table.append(h('thead'), h('tbody'));
    table.tHead.append(head);
    for (const c of shown) {
      const tr = h('tr', c.active ? null : 'is-muted');
      const nameCell = h('td');
      nameCell.append(button(c.name, 'link', () => classDialog(c, refresh, accounts)));
      if (!c.active) nameCell.append(h('span', 'pill pill--muted pill--sm', 'Đã ngừng'));
      tr.append(
        nameCell,
        h('td', 'hide-sm', String(c.grade)),
        h('td', 'hide-sm', MODE_LABELS[c.mode]),
        h('td', null, formatWeekdays(c.weekdays)),
        h('td', 'num', String(size.get(c.id) ?? 0)),
      );
      table.tBodies[0].append(tr);
    }
    const wrap = h('div', 'table-wrap');
    wrap.append(table);
    section.append(wrap);
  }

  if (inactiveCount) {
    const toggle = checkbox(`Hiện cả lớp đã ngừng dạy (${inactiveCount})`, showInactive);
    toggle.box.addEventListener('change', () => { showInactive = toggle.box.checked; refresh(); });
    section.append(toggle.el);
  }
  return section;
}

function classDialog(cls, refresh, accounts) {
  const d = openDialog(cls ? `Sửa lớp ${cls.name}` : 'Thêm lớp');
  const name = input('text', 'name', cls?.name);
  name.placeholder = 'VD: Lớp 9A, 9 Chuyên Văn';
  const grade = select('grade', [8, 9, 10, 11, 12].map((g) => [String(g), `Khối ${g}`]), String(cls?.grade ?? 9));
  const mode = select('mode', [['offline', 'Offline (học tại lớp)'], ['online', 'Online (Zoom)']], cls?.mode ?? 'offline');
  const days = chipGroup(WEEKDAYS.map((n) => [String(n), WEEKDAY_LABELS[n]]), (cls?.weekdays ?? []).map(String));
  const account = select('account', accounts.map((a) => [a.id, `${a.label} · ${a.account_no}`]), cls?.bank_account_id ?? accounts[0]?.id);
  d.body.append(
    field('Tên lớp', name),
    field('Khối', grade),
    field('Hình thức chính của lớp', mode, 'Chỉ để tham khảo. Hình thức học của từng em đặt ở màn hình Học sinh.'),
    group('Thứ có tiết', days.el, 'Chỉ điểm danh được vào đúng các thứ này; lớp chưa chọn thứ nào thì chưa điểm danh được.'),
    field('Tài khoản nhận học phí', account, accounts.length ? 'Thêm hoặc sửa tài khoản ở màn hình Cài đặt. Em học nhiều lớp thì hóa đơn dùng tài khoản của lớp em học nhiều buổi nhất trong tháng.' : 'Chưa có tài khoản nào. Thêm ở màn hình Cài đặt trước.'),
  );

  let active;
  if (cls) {
    active = checkbox('Đang dạy', cls.active);
    d.body.append(group('Trạng thái', active.el, 'Ngừng dạy thì bỏ chọn: lớp được ẩn đi, không xóa dữ liệu.'));
  }

  const save = button(cls ? 'Lưu' : 'Thêm lớp', 'primary', () => busy(save, d.error, async () => {
    const row = {
      name: name.value.replace(/\s+/g, ' ').trim(),
      grade: Number(grade.value),
      mode: mode.value,
      weekdays: days.values().map(Number),
      bank_account_id: account.value,
    };
    if (!row.name) throw new Error('Nhập tên lớp.');
    if (!row.bank_account_id) throw new Error('Chọn tài khoản nhận học phí. Nếu chưa có, thêm ở màn hình Cài đặt.');
    if (cls) {
      row.active = active.box.checked;
      await q(db.from('classes').update(row).eq('id', cls.id));
    } else {
      await q(db.from('classes').insert(row));
    }
    d.close();
    toast(cls ? `Đã lưu lớp ${row.name}.` : `Đã thêm lớp ${row.name}.`);
    refresh();
  }));
  d.footer.append(button('Hủy', 'outline', d.close), save);
  name.focus();
}

// ---------------- Khóa học ----------------

function termsSection(terms, refresh) {
  const section = h('section', 'section');
  section.append(sectionHead('Khóa học', button('+ Tạo khóa mới', 'outline', () => termDialog(null, terms, refresh))));

  const list = h('div', 'list');
  for (const t of terms) {
    const item = h('div', 'list__item');
    const info = h('div');
    const name = h('strong', null, t.name);
    info.append(name);
    if (t.is_current) info.append(h('span', 'pill pill--success pill--sm', 'Khóa hiện tại'));
    info.append(h('div', 'muted small', `${formatDate(t.start_date)} → ${formatDate(t.end_date)}`));

    const actions = h('div', 'list__actions');
    if (!t.is_current) {
      const makeCurrent = button('Đặt làm khóa hiện tại', 'outline btn--sm', async () => {
        if (!(await confirmDialog('Đặt khóa hiện tại', `Đặt ${t.name} làm khóa hiện tại? Điểm danh và ghi danh mới sẽ tính vào khóa này.`))) return;
        busy(makeCurrent, null, async () => {
          await q(db.rpc('set_current_term', { p_term_id: t.id }));
          toast(`${t.name} là khóa hiện tại.`);
          refresh();
        });
      });
      actions.append(makeCurrent);
    }
    actions.append(button('Sửa', 'outline btn--sm', () => termDialog(t, terms, refresh)));
    item.append(info, actions);
    list.append(item);
  }
  section.append(list);
  return section;
}

function termDialog(term, terms, refresh) {
  const d = openDialog(term ? `Sửa khóa ${term.name}` : 'Tạo khóa mới');
  // Mặc định 01/08 → 31/07 năm sau (SPEC 4.1), nối tiếp khóa mới nhất
  const year = terms.length ? Number(terms[0].start_date.slice(0, 4)) + 1 : Number(vnToday().slice(0, 4));
  const name = input('text', 'name', term?.name ?? `${year}–${year + 1}`);
  const start = input('date', 'start', term?.start_date ?? `${year}-08-01`);
  const end = input('date', 'end', term?.end_date ?? `${year + 1}-07-31`);
  d.body.append(
    field('Tên khóa', name),
    field('Ngày bắt đầu', start),
    field('Ngày kết thúc', end, 'Để tới 31/07 năm sau để tính cả các lớp học xuyên hè.'),
  );
  if (!term) d.body.append(callout('Tạo xong, khóa mới chưa phải khóa hiện tại. Khi bắt đầu năm học mới thì bấm “Đặt làm khóa hiện tại”.'));

  const save = button(term ? 'Lưu' : 'Tạo khóa', 'primary', () => busy(save, d.error, async () => {
    const row = { name: name.value.trim(), start_date: start.value, end_date: end.value };
    if (!row.name || !row.start_date || !row.end_date) throw new Error('Điền đủ tên khóa và 2 ngày.');
    if (row.end_date <= row.start_date) throw new Error('Ngày kết thúc phải sau ngày bắt đầu.');
    if (term) await q(db.from('terms').update(row).eq('id', term.id));
    else await q(db.from('terms').insert(row));
    d.close();
    toast(term ? `Đã lưu khóa ${row.name}.` : `Đã tạo khóa ${row.name}.`);
    refresh();
  }));
  d.footer.append(button('Hủy', 'outline', d.close), save);
}

// ---------------- Chuyển khóa ----------------

function transferSection(terms, classes, refresh) {
  const section = h('section', 'section');
  section.append(
    sectionHead('Chuyển khóa'),
    h('p', 'muted small', 'Chọn học sinh của một lớp ở khóa cũ để ghi danh sang lớp ở khóa mới (VD lớp 9 lên lớp 10).'),
  );
  if (terms.length < 2 || !classes.length) {
    section.append(callout('Cần có ít nhất 2 khóa và 1 lớp. Tạo khóa mới ở mục Khóa học trước.'));
    return section;
  }

  // terms đã xếp mới nhất trước: mặc định chuyển từ khóa liền trước sang khóa mới nhất
  const termOptions = terms.map((t) => [t.id, t.name]);
  const fromTerm = select('fromTerm', termOptions, terms[1].id);
  const fromClass = select('fromClass', classes.map((c) => [c.id, c.name + (c.active ? '' : ' (đã ngừng)')]));
  const toTerm = select('toTerm', termOptions, terms[0].id);
  const toClass = select('toClass', classes.filter((c) => c.active).map((c) => [c.id, c.name]));

  const from = h('div', 'card card--panel');
  from.append(h('h3', 'card__title', 'Từ'), field('Khóa', fromTerm), field('Lớp', fromClass));
  const to = h('div', 'card card--panel');
  to.append(h('h3', 'card__title', 'Sang'), field('Khóa', toTerm), field('Lớp', toClass));
  const grid = h('div', 'grid-2');
  grid.append(from, to);

  const listBox = h('div', 'pick-list');
  const error = h('p', 'form-error');
  const submit = button('Ghi danh các em đã chọn', 'primary');
  let boxes = [];

  async function loadList() {
    listBox.replaceChildren(h('p', 'muted', 'Đang tải danh sách…'));
    try {
      const rows = await q(db.from('enrollments')
        .select('student_id, left_on, students(code, full_name, active)')
        .eq('term_id', fromTerm.value)
        .eq('class_id', fromClass.value));
      rows.sort((a, b) => a.students.code.localeCompare(b.students.code));
      if (!rows.length) {
        boxes = [];
        listBox.replaceChildren(callout('Lớp này không có học sinh nào trong khóa đã chọn.'));
        return;
      }
      const all = checkbox(`Chọn tất cả (${rows.length})`, true);
      boxes = rows.map((r) => {
        const left = r.left_on || !r.students.active;
        const c = checkbox(`${r.students.code} · ${r.students.full_name}${left ? ' (đã nghỉ)' : ''}`, !left);
        c.box.value = r.student_id;
        return c;
      });
      const syncAll = () => { all.box.checked = boxes.every((b) => b.box.checked); };
      syncAll();
      all.box.addEventListener('change', () => boxes.forEach((b) => { b.box.checked = all.box.checked; }));
      boxes.forEach((b) => b.box.addEventListener('change', syncAll));
      listBox.replaceChildren(all.el, ...boxes.map((b) => b.el));
    } catch (err) {
      listBox.replaceChildren(callout(err.message, 'error'));
    }
  }

  submit.addEventListener('click', () => busy(submit, error, async () => {
    const ids = boxes.filter((b) => b.box.checked).map((b) => b.box.value);
    if (!ids.length) throw new Error('Chưa chọn em nào.');
    if (!toClass.value) throw new Error('Chưa có lớp đang dạy để chuyển sang.');
    if (fromTerm.value === toTerm.value && fromClass.value === toClass.value) throw new Error('Lớp và khóa đích trùng với nơi chuyển đi.');
    const result = await q(db.rpc('bulk_add_students', {
      p_class_id: toClass.value,
      p_term_id: toTerm.value,
      p_items: ids.map((id) => ({ student_id: id })),
    }));
    const termName = terms.find((t) => t.id === toTerm.value).name;
    toast(`Đã ghi danh ${result.enrolled} em vào ${toClass.selectedOptions[0].textContent} (${termName}).`);
    refresh();
  }));

  fromTerm.addEventListener('change', loadList);
  fromClass.addEventListener('change', loadList);
  loadList();

  section.append(grid, h('h3', 'card__title', 'Học sinh sẽ chuyển'), listBox, error, submit);
  return section;
}
