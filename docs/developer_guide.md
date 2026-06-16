# Hướng Dẫn Phát Triển & Lưu Ý Bảo Trì (HuyDongVon Project)

Tài liệu này ghi lại các quy trình phát triển, kiến trúc đối chiếu sổ, hệ thống tối ưu hiệu năng (Caching), và các lưu ý quan trọng để phục vụ cho các lần làm việc tiếp theo trên dự án `HuyDongVon`.

---

## 1. Quy Trình Phát Triển & Triển Khai (Vite + GAS)

Dự án sử dụng kiến trúc Single Page Application (SPA) viết bằng Vite ở frontend và Google Apps Script (GAS) làm máy chủ dữ liệu ở backend.

### Cấu Trúc Dự Án
- `src/frontend/`: Chứa mã nguồn HTML/JS/CSS của các phân hệ giao diện.
- `src/backend/`: Chứa các dịch vụ (Services), lõi router (`Main.js`), và cấu hình chạy trên Google Apps Script.
- `index.html`: ENTRYPOINT chính chứa các thẻ `<template>` nhúng giao diện con.
- `dist/`: Thư mục chứa mã nguồn đã build hoàn tất để đồng bộ lên GAS.

### Quy Trình Deploy Lên GAS (Quan trọng)
Khi có sự thay đổi ở cả frontend và backend, bạn **phải** chạy tập lệnh build để đồng bộ và deploy lên GAS:
1. Chạy file build tự động:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scratch/build_and_push.ps1
   ```
2. Tập lệnh sẽ thực hiện liên hoàn:
   - `node bundle_templates.js`: Nhúng toàn bộ file HTML trong `src/frontend/` vào các thẻ `<template>` trong `index.html`.
   - `vite build`: Biên dịch và inlining toàn bộ tài nguyên (CSS, JS) vào một file duy nhất `dist/index.html`.
   - `node build.js`: Sao chép cấu hình `appsscript.json` và mã nguồn backend `src/backend/` sang `dist/`.
   - `clasp push`: Đồng bộ toàn bộ thư mục `dist/` lên máy chủ Google.
   - `clasp deploy -i <Deployment_ID> -d <Description>`: Cập nhật bản phát hành của Web App sang phiên bản mới nhất.

> [!IMPORTANT]
> **Không được thiếu bước `clasp push`**: `clasp deploy` chỉ tạo bản phát hành từ các tệp đã có trên máy chủ Google. Nếu không chạy `clasp push` trước, các thay đổi mã nguồn cục bộ sẽ không được đưa lên GAS.

---

## 2. Kiến Trúc Đối Chiếu Sổ (Reconciliation)

Cơ chế đối chiếu hoạt động bằng cách so sánh danh sách sổ đang hoạt động (`ACTIVE`) trên App với danh sách sổ thực tế của hệ thống lõi (Core) trong bảng `DB_SYS_STK` (cột `SO_SO_TG`).

### Sổ Tiết Kiệm Ảo (Ghost Books)
- Là các sổ tồn tại trên ứng dụng nhưng **không** tìm thấy số sổ trong `DB_SYS_STK`.
- Khi đối chiếu, các sổ này cần được **tất toán** (đóng sổ) để khớp đúng số liệu thực tế.

### Quy Trình Tất Toán Đối Chiếu Thủ Công (Selective Reconciliation)
- Sử dụng giao diện đối chiếu trong `frmSoTietKiem.html` để quét danh sách sổ lệch.
- Cho phép người dùng chọn từng sổ thông qua các ô checkbox.
- Gọi API `executeReconciliation` và truyền mảng các sổ đã được chọn:
  1. Tạo giao dịch rút (`LoaiGD = "RUT"`, `TrangThai = "ACTIVE"`, `DuyetBoi = "SYS_RECONCILE"`) để ghi nhận tiền đã rút và trừ KPI tương ứng của cán bộ quản lý.
  2. Cập nhật trạng thái sổ tiết kiệm thành `CLOSED` và số dư về `0`.
  3. Cập nhật lại KPI tổng hợp (`Summary KPI`) của cán bộ.

---

## 3. Hệ Thống Tối Tối Hiệu Năng & Memory Caching

### Backend: Tối ưu CacheService qua Batch Operations & Phân Mảnh (Chunking)
Google Apps Script giới hạn dung lượng cache **100KB** mỗi khóa và có độ trễ lớn khi gọi dịch vụ bên ngoài. Lớp đệm `CacheServiceWrapper` (trong [CacheService.js](file:///e:/Google%20Antigravity/HuyDongVon/src/backend/core/CacheService.js)) giải quyết giới hạn này bằng cơ chế phân mảnh thông minh:

- **Giới hạn an toàn**: Sử dụng `CHUNK_SIZE_LIMIT = 90KB` để chia nhỏ dữ liệu JSON.
- **Quy trình ghi (put)**:
  - Nếu dữ liệu nhỏ hơn 90KB, lưu bình thường qua 1 key duy nhất.
  - Nếu dữ liệu lớn hơn 90KB, tự động phân rã thành các khóa con `{key}_chunk_0`, `{key}_chunk_1`,... và lưu thông tin mảnh vào khóa chính (`__isChunked: true` kèm `count` trong Metadata).
  - Sử dụng API hàng loạt `cache.putAll(batchMap, expiration)` để lưu Metadata và các chunks đồng thời trong một I/O roundtrip duy nhất.
- **Quy trình đọc (get)**:
  - Đọc khóa chính lấy Metadata. Nếu đã phân mảnh, lập danh sách khóa con và gọi hàng loạt `cache.getAll(chunkKeys)` để lấy toàn bộ mảnh cùng lúc, ráp nối và parse JSON ngược lại.
- **Lưu ý lập trình**:
  - **Không dùng vòng lặp gọi đơn lẻ**: Tuyệt đối tránh gọi `cache.get()` / `cache.put()` trong vòng lặp vì sẽ tạo độ trễ kết nối mạng lớn.
  - **Sử dụng APIs hàng loạt** (`cache.getAll`, `cache.putAll`, `cache.removeAll`) để tối ưu hóa hiệu năng.

### Client-side: In-Memory Static Cache
Để tăng độ mượt khi chuyển tab, `AppManager` (trong `src/frontend/assets/js/app.js`) duy trì một bộ nhớ tạm RAM `_clientCache` cho các dữ liệu tĩnh.

- **Các API được cache**: `getAllChienDich`, `getNhanSuActive`, `getUserProfile`.
- **Cơ chế hoạt động**:
  - Khi gọi `AppManager.callApi()`, nếu hành động thuộc danh sách trên và đã có cache, trả về dữ liệu clone (`JSON.parse(JSON.stringify(cacheData))`) ngay lập tức (độ trễ 0ms).
  - **Auto-Invalidation (Xóa cache tự động)**: Bất kỳ khi nào có tác vụ ghi dữ liệu (được nhận dạng qua regex `/submit|save|duyet|huy|insert|update|delete|archive|clear/i`), hệ thống sẽ làm trống bộ đệm `this._clientCache = {}` để đảm bảo dữ liệu tiếp theo tải về là mới nhất.

---

## 4. Thiết Kế Responsive & Tối Ưu Mobile (`table-mobile-cards`)

Dự án áp dụng tư duy thiết kế Mobile-First để tối ưu giao diện hiển thị cho cả Desktop và Mobile. Thành phần quan trọng nhất là cơ chế biến đổi bảng dữ liệu thành dạng thẻ trên màn hình nhỏ:

- **Nguyên lý hoạt động**:
  - Trên màn hình di động ($\le 575.98px$), lớp CSS `.table-mobile-cards` sẽ ẩn đi tiêu đề cột `thead` và chuyển các thẻ `table`, `tbody`, `tr` sang dạng khối (`display: block` hoặc `display: flex`).
  - Mỗi hàng (`tr`) biến thành một card độc lập, các ô cột (`td`) chuyển thành hàng ngang flex với `justify-content: space-between`.
  - Phía bên trái hiển thị nhãn của cột bằng cách lấy thuộc tính `data-label` của thẻ `td` thông qua CSS: `content: attr(data-label)`. Dữ liệu gốc nằm ở bên phải.
- **Lưu ý lập trình**:
  - Khi cấu hình DataTables trên frontend (ví dụ: `frmKhachHang.html`, `frmSoTietKiem.html`), luôn định nghĩa `createdCell` hoặc `render` để chèn thuộc tính `data-label` tương ứng vào từng thẻ `td`:
    ```javascript
    columnDefs: [
      {
        targets: "_all",
        createdCell: function (td, cellData, rowData, row, col) {
          var headers = ["Mã KH", "Họ và Tên", "CCCD", ...];
          $(td).attr('data-label', headers[col]);
        }
      }
    ]
    ```

---

## 5. Các "Bẫy" Lập Trình (Common Gotchas & Bugs)

1. **Lỗi Scope Hoisting biến trong GAS**:
   Trong môi trường Apps Script, do cách biên dịch và hoist biến, hãy luôn đảm bảo khai báo và khởi tạo biến trước khi gọi kiểm tra hoặc so sánh điều kiện của biến đó (ví dụ lỗi logic `khNetThisNV` trước đó).
2. **Date Parser và Múi Giờ**:
   - `ValidatorService.parseDate` khi xử lý chuỗi ngày không có giờ (`YYYY-MM-DD`) sẽ lấy giờ hệ thống hiện tại của GAS. Điều này làm sai lệch thời gian so sánh và lọc bỏ các giao dịch diễn ra sớm trong ngày.
   - **Cách xử lý**: Luôn đặt giờ đầu ngày và cuối ngày một cách tường minh cho các bộ lọc ngày:
     ```javascript
     if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
     if (denNgay) denNgay.setHours(23, 59, 59, 999);
     ```
3. **Single Runner Singleton ở Local Dev**:
   - Khi chạy ở môi trường phát triển local, đối tượng mock `window.google.script.run` phải sử dụng mô hình **Factory** (sinh runner instance mới độc lập cho mỗi API call). 
   - Tránh sử dụng mô hình **Singleton** vì các cuộc gọi API đồng thời (concurrent calls) sẽ ghi đè callback handler của nhau, gây treo ứng dụng hoặc lặp vô hạn.
