import { db } from './db.js';

// Chờ kết quả Supabase; lỗi thì ném Error với câu tiếng Việt dễ hiểu
export async function q(request) {
  const { data, error } = await request;
  if (error) throw new Error(friendlyError(error));
  return data;
}

const UNIQUE_MESSAGES = {
  classes_name_key: 'Đã có lớp trùng tên này.',
  terms_name_key: 'Đã có khóa trùng tên này.',
  terms_one_current: 'Chỉ được có 1 khóa hiện tại.',
  enrollments_student_id_class_id_term_id_key: 'Em này đã ghi danh lớp đó trong khóa này.',
};

export function friendlyError(error) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  if (error.code === '23505') {
    const key = Object.keys(UNIQUE_MESSAGES).find((k) => text.includes(k));
    return key ? UNIQUE_MESSAGES[key] : 'Dữ liệu bị trùng với dòng đã có.';
  }
  if (error.code === '23503') return 'Không xóa được vì dữ liệu này đang được dùng ở chỗ khác (điểm danh, hóa đơn…).';
  if (error.code === '23514') return 'Dữ liệu không hợp lệ, kiểm tra lại các ô đã nhập.';
  if (error.code === '42501') return 'Bạn không có quyền làm việc này.';
  if (error.code === 'P0001') return error.message;   // lỗi tự đặt trong trigger/hàm, đã viết tiếng Việt
  if (/fetch|network/i.test(text)) return 'Không kết nối được. Kiểm tra mạng rồi thử lại.';
  return 'Có lỗi: ' + error.message;
}

export function loadTerms() {
  return q(db.from('terms').select('id, name, start_date, end_date, is_current').order('start_date', { ascending: false }));
}

export function loadClasses() {
  return q(db.from('classes').select('id, name, grade, mode, weekdays, active').order('grade').order('name'));
}

export function loadStudents() {
  return q(db.from('students')
    .select('id, code, full_name, name_search, dob, active, note, enrollments(id, class_id, term_id, joined_on, left_on)')
    .order('code'));
}

export function loadEnrollments(termId) {
  return q(db.from('enrollments').select('id, student_id, class_id, left_on').eq('term_id', termId));
}
