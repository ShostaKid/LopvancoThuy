import { db } from './db.js';

// Người đang đăng nhập: { userId, email, role, displayName }.
// null nếu chưa đăng nhập; có noAccess: true nếu đăng nhập được nhưng không có trong bảng staff.
export async function loadStaff() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;

  const { data, error } = await db
    .from('staff')
    .select('role, display_name')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw new Error('Không tải được thông tin tài khoản: ' + error.message);

  const base = { userId: session.user.id, email: session.user.email };
  if (!data) return { ...base, noAccess: true };
  return { ...base, role: data.role, displayName: data.display_name || session.user.email };
}

export async function signIn(email, password) {
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(loginErrorMessage(error));
}

export async function signOut() {
  await db.auth.signOut();
}

function loginErrorMessage(error) {
  if (error.code === 'invalid_credentials') return 'Sai email hoặc mật khẩu.';
  if (error.code === 'email_not_confirmed') return 'Tài khoản chưa được xác nhận email. Báo cô kiểm tra trong Supabase.';
  if (error.code === 'over_request_rate_limit' || error.status === 429) return 'Thử quá nhiều lần. Đợi vài phút rồi thử lại.';
  if (error.name === 'AuthRetryableFetchError') return 'Không kết nối được. Kiểm tra mạng rồi thử lại.';
  return 'Không đăng nhập được: ' + error.message;
}
