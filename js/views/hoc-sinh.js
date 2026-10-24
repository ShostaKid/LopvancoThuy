// A3. Học sinh (SPEC 7): danh sách + lọc, thêm/sửa, ghi danh lớp khóa hiện tại, cho nghỉ, nhập hàng loạt
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadTerms, loadClasses, loadStudents } from '../data.js';
import { formatDate, normalizeName, cleanName, vnToday } from '../format.js';
import { openDialog, button, busy, field, group, input, select, textarea, checkbox, chipGroup, callout, toast, confirmDialog } from '../ui.js';

// Bộ lọc giữ nguyên khi chuyển qua lại giữa các màn hình
const filters = { text: '', term: 'all', classId: '', status: 'active' };

export async function renderHocSinh(el) {
  const title = h('h1', 'page-title', 'Học sinh');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let terms, classes, students;
  try {
    [terms, classes, students] = await Promise.all([loadTerms(), loadClasses(), loadStudents()]);
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }

  const ctx = {
    terms,
    classes,
    students,
    current: terms.find((t) => t.is_current),
    classById: new Map(classes.map((c) => [c.id, c])),
    refresh: () => renderHocSinh(el),
  };

  const actions = h('div', 'section__head');
  actions.append(
    h('span', 'muted', `${students.length} học sinh`),
    h('div', 'list__actions'),
  );
  actions.lastChild.append(
    button('Nhập hàng loạt', 'outline', () => bulkDialog(ctx)),
    button('+ Thêm học sinh', 'primary', () => studentDialog(null, ctx)),
  );

  const listBox = h('div');
  el.replaceChildren(title, actions, toolbar(ctx, () => renderList(listBox, ctx)), listBox);
  renderList(listBox, ctx);
}

// Lớp của em trong 1 khóa (đang học, chưa nghỉ)
function openClassNames(student, termId, ctx) {
  return student.enrollments
    .filter((e) => e.term_id === termId && !e.left_on)
    .map((e) => ctx.classById.get(e.class_id)?.name)
    .filter(Boolean)
    .sort();
}

function toolbar(ctx, onChange) {
  const bar = h('div', 'toolbar');
  const search = input('search', 'q', filters.text);
  search.placeholder = 'Tìm tên hoặc mã HS';
  const term = select('term', [['all', 'Mọi khóa'], ...ctx.terms.map((t) => [t.id, t.name + (t.is_current ? ' (hiện tại)' : '')])], filters.term);
  const cls = select('class', [['', 'Mọi lớp'], ...ctx.classes.map((c) => [c.id, c.name])], filters.classId);
  const status = select('status', [['active', 'Đang học'], ['inactive', 'Đã nghỉ'], ['all', 'Tất cả']], filters.status);

  search.addEventListener('input', () => { filters.text = search.value; onChange(); });
  term.addEventListener('change', () => { filters.term = term.value; onChange(); });
  cls.addEventListener('change', () => { filters.classId = cls.value; onChange(); });
  status.addEventListener('change', () => { filters.status = status.value; onChange(); });

  bar.append(field('Tìm kiếm', search), field('Khóa', term), field('Lớp', cls), field('Trạng thái', status));
  return bar;
}

function renderList(box, ctx) {
  const text = normalizeName(filters.text);
  // Cột Lớp: theo khóa đang lọc; "Mọi khóa" thì lấy khóa hiện tại
  const shownTermId = filters.term === 'all' ? ctx.current?.id : filters.term;

  const rows = ctx.students.filter((s) => {
    if (filters.status === 'active' && !s.active) return false;
    if (filters.status === 'inactive' && s.active) return false;
    if (text && !s.name_search.includes(text) && !s.code.toLowerCase().includes(text)) return false;
    const enr = s.enrollments.filter((e) => filters.term === 'all' || e.term_id === filters.term);
    if (filters.term !== 'all' && !enr.length) return false;
    if (filters.classId && !enr.some((e) => e.class_id === filters.classId)) return false;
    return true;
  });

  if (!ctx.students.length) {
    box.replaceChildren(callout('Chưa có học sinh nào. Bấm “Nhập hàng loạt” để dán cả danh sách một lớp, hoặc “+ Thêm học sinh”.'));
    return;
  }
  if (!rows.length) {
    box.replaceChildren(callout('Không có học sinh nào khớp bộ lọc.'));
    return;
  }

  const table = h('table', 'table');
  table.append(h('thead'), h('tbody'));
  const head = h('tr');
  head.append(h('th', null, 'Mã'), h('th', null, 'Họ và tên'), h('th', 'hide-sm', 'Ngày sinh'), h('th', null, 'Lớp'), h('th', null, 'Học'));
  table.tHead.append(head);

  for (const s of rows) {
    const tr = h('tr', s.active ? null : 'is-muted');
    const nameCell = h('td');
    const open = button(s.full_name, 'link');
    open.addEventListener('click', () => studentDialog(s, ctx));
    nameCell.append(open);
    if (!s.active) nameCell.append(h('span', 'pill pill--muted pill--sm', 'Đã nghỉ'));
    tr.append(
      h('td', 'nowrap', s.code),
      nameCell,
      h('td', 'hide-sm nowrap', formatDate(s.dob)),
      h('td', null, shownTermId ? openClassNames(s, shownTermId, ctx).join(', ') || '—' : '—'),
      h('td', null, s.mode === 'online' ? 'Online' : 'Offline'),
    );
    table.tBodies[0].append(tr);
  }

  const wrap = h('div', 'table-wrap');
  wrap.append(table);
  box.replaceChildren(h('p', 'muted small', `Đang hiện ${rows.length} / ${ctx.students.length} em`), wrap);
}

// Các em khác trùng tên (đã chuẩn hóa) với tên đang nhập
function sameNameStudents(name, ctx, exceptId) {
  const key = normalizeName(name);
  if (!key) return [];
  return ctx.students.filter((s) => s.id !== exceptId && s.name_search === key);
}

function describe(student, ctx) {
  const classes = ctx.current ? openClassNames(student, ctx.current.id, ctx) : [];
  return `${student.code} ${student.full_name}${classes.length ? ' (' + classes.join(', ') + ')' : ''}`;
}

// ---------------- Thêm / sửa ----------------

function studentDialog(student, ctx) {
  const d = openDialog(student ? `Sửa học sinh ${student.code}` : 'Thêm học sinh');
  const name = input('text', 'full_name', student?.full_name);
  name.autocomplete = 'off';
  const dob = input('date', 'dob', student?.dob);
  const modeSel = select('mode', [['offline', 'Offline (học tại lớp)'], ['online', 'Online (Zoom)']], student?.mode ?? 'offline');
  const note = textarea('note', student?.note, 2);
  const dupBox = h('div');

  const checkDup = () => {
    const same = sameNameStudents(name.value, ctx, student?.id);
    dupBox.replaceChildren(...(same.length
      ? [callout(`Đã có ${same.length} em trùng tên: ${same.map((s) => describe(s, ctx)).join('; ')}. Nếu là em khác, nên điền ngày sinh để phân biệt.`, 'warning')]
      : []));
  };
  name.addEventListener('input', checkDup);
  checkDup();

  d.body.append(
    field('Họ và tên', name, 'Gõ có dấu, đúng như phụ huynh sẽ gõ để tra cứu.'),
    dupBox,
    field('Ngày sinh', dob, 'Chỉ cần điền khi trùng tên với em khác.'),
    field('Hình thức học', modeSel, 'Mặc định của em. Hôm nào em học khác đi thì đổi ngay ở màn hình Điểm danh, không cần sửa ở đây.'),
    field('Ghi chú (chỉ admin thấy)', note),
  );

  // Ghi danh lớp trong khóa hiện tại
  const myCurrent = ctx.current ? (student?.enrollments ?? []).filter((e) => e.term_id === ctx.current.id) : [];
  const openIds = myCurrent.filter((e) => !e.left_on).map((e) => e.class_id);
  let chips;
  if (ctx.current) {
    const choices = ctx.classes.filter((c) => c.active || openIds.includes(c.id)).map((c) => [c.id, c.name]);
    chips = chipGroup(choices, openIds);
    d.body.append(group(`Lớp đang học (khóa ${ctx.current.name})`, choices.length ? chips.el : callout('Chưa có lớp nào. Tạo lớp ở màn hình Lớp & khóa.'),
      student ? 'Bỏ chọn một lớp = cho em nghỉ lớp đó từ hôm nay.' : null));
  } else {
    d.body.append(callout('Chưa có khóa hiện tại nên chưa ghi danh lớp được. Đặt khóa hiện tại ở màn hình Lớp & khóa.', 'warning'));
  }

  let active;
  if (student) {
    active = checkbox('Đang học', student.active);
    d.body.append(group('Trạng thái', active.el, 'Bỏ chọn khi em nghỉ hẳn: em được cho nghỉ ở mọi lớp từ hôm nay, lịch sử vẫn giữ.'));
  }

  const save = button(student ? 'Lưu' : 'Thêm học sinh', 'primary', () => busy(save, d.error, async () => {
    const row = { full_name: cleanName(name.value), dob: dob.value || null, mode: modeSel.value, note: note.value.trim() || null };
    if (!row.full_name) throw new Error('Nhập họ và tên.');
    if (student) row.active = active.box.checked;

    const saved = student
      ? (await q(db.from('students').update(row).eq('id', student.id).select('id, code')))[0]
      : (await q(db.from('students').insert(row).select('id, code')))[0];
    const today = vnToday();

    if (chips) {
      const wanted = chips.values();
      for (const classId of wanted) {
        const existing = myCurrent.find((e) => e.class_id === classId);
        if (!existing) {
          await q(db.from('enrollments').insert({ student_id: saved.id, class_id: classId, term_id: ctx.current.id }));
        } else if (existing.left_on) {
          await q(db.from('enrollments').update({ left_on: null }).eq('id', existing.id));
        }
      }
      const leaving = myCurrent.filter((e) => !e.left_on && !wanted.includes(e.class_id)).map((e) => e.id);
      if (leaving.length) await q(db.from('enrollments').update({ left_on: today }).in('id', leaving));
    }

    // Nghỉ hẳn: đóng mọi lớp còn mở, ở mọi khóa
    if (student?.active && !row.active) {
      await q(db.from('enrollments').update({ left_on: today }).eq('student_id', student.id).is('left_on', null));
    }

    d.close();
    toast(student ? `Đã lưu ${saved.code} ${row.full_name}.` : `Đã thêm ${saved.code} ${row.full_name}.`);
    ctx.refresh();
  }));

  if (student) {
    const del = button('Xóa', 'danger', async () => {
      if (!(await confirmDialog('Xóa học sinh', `Xóa hẳn ${student.code} ${student.full_name}?

Chỉ nên xóa khi nhập nhầm. Em đã có điểm danh hoặc hóa đơn thì không xóa được; khi đó hãy bỏ chọn “Đang học”.`, 'Xóa', 'danger'))) return;
      busy(del, d.error, async () => {
        await q(db.from('students').delete().eq('id', student.id));
        d.close();
        toast(`Đã xóa ${student.code} ${student.full_name}.`);
        ctx.refresh();
      });
    });
    del.classList.add('dialog__footer-start');
    d.footer.append(del);
  }
  d.footer.append(button('Hủy', 'outline', d.close), save);
  if (!student) name.focus();
}

// ---------------- Nhập hàng loạt ----------------

// Một dòng dán vào → họ tên. Bỏ số thứ tự đầu dòng; dán từ Excel thì lấy ô đầu tiên có chữ.
function parseLine(raw) {
  let s = raw;
  if (s.includes('\t')) s = s.split('\t').find((cell) => /\p{L}/u.test(cell)) ?? '';
  s = s.replace(/^\s*\d+\s*[.)\-:]?\s+/, '');
  return cleanName(s);
}

function bulkDialog(ctx) {
  if (!ctx.current) {
    toast('Chưa có khóa hiện tại. Đặt khóa hiện tại ở màn hình Lớp & khóa trước.', 'error');
    return;
  }
  const activeClasses = ctx.classes.filter((c) => c.active);
  if (!activeClasses.length) {
    toast('Chưa có lớp nào. Tạo lớp ở màn hình Lớp & khóa trước.', 'error');
    return;
  }

  const d = openDialog('Nhập hàng loạt');
  const classSel = select('class', activeClasses.map((c) => [c.id, c.name]),
    activeClasses.some((c) => c.id === filters.classId) ? filters.classId : activeClasses[0].id);
  const text = textarea('names', '', 8);
  text.placeholder = 'Nguyễn Văn An\nTrần Thị Bình\n…';
  const preview = h('div');
  d.body.append(
    field(`Lớp (khóa ${ctx.current.name})`, classSel),
    field('Danh sách học sinh', text, 'Mỗi dòng 1 họ tên, có dấu. Dán từ Excel hay Zalo đều được: số thứ tự đầu dòng sẽ tự bỏ.'),
    preview,
  );

  let plan = null;   // [{ name, line, choice: 'new' | studentId | 'skip', select? }]

  function buildPreview() {
    const lines = text.value.split(/\r?\n/).map((raw, i) => ({ name: parseLine(raw), line: i + 1 })).filter((x) => x.name);
    if (!lines.length) {
      plan = null;
      preview.replaceChildren(callout('Chưa có tên nào.', 'warning'));
      return;
    }

    const seen = new Map();
    plan = lines.map((x) => {
      const key = normalizeName(x.name);
      const matches = ctx.students.filter((s) => s.name_search === key);
      const inClass = matches.find((s) => s.enrollments.some((e) => e.term_id === ctx.current.id && e.class_id === classSel.value && !e.left_on));
      const item = { ...x, matches, inClass, dupOf: seen.get(key) };
      if (!seen.has(key)) seen.set(key, x.line);
      return item;
    });

    const table = h('table', 'table');
    table.append(h('thead'), h('tbody'));
    const head = h('tr');
    head.append(h('th', 'num', 'Dòng'), h('th', null, 'Họ và tên · cách xử lý'));
    table.tHead.append(head);

    // Tên và cách xử lý chồng lên nhau trong 1 ô để không tràn ngang trên điện thoại
    for (const item of plan) {
      const tr = h('tr');
      const td = h('td');
      const cell = h('div', 'stack');
      td.append(cell);
      cell.append(h('strong', null, item.name));
      if (item.dupOf) cell.append(h('span', 'small text-warning', `Trùng tên với dòng ${item.dupOf}`));
      if (item.inClass) {
        item.choice = 'skip';
        cell.append(h('span', 'pill pill--muted', `Đã có trong lớp (${item.inClass.code}), bỏ qua`));
      } else if (item.matches.length) {
        item.select = select('choice', [
          ...item.matches.map((s) => [s.id, `Dùng em có sẵn: ${describe(s, ctx)}`]),
          ['new', 'Tạo học sinh mới (trùng tên)'],
        ]);
        item.select.className = 'select';
        cell.append(item.select);
      } else {
        item.choice = 'new';
        cell.append(h('span', 'pill pill--success', 'Tạo mới'));
      }
      tr.append(h('td', 'num', String(item.line)), td);
      table.tBodies[0].append(tr);
    }

    const counts = { new: plan.filter((p) => p.choice === 'new').length, ask: plan.filter((p) => p.select).length, skip: plan.filter((p) => p.choice === 'skip').length };
    const summary = [`${plan.length} tên`, `${counts.new} tạo mới`];
    if (counts.ask) summary.push(`${counts.ask} trùng tên em đã có (chọn cách xử lý)`);
    if (counts.skip) summary.push(`${counts.skip} đã có trong lớp`);
    const wrap = h('div', 'table-wrap');
    wrap.append(table);
    preview.replaceChildren(h('p', 'small', summary.join(' · ')), wrap);
    confirmBtn.hidden = false;
  }

  const previewBtn = button('Xem trước', 'outline', buildPreview);
  const confirmBtn = button('Nhập vào lớp', 'primary', () => busy(confirmBtn, d.error, async () => {
    if (!plan) throw new Error('Bấm “Xem trước” trước.');
    const items = [];
    for (const p of plan) {
      const choice = p.select ? p.select.value : p.choice;
      if (choice === 'skip') continue;
      items.push(choice === 'new' ? { full_name: p.name } : { student_id: choice });
    }
    if (!items.length) throw new Error('Không có em nào cần nhập.');
    const result = await q(db.rpc('bulk_add_students', { p_class_id: classSel.value, p_term_id: ctx.current.id, p_items: items }));
    const codes = result.created_codes;
    const reused = result.enrolled - codes.length;
    const parts = [`Đã nhập ${result.enrolled} em vào ${classSel.selectedOptions[0].textContent}`];
    if (codes.length) parts.push(`tạo mới ${codes.length} em (${codes[0]}${codes.length > 1 ? '–' + codes[codes.length - 1] : ''})`);
    if (reused) parts.push(`ghi danh ${reused} em có sẵn`);
    d.close();
    toast(parts.join(', ') + '.');
    ctx.refresh();
  }));
  confirmBtn.hidden = true;

  // Sửa danh sách hoặc đổi lớp thì phải xem trước lại
  const invalidate = () => { plan = null; confirmBtn.hidden = true; preview.replaceChildren(); };
  text.addEventListener('input', invalidate);
  classSel.addEventListener('change', () => { if (plan) buildPreview(); });

  d.footer.append(button('Hủy', 'outline', d.close), previewBtn, confirmBtn);
  text.focus();
}
