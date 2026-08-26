# AGENT CONTEXT: DỰ ÁN HUYDONGVON (HUY ĐỘNG VỐN & BÁO CÁO TĂNG TRƯỞNG)

## 📌 Tổng Quan & Kiến Trúc
- **Chức năng**: Quản lý chiến dịch huy động vốn, thi đua bảng xếp hạng cán bộ và báo cáo tăng trưởng nguồn vốn.
- **Frontend**: Vite Single-file SPA + bundle script (`bundle_templates.js`).
- **Backend**: Google Apps Script (`src/backend`) + Google Sheets DB.

## ⚠️ Quy Trình Build & Deploy:
1. Trước khi build phải chạy `npm run bundle` để ghép các file template từ `html-templates` vào `index.html`.
2. Chạy `npm run build` để sinh ra `dist/index.html` và copy các script sang `dist/`.
3. Triển khai backend GAS qua lệnh `npm run clasp-push` hoặc `npm run clasp-redeploy`.
