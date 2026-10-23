# SPEC — Web điểm danh & học phí cho lớp dạy thêm

> File này là bản thiết kế đã chốt với chủ dự án (Naams). Claude Code đọc hết trước khi làm, build **theo đúng thứ tự ở mục 9**, và **hỏi lại trước khi tự ý đổi** bất kỳ quyết định nào trong file. Chủ dự án không có nền tảng IT: khi cần cô ấy thao tác tay (Supabase dashboard, GitHub), hướng dẫn từng bước bằng ngôn ngữ đơn giản.

---

## 1. Bối cảnh

- Một giáo viên dạy thêm (có giấy phép), khoảng **200 học sinh**, khối **8–12**.
- Có lớp **online** (Zoom) và **offline**. Bản đầu điểm danh **thủ công** cho cả hai.
- Học phí: **học bao nhiêu buổi đóng bấy nhiêu**, giá **200.000đ/buổi**, đóng **cuối tháng** qua **QR chuyển khoản (VietQR)**.
- Mục tiêu bản đầu: đưa vào dùng nhanh nhất để kiểm soát danh sách học sinh, điểm danh và tiền thu.

## 2. Người dùng

| Vai trò | Ai | Cách vào | Quyền |
|---|---|---|---|
| Admin | Giáo viên + 1 trợ giảng | Đăng nhập email/mật khẩu (Supabase Auth), **mỗi người 1 tài khoản riêng** | Toàn quyền như nhau |
| Phụ huynh | ~200 phụ huynh | **Không đăng nhập** | Chỉ tra cứu đúng 1 học sinh bằng họ tên đầy đủ, báo "đã chuyển khoản" |

Quy ước: **ai đăng nhập được = admin**. Không cần bảng phân quyền.
**Bắt buộc:** tắt "Allow new users to sign up" trong Supabase Auth; 2 tài khoản admin được tạo tay trong dashboard.

## 3. Stack & hosting

- **Frontend:** HTML/CSS/JS thuần, tách file (`.html` / `.css` / `.js`), không build step. Host trên **GitHub Pages**, **repo mới riêng** (không đụng repo ShostaKid).
- **Backend:** Supabase (Postgres + Auth + RLS + RPC). Gọi qua `supabase-js` v2 bản UMD từ CDN, **ghim đúng một phiên bản cụ thể**.
- **QR:** ảnh VietQR quick link (`img.vietqr.io`), sinh ở trình duyệt, không lưu file.
- **Ưu tiên điện thoại (mobile-first):** admin điểm danh và phụ huynh tra cứu chủ yếu bằng điện thoại. Nút to, chữ dễ đọc.
- Giao diện **tiếng Việt**. Múi giờ **Asia/Ho_Chi_Minh**. Tiền hiển thị dạng `1.800.000đ`.
- Phong cách: gọn, nhẹ, trung tính. Không cần trang trí cầu kỳ.

> ⚠️ Lưu ý gói free Supabase: giới hạn số project đang hoạt động trên một tài khoản. Trước khi tạo project mới, kiểm tra cùng chủ dự án xem tài khoản còn slot không (cô ấy đã có sẵn các project khác).

## 4. Database

Tất cả bảng có `id` (uuid, mặc định `gen_random_uuid()`) và `created_at` trừ khi ghi khác.

### 4.1 `terms` — khóa học / năm học
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `name` | text | VD `2026–2027` |
| `start_date` | date | Mặc định **01/08** |
| `end_date` | date | Mặc định **31/07 năm sau** (khóa thực tế 8 → 6/7, nhưng có lớp học xuyên hè nên lấy rộng) |
| `is_current` | boolean | Đúng 1 khóa `true` tại một thời điểm |

Seed sẵn khóa `2026–2027` (01/08/2026 → 31/07/2027), `is_current = true`.

### 4.2 `classes` — lớp (khung cố định, học sinh luân chuyển theo khóa)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `name` | text, unique | VD `Lớp 10`, `Lớp 9A`, `Lớp 9B`, `9 Chuyên Văn` |
| `grade` | smallint | 8–12 |
| `mode` | text | `online` / `offline` |
| `weekdays` | smallint[] | Thứ có học (2=Thứ 2 … 8=CN), để gợi ý lớp hôm nay |
| `active` | boolean | Ngừng dạy thì ẩn, **không xóa** |

Sang khóa mới **không tạo lớp mới**: dùng lại lớp, chỉ ghi danh học sinh mới vào khóa mới.

### 4.3 `students`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `code` | text, unique | Tự sinh `HS001`, `HS002`… không đổi suốt đời học sinh |
| `full_name` | text | Có dấu, như phụ huynh gõ |
| `name_search` | text, index | Bản chuẩn hóa (xem 6.1), cập nhật bằng trigger |
| `dob` | date, nullable | Chỉ điền khi trùng tên |
| `active` | boolean | Nghỉ học thì tắt, giữ lịch sử |
| `note` | text, nullable | Ghi chú nội bộ |

### 4.4 `enrollments` — em nào học lớp nào, khóa nào
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `student_id` | fk → students | |
| `class_id` | fk → classes | |
| `term_id` | fk → terms | |
| `joined_on` | date | Mặc định hôm nay |
| `left_on` | date, nullable | Nghỉ giữa khóa |

Unique `(student_id, class_id, term_id)`. **Một học sinh được học nhiều lớp** (VD 9 Chuyên Văn + 9A).

### 4.5 `sessions` — buổi học
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `class_id` | fk | |
| `date` | date | |
| `fee` | integer | VNĐ, mặc định **200000**. Lưu theo buổi để đổi giá sau này không làm sai lịch sử |
| `created_by` | uuid → auth.users | |

Unique `(class_id, date)`.

### 4.6 `attendance`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `session_id` | fk | |
| `student_id` | fk | |
| `present` | boolean | Chỉ có mặt / vắng. Vắng = không tính tiền |
| `marked_by` | uuid → auth.users | |
| `marked_at` | timestamptz | |

Khóa chính `(session_id, student_id)`.

### 4.7 `month_closings` — đánh dấu tháng đã chốt
`month` (text `YYYY-MM`, unique), `closed_at`, `closed_by`.

### 4.8 `invoices` — hóa đơn tháng
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `student_id` | fk | |
| `month` | text `YYYY-MM` | |
| `sessions_count` | integer | Số buổi có mặt trong tháng, **mọi lớp gộp lại** |
| `amount` | integer | Tổng `fee` các buổi có mặt |
| `transfer_note` | text | Xem 6.2 |
| `status` | text | `unpaid` → `reported` → `confirmed` |
| `reported_at` | timestamptz, nullable | Phụ huynh bấm "Tôi đã chuyển khoản" |
| `confirmed_at`, `confirmed_by` | nullable | Chỉ admin |

Unique `(student_id, month)`. **Mỗi học sinh 1 hóa đơn/tháng** dù học nhiều lớp → phụ huynh chỉ quét 1 QR.

### 4.9 `settings` — 1 dòng duy nhất
`bank_bin` (mã ngân hàng cho VietQR), `account_no`, `account_name`, `default_fee` (200000). Admin sửa được trong trang Cài đặt.

## 5. Bảo mật (quan trọng nhất)

- Bật **RLS trên mọi bảng**.
- Role `authenticated` (admin): full CRUD mọi bảng.
- Role `anon` (phụ huynh): **không có policy SELECT/INSERT/UPDATE/DELETE trên bất kỳ bảng nào.** Anon key nằm công khai trong JS, nên nếu bảng đọc được công khai thì ai cũng tải được toàn bộ danh sách 200 em qua API. Phụ huynh chỉ đi qua 2 hàm RPC dưới đây.

### 5.1 RPC `lookup_student(p_name text)` — `SECURITY DEFINER`, `GRANT EXECUTE` cho `anon`
- Chuẩn hóa `p_name` (6.1), so **khớp chính xác** với `name_search`. Không khớp một phần, không gợi ý.
- Nếu input sau chuẩn hóa ít hơn 2 từ → trả rỗng.
- Trả về cho mỗi học sinh khớp (thường 1, trùng tên thì nhiều):
  - `code`, `full_name`, tên các lớp đang học trong khóa hiện tại
  - hóa đơn **của tháng đã chốt gần nhất**: `month`, `sessions_count`, `amount`, `status`, `transfer_note`
  - **danh sách ngày có mặt** trong tháng đó (để phụ huynh tự đối chiếu)
  - thông tin tài khoản nhận tiền từ `settings`
- **Không** trả `dob`, `note`, hay bất kỳ học sinh nào khác.
- Nếu trùng tên: frontend hiện các kết quả kèm mã HS + tên lớp để phụ huynh chọn.

### 5.2 RPC `report_payment(p_code text, p_month text)` — `SECURITY DEFINER`, cho `anon`
- Chỉ đổi `unpaid` → `reported` và ghi `reported_at`. **Không bao giờ** đặt được `confirmed`, không đổi số tiền.
- Đã `reported`/`confirmed` thì không làm gì.

## 6. Quy tắc nghiệp vụ

### 6.1 Chuẩn hóa tên (`name_search`)
Viết thường → bỏ dấu (extension `unaccent`) → **`đ` → `d`** (unaccent không tự xử lý chắc chắn, phải replace riêng) → gộp khoảng trắng thừa → trim.
VD `"  Nguyễn  Văn ĐỨC "` → `"nguyen van duc"`. Dùng cùng một hàm SQL cho trigger và cho RPC tra cứu.

### 6.2 Nội dung chuyển khoản (`transfer_note`)
Định dạng: **`<TÊN KHÔNG DẤU VIẾT HOA> HOC PHI T<tháng> <MÃ HS>`**
VD: `NGUYEN VAN AN HOC PHI T10 HS042`
- Tên đặt trước (phụ huynh dễ nhận ra), mã HS ở cuối (để đối soát sao kê).
- Giới hạn tổng **≤ 50 ký tự**. Nếu vượt: **cắt bớt phần tên, không bao giờ cắt `HOC PHI T..` và mã HS**.
- Chỉ dùng A–Z, 0–9, dấu cách.

### 6.3 Chốt tháng
- Admin chọn tháng → bấm "Chốt tháng" → hệ thống tạo hóa đơn cho **mọi học sinh có ≥ 1 buổi có mặt** trong tháng đó. Học sinh 0 buổi: không tạo hóa đơn.
- Sau khi chốt: số tiền khóa lại; điểm danh các buổi trong tháng đã chốt **bị khóa sửa**.
- "Mở lại tháng": cho phép, kèm cảnh báo rõ. Khi chốt lại, **chỉ tính lại hóa đơn chưa `confirmed`**; hóa đơn đã xác nhận giữ nguyên và hiển thị cảnh báo nếu số buổi mới khác số buổi cũ.
- Trước khi chốt, phụ huynh tra cứu chỉ thấy hóa đơn tháng đã chốt gần nhất (không thấy QR tạm tính).

### 6.4 QR
`https://img.vietqr.io/image/{bank_bin}-{account_no}-compact2.png?amount={amount}&addInfo={transfer_note URL-encoded}&accountName={account_name URL-encoded}`
Chỉ hiện QR khi hóa đơn `unpaid` hoặc `reported`. Đã `confirmed` → hiện "Đã đóng ✓".

## 7. Màn hình

### Phụ huynh (công khai)
**P1. Tra cứu** — trang chủ của web.
- 1 ô "Nhập họ và tên đầy đủ của con", nút Tra cứu. Không có danh sách, không gợi ý.
- Kết quả: tên, **mã HS (hiển thị rõ, kèm giải thích ngắn "Mã này sẽ nằm cuối nội dung chuyển khoản")**, lớp đang học, tháng, số buổi + các ngày có mặt, số tiền, QR, nội dung chuyển khoản (có nút copy), nút **Tải mã QR**, nút **"Tôi đã chuyển khoản"** (tách riêng với nút tải; bấm xong hiện "Đã ghi nhận, cô sẽ kiểm tra và xác nhận").
- Không tìm thấy: "Không tìm thấy học sinh. Vui lòng kiểm tra lại họ tên đầy đủ có dấu hoặc liên hệ cô."

### Admin (sau đăng nhập), có menu điều hướng
**A1. Đăng nhập.**

**A2. Điểm danh** (màn hình mặc định sau đăng nhập)
- Chọn ngày (mặc định hôm nay) → gợi ý các lớp có học hôm đó theo `weekdays` (vẫn chọn được lớp khác).
- Danh sách học sinh ghi danh lớp đó trong khóa hiện tại (chưa `left_on`), **mặc định tất cả có mặt**, chạm vào tên để chuyển sang vắng. Nút Lưu to.
- Lưu = tạo `session` nếu chưa có + upsert `attendance`.
- Mở lại buổi đã điểm danh thì hiện trạng thái đã lưu để sửa (trừ tháng đã chốt).

**A3. Học sinh**
- Danh sách có tìm kiếm, lọc theo lớp / khóa / đang học.
- Thêm / sửa học sinh; ghi danh vào một hoặc nhiều lớp trong khóa hiện tại; cho nghỉ (đặt `left_on`).
- Cảnh báo khi thêm học sinh trùng `name_search` với em khác → gợi ý điền ngày sinh.
- **Nhập hàng loạt** từ danh sách dán vào (mỗi dòng 1 tên) cho một lớp, vì lúc đầu phải nhập ~200 em.

**A4. Lớp & khóa**
- CRUD lớp. Tạo khóa mới, đặt khóa hiện tại.
- Công cụ "Chuyển khóa": chọn học sinh của khóa cũ để ghi danh sang lớp ở khóa mới (VD lớp 9 lên lớp 10).

**A5. Học phí tháng**
- Chọn tháng → nút Chốt tháng / Mở lại.
- Bảng hóa đơn: mã HS, tên, lớp, số buổi, số tiền, nội dung CK, trạng thái. Lọc theo trạng thái; mặc định đẩy `reported` lên đầu.
- Mỗi dòng có nút **Xác nhận đã nhận tiền** (và hoàn tác).

**A6. Báo cáo**
- Theo tháng: tổng phải thu, đã xác nhận, phụ huynh báo đã chuyển (chưa kiểm tra), còn nợ; chia theo lớp (số buổi đã dạy, lượt có mặt, doanh thu); danh sách còn nợ.
- Theo khóa: tổng hợp các tháng trong khoảng ngày của khóa.
- **Xuất Excel/CSV** (hóa đơn tháng + điểm danh tháng) — đây là cách backup của chủ dự án.
- Lưu ý: học sinh học nhiều lớp thì doanh thu chia theo lớp tính từ từng buổi có mặt, không chia đều hóa đơn.

**A7. Cài đặt** — thông tin tài khoản nhận tiền, giá mặc định.

## 8. Ngoài phạm vi bản đầu (không làm)
- Tự động điểm danh qua Zoom (sau này: nấc 2 là upload CSV báo cáo người tham gia, nấc 3 là API/webhook).
- Tự động xác nhận tiền qua ngân hàng.
- Tài khoản cho học sinh/phụ huynh.
- Nghỉ có phép, học bù, giảm giá anh chị em.

## 9. Thứ tự build

Mỗi bước xong thì dừng, báo chủ dự án kiểm tra theo mục "Kiểm tra", rồi mới sang bước sau.

1. **Database**: tạo bảng, ràng buộc, hàm chuẩn hóa tên, trigger, RLS, 2 RPC, seed khóa 2026–2027 + `settings`.
   *Kiểm tra:* dùng anon key gọi thẳng `select` vào `students` → phải bị chặn; gọi `lookup_student` với tên đúng → ra đúng 1 em.
2. **Khung frontend + đăng nhập admin + menu**, deploy lên GitHub Pages.
   *Kiểm tra:* đăng nhập được trên điện thoại.
3. **A4 Lớp & khóa + A3 Học sinh** (kèm nhập hàng loạt).
   *Kiểm tra:* nhập thử 1 lớp thật.
4. **A2 Điểm danh.**
   *Kiểm tra:* điểm danh một lớp trên điện thoại dưới 1 phút.
5. **A5 Chốt tháng + A7 Cài đặt.**
   *Kiểm tra:* em học 9A + 9 Chuyên ra 1 hóa đơn gộp đúng tổng.
6. **P1 Trang tra cứu phụ huynh.**
   *Kiểm tra:* quét QR bằng 2–3 app ngân hàng khác nhau, xem số tiền và nội dung CK có hiện đúng, không bị cắt mã HS.
7. **A6 Báo cáo + xuất Excel.**
