// Menu trang quản lý (SPEC 7). Màn hình nào chưa có `render` thì hiện khung chờ;
// các bước sau thay bằng module thật, VD { ..., render: renderDiemDanh }.
// `actions`: những việc có phân quyền trong màn hình đó (xem roles.js).

export const ROUTES = [
  { path: 'diem-danh', label: 'Điểm danh', step: 4 },
  { path: 'hoc-sinh', label: 'Học sinh', step: 3 },
  { path: 'lop-khoa', label: 'Lớp & khóa', step: 3 },
  { path: 'hoc-phi', label: 'Học phí', step: 5, actions: ['month.close'] },
  { path: 'bao-cao', label: 'Báo cáo', step: 7 },
  { path: 'cai-dat', label: 'Cài đặt', step: 5, actions: ['settings.edit'] },
];

export const DEFAULT_ROUTE = 'diem-danh';

// Điều hướng bằng hash (#/hoc-sinh) để chạy được trên GitHub Pages không cần cấu hình server.
// Trả về hàm dừng lắng nghe.
export function startRouter(onRoute) {
  const handle = () => {
    const path = location.hash.replace(/^#\/?/, '');
    const route = ROUTES.find((r) => r.path === path);
    if (!route) {
      location.replace('#/' + DEFAULT_ROUTE);
      return;
    }
    onRoute(route);
  };
  window.addEventListener('hashchange', handle);
  handle();
  return () => window.removeEventListener('hashchange', handle);
}
