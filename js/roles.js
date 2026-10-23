// Phân quyền phía giao diện (SPEC 2). Database đã chặn thật; ở đây chỉ để ẩn nút co-admin không dùng được.

export const ROLE_LABELS = { admin: 'Admin', co_admin: 'Co-admin' };

// Việc chỉ Admin làm được
const ADMIN_ONLY = {
  'month.close': 'Chốt / mở lại tháng',
  'settings.edit': 'Sửa cài đặt',
};

export function can(staff, action) {
  if (!staff?.role) return false;
  return staff.role === 'admin' || !(action in ADMIN_ONLY);
}

export function actionLabel(action) {
  return ADMIN_ONLY[action] ?? action;
}
