import { h } from './dom.js';

// Hộp thoại dùng <dialog> có sẵn của trình duyệt. Trên điện thoại CSS cho nó chiếm cả màn hình.
// Trả về { dialog, body, footer, error, close }; tự gỡ khỏi trang khi đóng.
export function openDialog(title) {
  const dialog = h('dialog', 'dialog');
  const head = h('div', 'dialog__head');
  const closeBtn = h('button', 'dialog__close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Đóng');
  head.append(h('h2', 'dialog__title', title), closeBtn);

  const body = h('div', 'dialog__body');
  const error = h('p', 'form-error');
  error.setAttribute('role', 'alert');
  const footer = h('div', 'dialog__footer');
  dialog.append(head, body, error, footer);

  const close = () => dialog.close();
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, footer, error, close };
}

export function button(label, variant = 'outline', onClick) {
  const b = h('button', `btn btn--${variant}`, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// Chạy việc bất đồng bộ khi bấm nút: khóa nút trong lúc chờ, lỗi thì hiện vào ô lỗi
export async function busy(btn, errorEl, task) {
  btn.disabled = true;
  if (errorEl) errorEl.textContent = '';
  try {
    return await task();
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message;
    else toast(err.message, 'error');
    return undefined;
  } finally {
    btn.disabled = false;
  }
}

// Ô nhập có nhãn: field('Họ và tên', input)
export function field(label, control, hint) {
  const wrap = h('label', 'field');
  wrap.append(h('span', 'field__label', label), control);
  if (hint) wrap.append(h('span', 'field__hint', hint));
  return wrap;
}

// Nhóm nhiều ô (VD các nút chọn thứ): không bọc bằng <label> vì bên trong có nhiều ô
export function group(label, content, hint) {
  const wrap = h('div', 'field');
  wrap.append(h('span', 'field__label', label), content);
  if (hint) wrap.append(h('span', 'field__hint', hint));
  return wrap;
}

// Ô tick có nhãn: trả về { el, box }
export function checkbox(label, checked = false) {
  const el = h('label', 'checkbox-field');
  const box = h('input');
  box.type = 'checkbox';
  box.checked = checked;
  el.append(box, h('span', null, label));
  return { el, box };
}

export function textarea(name, value = '', rows = 4) {
  const el = h('textarea');
  el.name = name;
  el.rows = rows;
  el.value = value ?? '';
  return el;
}

export function input(type, name, value = '') {
  const el = h('input');
  el.type = type;
  el.name = name;
  el.value = value ?? '';
  return el;
}

// options: [[value, label], ...]
export function select(name, options, value) {
  const el = h('select');
  el.name = name;
  for (const [v, label] of options) {
    const o = h('option', null, label);
    o.value = v;
    el.append(o);
  }
  if (value != null) el.value = value;
  return el;
}

// Nút chọn dạng viên (thứ trong tuần, lớp…): trả về { el, values() }
export function chipGroup(items, selected = []) {
  const el = h('div', 'chips');
  const boxes = items.map(([value, label]) => {
    const wrap = h('label', 'chip');
    const box = h('input');
    box.type = 'checkbox';
    box.value = value;
    box.checked = selected.includes(value);
    wrap.append(box, h('span', null, label));
    el.append(wrap);
    return box;
  });
  return { el, values: () => boxes.filter((b) => b.checked).map((b) => b.value) };
}

export function callout(text, variant = 'info') {
  return h('p', `callout callout--${variant}`, text);
}

let toastTimer;
export function toast(message, variant = 'success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', 'toast');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast toast--${variant} is-shown`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-shown'), 3500);
}
