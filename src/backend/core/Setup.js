// ==========================================
// SETUP.GS - Công cụ Khởi tạo Cơ sở Dữ liệu
// ==========================================

/**
 * Hướng dẫn sử dụng:
 * 1. Mở file Config.gs và điền SPREADSHEET_ID của bạn vào.
 * 2. Mở file Setup.gs này.
 * 3. Chọn hàm `runSetupDatabase` từ thanh công cụ bên trên và nhấn Run (Chạy).
 * 4. Cấp quyền truy cập nếu Google yêu cầu.
 * 5. Script sẽ tự động tạo tắt cả các Sheet và thiết lập Cột tiêu đề.
 */

var DB_SCHEMAS = {
  "DB_NHANSU": ["MaNV", "HoTen", "Email", "Sdt", "Role", "TrangThai", "MatKhau", "Salt"],
  "DB_KHACHHANG": ["MaKH", "HoTen", "CCCD", "DiaChi", "Sdt", "SoTheTV", "NgayTao", "TrangThai"],
  "DB_KH_HISTORY": ["HistoryID", "MaKH", "Action", "Timestamp", "Details", "NguoiThucHien", "IP"],
  "DB_CHIENDICH": ["MaCD", "TenCD", "LoaiCD", "NgayBatDau", "NgayKetThuc", "TrangThai"],
  "DB_CHITIEU": ["MaCD", "MaNV", "ChiTieu", "NgayPhanBo", "NguoiPhanBo"],
  "DB_SOTIETKIEM": ["SoSo", "MaKH", "MaNV", "MaCD", "NgayPhatHanh", "NgayDaoHan", "SoDuBanDau", "SoDuHienTai", "KyHan", "LoaiSanh", "LaiSuat", "LoaiLai", "TienLaiDuKien", "TrangThai"],
  "DB_GIAODICH": ["MaGD", "MaNV", "MaKH", "MaCD", "SoSo", "LoaiGD", "HinhThuc", "SoTien", "KyHan", "LoaiSanh", "LaiSuat", "LoaiLai", "NgayGD", "TrangThai", "GhiChu", "DuyetBoi", "NgayDuyet"],
  "DB_GIAODICH_ARCHIVE": ["MaGD", "MaNV", "MaKH", "MaCD", "SoSo", "LoaiGD", "HinhThuc", "SoTien", "KyHan", "LoaiSanh", "LaiSuat", "LoaiLai", "NgayGD", "TrangThai", "GhiChu", "DuyetBoi", "NgayDuyet"],
  "DB_SUMMARY": ["MaNV", "MaCD", "TongGui", "TongRut", "Net", "ChiTieu", "LastUpdate"],
  "DB_LOG": ["LogID", "Timestamp", "User", "Action", "Description", "Status", "Details", "IP"],
  "DB_CAUHINH": ["Key", "Value", "Description"],
  "DB_SYS_STK": ["SO_SO_TG", "MA_KH", "TEN_KH", "SO_DU_GOC", "NGAY_MO", "NGAY_DAO_HAN", "LAST_SYNC"]
};

/**
 * Hàm Khởi tạo hoặc Đồng bộ toàn bộ Cơ sở dữ liệu
 * Chạy hàm này để:
 * 1. Tạo các Sheet còn thiếu.
 * 2. Bổ sung các cột tiêu đề còn thiếu vào các Sheet cũ.
 * 3. Định dạng lại bảng (Freeze, Bold, Background).
 */
function runSetupDatabase() {
  var ss = getDbSpreadsheet();
  if (!ss) {
    Logger.log("LỖI: Không tìm thấy Spreadsheet. Hãy kiểm tra SPREADSHEET_ID.");
    return;
  }
  
  Logger.log("=== BẮT ĐẦU THIẾT LẬP CƠ SỞ DỮ LIỆU ===");
  
  for (var sheetName in DB_SCHEMAS) {
    var expectedColumns = DB_SCHEMAS[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      // 1. Nếu chưa có sheet -> Tạo mới chuyên nghiệp
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, expectedColumns.length).setValues([expectedColumns]);
      Logger.log(">> Đã tạo mới Sheet: " + sheetName);
    } else {
      // 2. Nếu đã có -> Đồng bộ nghiêm ngặt (Strict Sync)
      var lastCol = sheet.getLastColumn();
      var currentHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      
      /* 
      // Xoá các cột KHÔNG nằm trong cấu trúc (Duyệt ngược từ dưới lên)
      // [QUAN TRỌNG]: Tạm thời đóng để tránh xoá nhầm các cột ghi chú thủ công của người dùng
      for (var colIdx = lastCol; colIdx >= 1; colIdx--) {
        var header = String(currentHeaders[colIdx - 1]).trim();
        if (expectedColumns.indexOf(header) === -1) {
          sheet.deleteColumn(colIdx);
          Logger.log("   - [XOÁ] Cột thừa '" + header + "' tại " + sheetName);
        }
      }
      */

      // Lấy lại headers sau khi xoá để bổ sung cột thiếu
      lastCol = sheet.getLastColumn();
      currentHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); }) : [];
      
      expectedColumns.forEach(function(col) {
        if (currentHeaders.indexOf(col) === -1) {
          lastCol++;
          sheet.insertColumnAfter(lastCol - 1 || 1); // Đảm bảo chèn đúng
          sheet.getRange(1, lastCol).setValue(col);
          Logger.log("   - [THÊM] Cột thiếu '" + col + "' vào " + sheetName);
        }
      });

      Logger.log(">> Đã đồng bộ cấu trúc cho " + sheetName);
    }
    
    // 3. Định dạng Header và Freeze
    var finalColCount = sheet.getLastColumn();
    if (finalColCount > 0) {
      var headerRange = sheet.getRange(1, 1, 1, finalColCount);
      headerRange.setFontWeight("bold")
                 .setBackground("#f3f3f3")
                 .setHorizontalAlignment("center")
                 .setBorder(true, true, true, true, true, true);
      
      if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
    }
  }
  
  // 4. Khởi tạo tài khoản ADMIN mặc định nếu DB_NHANSU trống
  setupDefaultAdmin(ss);
  
  Logger.log("=== THIẾT LẬP HOÀN TẤT ===");
}

/**
 * Hàm hỗ trợ tạo Admin mặc định (ducanht.gemini@gmail.com)
 */
function setupDefaultAdmin(ss) {
  var nhanSuSheet = ss.getSheetByName(CONFIG.SHEETS.NHANSU);
  if (nhanSuSheet && nhanSuSheet.getLastRow() <= 1) {
    var defaultAdmin = [
      "NV_ADMIN", 
      "Quản Trị Viên", 
      "ducanht.gemini@gmail.com", 
      "0900000000", 
      CONFIG.ROLES.ADMIN, 
      "ACTIVE",
      "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92" // Hash SHA-256 của '123456'
    ];
    nhanSuSheet.appendRow(defaultAdmin);
    Logger.log(">> Đã tạo tài khoản ADMIN mặc định.");
  }
}

/**
 * Hàm Migrate Schema (Chạy lại nếu có thay đổi DB_SCHEMAS)
 * Thực chất là alias của runSetupDatabase để người dùng dễ hiểu
 */
function RUN_SCHEMA_MIGRATE() {
  runSetupDatabase();
}

/**
 * Hàm hỗ trợ tìm ID của Spreadsheet DB_QTDND_YenTho trong Drive của bạn.
 * Hãy chạy hàm này nếu bạn bị mất SPREADSHEET_ID.
 */
function FIND_DATABASE_ID() {
  try {
    var files = DriveApp.getFilesByName("DB_QTDND_YenTho");
    var found = false;
    while (files.hasNext()) {
      var file = files.next();
      Logger.log("=========================================");
      Logger.log(" TÌM THẤY DATABASE: " + file.getName());
      Logger.log(" ID CỦA BẠN LÀ: " + file.getId());
      Logger.log(" HÃY COPY ID NÀY VÀ DÁN VÀO Config.gs");
      Logger.log("=========================================");
      found = true;
    }
    if (!found) {
      Logger.log("Không tìm thấy file nào tên là 'DB_QTDND_YenTho'.");
    }
  } catch (e) {
    Logger.log("Lỗi khi tìm kiếm: " + e.message);
    Logger.log("Có thể bạn chưa cấp quyền DriveApp cho Script.");
  }
}
