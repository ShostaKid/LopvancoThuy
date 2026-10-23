// Tạo phần tử nhanh: h('p', 'muted', 'Nội dung'). Dùng textContent nên không lo chèn HTML lạ.
export function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
