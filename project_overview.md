# HỆ THỐNG QUẢN LÝ HUY ĐỘNG VỐN & THI ĐUA NỘI BỘ
## Quỹ Tín dụng Nhân dân Yên Thọ (QTDND Yên Thọ)

Tài liệu này mô tả chi tiết kiến trúc kỹ thuật, cấu trúc cơ sở dữ liệu và các luồng nghiệp vụ cốt lõi của ứng dụng Webapp quản lý chỉ tiêu huy động vốn, áp dụng các kinh nghiệm thực tế về tối ưu hóa hiệu năng, bảo mật và tính toàn vẹn dữ liệu từ hệ thống HoKinhDoanh.

---

## I. KIẾN TRÚC TỔNG QUAN & GIAO TIẾP DỮ LIỆU

Ứng dụng được triển khai dưới dạng **Single Page Application (SPA)** chạy trong môi trường iFrame của Google Apps Script (GAS).

### 1. Sơ đồ Giao tiếp Dữ liệu (GAS Data Communication)
```
[HTML Frontend - Client]
        │
        ▼ (AppManager.callApi - Wrapper duy nhất)
google.script.run.doApiRequest(action, payload)
        │
        ▼ (src/backend/core/Main.js - API Gateway)
   ┌────┴──────────────────────────┐
   ▼ Token expired?                ▼ Token Valid?
[Yêu cầu Đăng nhập]         [Phân quyền & Định tuyến switch-case]
                                   │
                                   ▼
                            [Service Layer]
                 (KhachHang, GiaoDich, SoTietKiem, KPI,...)
                                   │
                                   ▼
                           [Repository Layer]
                   (Batch Ops + LockService + 2-Layer Cache)
                                   │
                                   ▼
                           [Google Sheets - DB]
```

### 2. Nguyên tắc Thiết kế & Kinh nghiệm từ HoKinhDoanh
- **API Gateway tập trung (`Main.js`):** Frontend tuyệt đối không gọi trực tiếp các hàm backend một cách tùy tiện. Tất cả request đi qua `doApiRequest(action, payload)`. Payload luôn chứa `token` (lưu ở `localStorage`) và `ClientIP`. Kết quả trả về luôn ở dạng chuẩn hóa:
  - Thành công: `{ status: "success", data: ... }`
  - Lỗi: `{ status: "error", message: "Lý do lỗi tiếng Việt", stack: ... }`
- **Chống Double-Click (Anti-Double-Submit):** Nút Lưu/Submit bị disable ngay khi bấm và hiển thị Spinner tải động. Phía Backend dùng `AppManager.callApi` khóa ghi nếu một action ghi đang trong trạng thái xử lý (pending).
- **Maker-Checker (Bốn mắt - Four Eyes Principle):**
  - Mọi giao dịch tài chính (Gửi/Rút) do Cán bộ (Teller - USER) tạo sẽ ở trạng thái chờ duyệt (`PENDING`).
  - Kiểm soát viên (ADMIN) là người duy nhất có quyền xem xét, phê duyệt hoặc từ chối để giao dịch chính thức có hiệu lực (`ACTIVE`).
- **Batch Operations & LockService:**
  - Không bao giờ sử dụng `getValue()`, `setValue()`, hoặc `appendRow()` trong vòng lặp. Luôn đọc/ghi theo khối dữ liệu (`getValues()` / `setValues()`).
  - Mọi thao tác Ghi/Sửa sheet được bọc trong `LockService.getScriptLock().waitLock(15000)` và kết thúc bằng `SpreadsheetApp.flush()` để triệt tiêu Race Conditions khi nhiều Teller cùng submit đồng thời.
- **Bộ nhớ đệm 2 lớp (2-Layer Cache System):**
  - **Lớp 1 (In-Memory):** Cache trên RAM của instance hiện tại (`_executionCache`) để dùng lại dữ liệu trong cùng 1 lần chạy script, tốc độ truy cập ~0ms.
  - **Lớp 2 (Script Cache):** Lưu trữ qua `CacheService` với thời gian tồn tại 5 phút (300 giây).
  - **Chunking dữ liệu lớn:** Tự động chia nhỏ (chunking) dữ liệu thành các khối 90KB để lách qua giới hạn 100KB của Google Script Cache.
  - **Cơ chế Invalidate Cache:** Khi ghi/sửa dữ liệu ở Sheet nào thì thực hiện xóa Cache của Sheet đó (`clearCache(sheetName)`) ngay lập tức để đảm bảo tính thời gian thực.
- **Xử lý ngày tháng an toàn:**
  - Frontend: Sử dụng Flatpickr `altInput: true` để hiển thị định dạng Việt Nam (`DD/MM/YYYY`) cho người dùng nhưng gửi lên Backend định dạng chuẩn Quốc tế (`YYYY-MM-DD`).
  - Backend: Lưu trữ dạng Date Object hoặc chuỗi ISO String trong Sheet để phục vụ tính toán chính xác, tránh lệch ngày do múi giờ (+07:00).

---

## II. CẤU TRÚC CƠ SỞ DỮ LIỆU (GOOGLE SHEETS)

Hệ thống sử dụng một Spreadsheet chính thức với ID `1FHyyIr_S1u30ROB7szzCwtybmnbiFDjVYBmcerLCSCg`, bao gồm các bảng (Sheets) sau:

1. **`DB_NHANSU`:** Lưu thông tin cán bộ nhân viên, vai trò (ADMIN/USER), email, hash mật khẩu (SHA-256) và trạng thái tài khoản.
2. **`DB_KHACHHANG`:** Thông tin khách hàng gửi tiền (Mã KH, Họ tên, Số CCCD, SĐT, Địa chỉ, Số thẻ thành viên, Ngày tạo, Trạng thái).
3. **`DB_KH_HISTORY`:** Nhật ký lịch sử thay đổi thông tin khách hàng.
4. **`DB_CHIENDICH`:** Các chiến dịch thi đua huy động vốn (Mã chiến dịch, Tên chiến dịch, Ngày bắt đầu, Ngày kết thúc, Trạng thái).
5. **`DB_CHITIEU`:** Định mức chỉ tiêu huy động vốn được giao cho từng nhân viên theo từng chiến dịch.
6. **`DB_SOTIETKIEM`:** Danh sách sổ tiết kiệm trên hệ thống (Số sổ, Mã KH, Mã NV quản lý, Mã CD, Ngày phát hành, Ngày đáo hạn, Số dư ban đầu, Số dư hiện tại, Kỳ hạn, Loại sảnh, Trạng thái `ACTIVE`/`CLOSED`, Lãi suất, Loại tính lãi, Tiền lãi dự kiến).
7. **`DB_GIAODICH`:** Lịch sử giao dịch gửi/rút chờ duyệt và đã duyệt (Mã GD, Mã NV thực hiện, Mã KH, Mã CD, Số sổ, Loại GD `GUI`/`RUT`, Số tiền, Ngày GD, Trạng thái `PENDING`/`ACTIVE`/`REJECTED`/`CANCELLED`/`REVERTED`, Ghi chú, Người duyệt, Ngày duyệt).
8. **`DB_SUMMARY`:** Bảng tổng hợp thi đua và tính toán KPI điểm số của cán bộ.
9. **`DB_LOG`:** Nhật ký hệ thống (Audit Logs) ghi nhận tất cả hành động nhạy cảm của người dùng (Đăng nhập, duyệt lệnh, thay đổi mật khẩu, IP client...).
10. **`DB_CAUHINH`:** Lưu trữ cấu hình động của hệ thống (ví dụ: Master Password).
11. **`DB_GIAODICH_ARCHIVE`:** Nén dữ liệu các giao dịch bị hủy/từ chối để giải phóng dung lượng sheet chính.
12. **`DB_SYS_STK`:** Dữ liệu số dư sổ tiết kiệm thực tế trích xuất trực tiếp từ hệ thống Core Banking để phục vụ đối chiếu tự động.

---

## III. CHI TIẾT CÁC LUỒNG NGHIỆP VỤ CỐT LÕI

### 1. Luồng Nhập liệu mở tài khoản & OCR giấy tờ (KhachHang Module)
- **Nghiệp vụ:** Khi có khách hàng mới, Teller nhập các trường thông tin hoặc sử dụng tính năng OCR để quét giấy tờ CCCD/CMND.
- **Kiểm soát trùng lặp:** 
  - Hệ thống tự động truy vấn kiểm tra trùng số CCCD/CMND trên toàn bộ Database.
  - Nếu trùng CCCD, hệ thống chặn không cho tạo mới mà tự động map giao dịch vào Mã Khách Hàng hiện hữu, tránh phân mảnh thông tin khách hàng.
  - Kiểm tra trùng SĐT để tránh một số điện thoại đăng ký cho nhiều khách hàng khác nhau.
- **Lịch sử sửa đổi:** Mọi hành động thêm mới hoặc cập nhật thông tin khách hàng đều được ghi nhận chi tiết vào sheet `DB_KH_HISTORY` làm bằng chứng đối soát.

### 2. Luồng Gửi tiền tiết kiệm mới (Maker-Checker - GUI)
```
[Teller - USER]                       [Kiểm soát viên - ADMIN]
       │                                         │
       ├─► Nhập CCCD, Số tiền, Kỳ hạn...        │
       │   (Hệ thống tự nhận diện KH)            │
       │                                         │
       ├─► Submit lệnh gửi                       │
       │   (Trạng thái: PENDING)                 │
       │                                         │
       ▼                                         ▼
[Giao dịch ghi vào DB_GIAODICH] ──────────► [Hiển thị trang Chờ Duyệt]
                                                 │
                                                 ├─► Kiểm tra thông tin thực tế
                                                 │   (Có thể sửa: Số tiền, Số sổ,
                                                 │    Lãi suất, Kỳ hạn trước khi duyệt)
                                                 │
                                                 ├─► Phê duyệt (APPROVE) hoặc Từ chối (REJECT)
                                                 │
      ┌──────────────────────────────────────────┴───────────────────────────┐
      ▼ (Nếu REJECT)                                                         ▼ (Nếu APPROVE)
[Giao dịch -> REJECTED]                                         [Giao dịch -> ACTIVE]
[Ghi lý do từ chối]                                             [Sinh tự động Sổ TK trong DB_SOTIETKIEM]
                                                                [Tính toán Ngày đáo hạn & Tiền lãi dự kiến]
                                                                [Cập nhật/Cộng điểm KPI thi đua cho Teller]
```

### 3. Luồng Rút tiền tiết kiệm / Tất toán (RUT)
- **Nghiệp vụ:** Khách hàng đến tất toán sổ trước hạn hoặc đúng hạn.
- **Kiểm soát nghiệp vụ:**
  - Lệnh rút tiền chỉ được tạo trên các sổ tiết kiệm đang ở trạng thái `ACTIVE` và có số dư khả dụng lớn hơn hoặc bằng số tiền yêu cầu rút.
  - Teller nhập yêu cầu rút tiền -> hệ thống tạo lệnh rút ở trạng thái `PENDING` chờ duyệt.
  - Khi Admin duyệt lệnh rút:
    - Cập nhật giảm Số dư hiện tại (`SoDuHienTai`) của cuốn sổ. Nếu số dư về 0, chuyển trạng thái sổ sang `CLOSED`.
    - Trừ điểm KPI tương ứng của cán bộ quản lý sổ đó (nếu là rút tiền làm giảm số dư huy động trong chiến dịch).
    - Lưu vết giao dịch rút thành trạng thái `ACTIVE`.

### 4. Luồng Đối chiếu số liệu Core Banking (Reconciliation)
- **Mục đích:** Đảm bảo số dư và trạng thái các sổ tiết kiệm đang được quản lý trên App hoàn toàn khớp đúng với hệ thống Core Banking của Quỹ Tín dụng. Phát hiện các trường hợp Teller tạo sổ ảo trên App để lấy điểm thi đua khống.
- **Quy trình thực hiện:**
  1. Admin kết xuất danh sách Số sổ tiết kiệm thực tế từ Core Banking và dán vào sheet `DB_SYS_STK` (cột `SO_SO_TG`).
  2. Hệ thống thực hiện so sánh đối chiếu:
     - Quét toàn bộ sổ đang ở trạng thái `ACTIVE` trên ứng dụng.
     - So khớp chéo với danh sách trong `DB_SYS_STK`.
     - Phát hiện các sổ có trên App nhưng không tìm thấy trong dữ liệu Core (Sổ khống/ảo).
  3. Hệ thống trả về danh sách cảnh báo chi tiết: Số sổ, số dư ảo, tên khách hàng, cán bộ chịu trách nhiệm và tổng số tiền chênh lệch.
  4. Admin nhấn nút "Xử lý Đối chiếu" để hệ thống tự động:
     - Tạo giao dịch Rút ép buộc (Bypass Maker-Checker) để tất toán các sổ ảo này.
     - Chuyển trạng thái sổ ảo sang `CLOSED`.
     - Tự động trừ ngược điểm KPI thi đua của cán bộ liên quan để thu hồi điểm khống.

### 5. Luồng Tính toán & Cập nhật KPI Thi đua
- **Công thức tính điểm:** Được cấu hình động theo từng chiến dịch dựa trên kỳ hạn gửi tiền và doanh số huy động.
- **Quy trình kích hoạt:**
  - KPI của cán bộ hoàn toàn KHÔNG được tính khi tạo lệnh `PENDING`.
  - Chỉ khi Admin duyệt giao dịch gửi thành công (`ACTIVE`), hệ thống mới kích hoạt hàm recalculate KPI cho cán bộ đó trong chiến dịch đó.
  - Tương tự, khi đảo ngược giao dịch (`REVERTED`) hoặc tất toán tự động khi đối chiếu, hệ thống sẽ thực hiện trừ điểm tương ứng.
  - Dữ liệu KPI được kết xuất trực tiếp lên Dashboard thời gian thực để tạo không khí thi đua sôi nổi giữa các phòng ban.

### 6. Luồng Đảo ngược Giao dịch (Revert Transaction)
- **Đặc quyền:** Dành riêng cho ADMIN để sửa lỗi sai sót trong tác nghiệp.
- **Giới hạn an toàn:** Chỉ cho phép đảo ngược giao dịch đã duyệt thành công (`ACTIVE`) trong vòng 24 giờ kể từ thời điểm Admin duyệt lệnh (`NgayDuyet`).
- **Nghiệp vụ xử lý:**
  - Đọc giao dịch cũ -> Hoàn trả lại số dư cho Sổ tiết kiệm tương ứng (nếu là giao dịch rút thì cộng lại tiền, nếu gửi thì trừ đi tiền).
  - Chuyển trạng thái sổ về `ACTIVE` hoặc `CLOSED` tương ứng với số dư mới.
  - Chuyển trạng thái giao dịch sang `REVERTED`.
  - Khấu trừ/cập nhật lại KPI thi đua của nhân viên liên quan.

### 7. Nhật ký hoạt động & Lưu trữ nén (Logger & Archive)
- **Audit Logs:** Ghi lại mọi hành động đăng nhập, sửa thông tin, duyệt giao dịch, hủy giao dịch kèm thông tin thiết bị/IP của Client.
- **Archive:** Định kỳ, Admin có thể chạy lệnh Archive để di chuyển các dòng log cũ hoặc các giao dịch trạng thái `CANCELLED` / `REJECTED` sang sheet lưu trữ ẩn để giữ sheet làm việc luôn nhẹ và chạy mượt dưới 6 phút giới hạn của Google Apps Script.

---

## IV. BẢN ĐỒ KHẮC PHỤC CÁC LỖI HIỆN TẠI

Dựa trên kết quả kiểm tra toàn diện mã nguồn hiện tại, hệ thống đã ghi nhận và khắc phục các nhóm lỗi sau:

| Phân hệ ảnh hưởng | Tệp tin mã nguồn | Hiện tượng lỗi | Nguyên nhân kỹ thuật | Giải pháp khắc phục |
| :--- | :--- | :--- | :--- | :--- |
| **Khách Hàng** | `KhachHangService.js` | Tìm kiếm toàn cầu (Global Search) của DataTable bị bỏ qua (bypass). | `payload.extraFilter` luôn được gửi lên dưới dạng object đầy đủ trường trống `{ MaKH: "", HoTen: "", DiaChi: "" }`. Điều kiện `if (payload.extraFilter)` luôn đánh giá là `true`, chặn nhánh lọc toàn cầu. | Đổi điều kiện kiểm tra: chỉ kích hoạt bộ lọc nâng cao khi có ít nhất một trường trong `extraFilter` có giá trị thực sự. |
| **Giao Dịch & Hệ Thống** | `GiaoDichService.js`<br>`SystemAdminService.js` | Lọc khoảng ngày (Date Range) không hoạt động nếu chỉ chọn từ ngày hoặc chỉ chọn đến ngày. | Sử dụng điều kiện logic `and` bắt buộc cả hai biến ngày đều phải có giá trị (`payload.tuNgay && payload.denNgay`). | Chuyển sang logic lọc đơn biên (độc lập `tuNgay` hoặc `denNgay` bằng phép logic `or`). |
| **Sổ Tiết Kiệm** | `SoTietKiemService.js` | Lỗi sập hệ thống `TypeError: Cannot read property 'toLowerCase'` khi nhấn sắp xếp cột trong danh sách sổ. | Gọi hàm `.toLowerCase()` trên một trường dữ liệu của bản ghi đối chiếu mà trường đó đang mang giá trị `null` hoặc `undefined` (do khách hàng không có thông tin hoặc dữ liệu trống). | Ép kiểu dữ liệu an toàn về dạng chuỗi trước khi chuyển chữ thường: `String(val \|\| "").toLowerCase()`. |
| **KPI & Báo Cáo** | `ReportService.js` | Lệch số liệu Thi Đua (`THI_DUA`) so với Thực Tế (`HIEN_TAI`) của các nhân sự ngày đầu chiến dịch. | Khi tạo chiến dịch, `NgayBatDau` lưu thời gian giờ của máy chủ (ví dụ `17:02:09`). Bộ lọc ngày chiến dịch dùng so sánh `gdDate < start` đã lọc bỏ tất cả giao dịch trước 17:02 ngày đầu tiên. | Chuẩn hóa thời gian bắt đầu chiến dịch về `00:00:00.000` của ngày bắt đầu bằng `start.setHours(0, 0, 0, 0)`. |

---
*Tài liệu này được thiết lập làm kim chỉ nam để triển khai kiểm thử và sửa đổi mã nguồn một cách an toàn nhất.*
