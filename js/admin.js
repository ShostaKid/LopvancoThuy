import { db } from './db.js';
import { loadStaff, signIn, signOut } from './auth.js';
import { can, actionLabel, ROLE_LABELS } from './roles.js';
import { ROUTES, startRouter } from './routes.js';
import { h } from './dom.js';

const $ = (id) => document.getElementById(id);

let currentUserId;   // undefined = chưa biết, null = chưa đăng nhập
let stopRouter = null;
let notice = '';     // thông báo giữ lại qua lần tự đăng xuất (VD tài khoản chưa được cấp quyền)

async function refresh() {
  let staff;
  try {
    staff = await loadStaff();
  } catch (err) {
    $('boot-status').textContent = err.message + ' Tải lại trang để thử lại.';
    $('boot-status').hidden = false;
    return;
  }

  if (staff?.noAccess) {
    notice = `Tài khoản ${staff.email} chưa được cấp quyền vào trang quản lý.`;
    await signOut();   // onAuthStateChange sẽ gọi lại refresh và hiện thông báo
    return;
  }

  $('boot-status').hidden = true;
  if (staff) {
    showApp(staff);
  } else {
    showLogin(notice);
    notice = '';
  }
}

function showLogin(message) {
  stopRouter?.();
  stopRouter = null;
  $('app-view').hidden = true;
  $('login-view').hidden = false;
  $('login-error').textContent = message;
}

function showApp(staff) {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  // Nhãn vai trò đặt trước để trên điện thoại tên dài bị cắt vẫn thấy vai trò
  $('who').replaceChildren(h('span', 'badge', ROLE_LABELS[staff.role]), h('span', null, staff.displayName));

  $('menu').replaceChildren(...ROUTES.map((r) => {
    const a = h('a', null, r.label);
    a.href = '#/' + r.path;
    a.dataset.path = r.path;
    return a;
  }));

  const ctx = { db, staff, can: (action) => can(staff, action) };
  stopRouter?.();
  stopRouter = startRouter((route) => {
    for (const a of $('menu').children) {
      if (a.dataset.path === route.path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    $('menu-toggle').textContent = route.label;
    setMenuOpen(false);
    window.scrollTo(0, 0);
    // Mỗi lần chuyển trang dùng 1 khung mới: màn hình cũ tải xong muộn cũng không vẽ đè lên màn hình mới
    const host = h('div');
    $('view').replaceChildren(host);
    (route.render ?? renderPlaceholder)(host, ctx, route);
  });
}

// Menu xổ xuống trên điện thoại; màn hình rộng thì CSS luôn hiện menu
function setMenuOpen(open) {
  $('menu').classList.toggle('is-open', open);
  $('menu-toggle').setAttribute('aria-expanded', String(open));
}

// Khung chờ cho màn hình chưa làm: tên màn hình, bước sẽ làm, và quyền của người đang xem
function renderPlaceholder(el, ctx, route) {
  const card = h('div', 'card card--panel');
  card.append(h('p', 'muted', `Màn hình này làm ở bước ${route.step}.`));

  if (route.actions) {
    const ul = h('ul', 'perm-list');
    for (const action of route.actions) {
      const ok = ctx.can(action);
      const li = h('li');
      li.append(h('span', null, actionLabel(action)), h('span', ok ? 'pill pill--success' : 'pill pill--muted', ok ? 'Được' : 'Không được'));
      ul.append(li);
    }
    card.append(ul);
  }
  el.replaceChildren(h('h1', 'page-title', route.label), card);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    await signIn(form.email.value.trim(), form.password.value);
    form.reset();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('logout-btn').addEventListener('click', () => signOut());
$('menu-toggle').addEventListener('click', () => setMenuOpen(!$('menu').classList.contains('is-open')));

// Chỉ vẽ lại khi đổi người dùng. SIGNED_IN còn bắn lại khi quay về tab, TOKEN_REFRESHED bắn định kỳ;
// vẽ lại lúc đó sẽ làm mất dữ liệu đang nhập dở (VD đang điểm danh).
db.auth.onAuthStateChange((event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === currentUserId) return;
  currentUserId = uid;
  setTimeout(refresh, 0);   // supabase-js khuyên không gọi API ngay trong callback này
});
