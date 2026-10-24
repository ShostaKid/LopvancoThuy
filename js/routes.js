// Menu trang quản lý (SPEC 7). Màn hình nào chưa có `render` thì hiện khung chờ;
// các bước sau thay bằng module thật, VD { ..., render: renderDiemDanh }.
// `actions`: những việc có phân quyền trong màn hình đó (xem roles.js).
import { renderBaoCao } from './views/bao-cao.js';
import { renderHocPhi } from './views/hoc-phi.js';
import { renderCaiDat } from './views/cai-dat.js';
import { renderDiemDanh } from './views/diem-danh.js';
import { renderHocSinh } from './views/hoc-sinh.js';
import { renderLopKhoa } from './views/lop-khoa.js';

export const ROUTES = [
  { path: 'diem-danh', label: 'Điểm danh', render: renderDiemDanh },
  { path: 'hoc-sinh', label: 'Học sinh', render: renderHocSinh },
  { path: 'lop-khoa', label: 'Lớp & khóa', render: renderLopKhoa },
  { path: 'hoc-phi', label: 'Học phí', render: renderHocPhi },
  { path: 'bao-cao', label: 'Báo cáo', render: renderBaoCao },
  { path: 'cai-dat', label: 'Cài đặt', render: renderCaiDat },
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
