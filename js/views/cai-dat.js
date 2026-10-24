// A7. Cài đặt (SPEC 7): các tài khoản nhận học phí (mỗi lớp chọn 1 tài khoản) và giá mặc định.
// Chỉ Admin sửa, co-admin chỉ xem.
import { db } from '../db.js';
import { h } from '../dom.js';
import { q, loadBankAccounts, loadClasses } from '../data.js';
import { formatMoney } from '../format.js';
import { BANKS, bankName } from '../banks.js';
import { openDialog, button, busy, field, input, select, callout, toast, confirmDialog } from '../ui.js';

const OTHER = 'other';


// Tên chủ tài khoản VietQR: chữ hoa không dấu
const stripName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toUpperCase();
const toAccountName = (s) => stripName(s).replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();

export async function renderCaiDat(el, ctx) {
  const title = h('h1', 'page-title', 'Cài đặt');
  el.replaceChildren(title, h('p', 'muted', 'Đang tải…'));

  let accounts, classes, settings;
  try {
    [accounts, classes, settings] = await Promise.all([
      loadBankAccounts(), loadClasses(),
      q(db.from('settings').select('id, default_fee').limit(1)).then((r) => r[0]),
    ]);
  } catch (err) {
    el.replaceChildren(title, callout(err.message, 'error'));
    return;
  }
  if (!settings) { el.replaceChildren(title, callout('Chưa có dòng cài đặt trong database.', 'error')); return; }

  const editable = ctx.can('settings.edit');
  const refresh = () => renderCaiDat(el, ctx);

  // ---- Tài khoản nhận học phí ----
  const accSection = h('section', 'section');
  const head = h('div', 'section__head');
  head.append(h('h2', 'section__title', 'Tài khoản nhận học phí'));
  if (editable) head.append(button('+ Thêm tài khoản', 'primary', () => accountDialog(null)));
  accSection.append(head);
  if (!editable) accSection.append(callout('Chỉ Admin thêm hoặc sửa được. Bạn đang ở chế độ xem.'));

  if (!accounts.length) accSection.append(callout('Chưa có tài khoản nào. Thêm tài khoản rồi chọn cho từng lớp ở màn hình Lớp & khóa.', 'warning'));
  const list = h('div', 'list');
  for (const a of accounts) {
    const used = classes.filter((c) => c.bank_account_id === a.id).map((c) => c.name);
    const item = h('div', 'list__item');
    const info = h('div');
    info.append(h('strong', null, a.label), h('div', 'small', `${bankName(a.bank_bin)} · ${a.account_no}`),
      h('div', 'muted small', a.account_name), h('div', 'muted small', used.length ? `Dùng cho: ${used.join(', ')}` : 'Chưa lớp nào dùng'));
    item.append(info);
    if (editable) {
      const box = h('div', 'list__actions');
      box.append(button('Sửa', 'outline btn--sm', () => accountDialog(a)));
      item.append(box);
    }
    list.append(item);
  }
  if (accounts.length) accSection.append(list);

  function accountDialog(acc) {
    const d = openDialog(acc ? `Sửa tài khoản ${acc.label}` : 'Thêm tài khoản');
    const known = !acc || BANKS.some(([bin]) => bin === acc.bank_bin);
    const label = input('text', 'label', acc?.label);
    label.placeholder = 'VD: Lớp 8, Lớp 10';
    const bank = select('bank', [...BANKS, [OTHER, 'Ngân hàng khác (nhập mã BIN)']], known ? (acc?.bank_bin ?? '970415') : OTHER);
    const bin = input('text', 'bin', acc?.bank_bin ?? '');
    bin.inputMode = 'numeric';
    bin.placeholder = '6 chữ số';
    const binField = field('Mã BIN ngân hàng', bin, 'Tra ở https://api.vietqr.io/v2/banks');
    binField.hidden = known;
    const number = input('text', 'number', acc?.account_no);
    number.inputMode = 'numeric';
    const name = input('text', 'name', acc?.account_name);
    name.autocapitalize = 'characters';
    name.addEventListener('input', () => { name.value = stripName(name.value); });

    const preview = h('div', 'qr-preview');
    const currentBin = () => (bank.value === OTHER ? bin.value.trim() : bank.value);
    const drawPreview = () => {
      const b = currentBin();
      const n = number.value.trim();
      if (!/^\d{6}$/.test(b) || !/^\d{6,19}$/.test(n) || !toAccountName(name.value)) { preview.replaceChildren(); return; }
      const img = h('img', 'qr-preview__img');
      img.alt = 'Mã QR thử';
      img.src = `https://img.vietqr.io/image/${b}-${n}-compact2.png?amount=${settings.default_fee}&addInfo=${encodeURIComponent('THU NGHIEM')}&accountName=${encodeURIComponent(toAccountName(name.value))}`;
      preview.replaceChildren(h('p', 'muted small', 'Mã QR thử: quét bằng app ngân hàng để kiểm tra đúng chủ tài khoản, đừng chuyển tiền.'), img);
    };
    bank.addEventListener('change', () => { binField.hidden = bank.value !== OTHER; drawPreview(); });
    for (const i of [bin, number, name]) i.addEventListener('change', drawPreview);

    d.body.append(
      field('Tên gọi (để bạn chọn cho lớp)', label),
      field('Ngân hàng', bank), binField,
      field('Số tài khoản', number),
      field('Tên chủ tài khoản', name, 'Chữ hoa không dấu, đúng như ngân hàng ghi.'),
      preview,
    );
    drawPreview();

    const save = button(acc ? 'Lưu' : 'Thêm tài khoản', 'primary', () => busy(save, d.error, async () => {
      const row = { label: label.value.trim(), bank_bin: currentBin(), account_no: number.value.trim(), account_name: toAccountName(name.value) };
      if (!row.label) throw new Error('Nhập tên gọi cho tài khoản.');
      if (!/^\d{6}$/.test(row.bank_bin)) throw new Error('Mã BIN ngân hàng phải gồm 6 chữ số.');
      if (!/^\d{6,19}$/.test(row.account_no)) throw new Error('Số tài khoản chỉ gồm chữ số (6 đến 19 số).');
      if (!row.account_name) throw new Error('Nhập tên chủ tài khoản.');
      if (acc) {
        const done = await q(db.from('bank_accounts').update(row).eq('id', acc.id).select('id'));
        if (!done.length) throw new Error('Không lưu được. Chỉ Admin sửa được tài khoản.');
      } else {
        await q(db.from('bank_accounts').insert(row));
      }
      d.close();
      toast('Đã lưu tài khoản.');
      refresh();
    }));
    d.footer.append(button('Hủy', 'outline', d.close), save);

    if (acc) {
      const del = button('Xóa', 'danger', async () => {
        if (!(await confirmDialog('Xóa tài khoản', `Xóa tài khoản ${acc.label}? Chỉ xóa được khi chưa lớp nào hoặc hóa đơn nào dùng.`, 'Xóa', 'danger'))) return;
        busy(del, d.error, async () => {
          await q(db.from('bank_accounts').delete().eq('id', acc.id));
          d.close();
          toast('Đã xóa tài khoản.');
          refresh();
        });
      });
      del.classList.add('dialog__footer-start');
      d.footer.prepend(del);
    }
  }

  // ---- Giá mặc định ----
  const feeSection = h('section', 'section');
  feeSection.append(h('h2', 'section__title', 'Học phí'));
  const fee = input('number', 'fee', String(settings.default_fee));
  fee.min = '0';
  fee.step = '1000';
  fee.inputMode = 'numeric';
  fee.disabled = !editable;
  const card = h('div', 'card');
  card.append(field('Giá mặc định mỗi buổi (đồng)', fee, 'Chỉ áp dụng cho các buổi điểm danh từ nay trở đi. Buổi đã điểm danh giữ giá cũ.'));
  if (editable) {
    const error = h('p', 'form-error');
    const save = button('Lưu giá', 'primary', () => busy(save, error, async () => {
      const value = Number(fee.value);
      if (!Number.isInteger(value) || value < 0) throw new Error('Giá mỗi buổi phải là số nguyên không âm.');
      const done = await q(db.from('settings').update({ default_fee: value }).eq('id', settings.id).select('id'));
      if (!done.length) throw new Error('Không lưu được. Chỉ Admin sửa được cài đặt.');
      toast(`Đã lưu giá ${formatMoney(value)}/buổi.`);
      refresh();
    }));
    card.append(error, save);
  }
  feeSection.append(card);

  el.replaceChildren(title, accSection, feeSection);
}
