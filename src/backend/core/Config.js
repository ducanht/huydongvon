// ==========================================
// CONFIG.GS - Cấu hình hệ thống
// ==========================================

var CONFIG = {
  APP_NAME: "Hệ thống Quản trị Huy động vốn & Thi đua nội bộ",
  VERSION: "1.0.0",
  SHEETS: {
    NHANSU: "DB_NHANSU",
    KHACHHANG: "DB_KHACHHANG",
    KH_HISTORY: "DB_KH_HISTORY",
    CHIENDICH: "DB_CHIENDICH",
    CHITIEU: "DB_CHITIEU",
    SOTIETKIEM: "DB_SOTIETKIEM",
    GIAODICH: "DB_GIAODICH",
    SUMMARY: "DB_SUMMARY",
    LOG: "DB_LOG",
    CAUHINH: "DB_CAUHINH",
    GIAODICH_ARCHIVE: "DB_GIAODICH_ARCHIVE",
    STK_CORE: "DB_SYS_STK"
  },
  ROLES: {
    ADMIN: "ADMIN",
    USER: "USER"
  },
  GIAO_DICH: {
    GUI: "GUI",
    RUT: "RUT"
  },
  CACHE_TTL: 300, // 5 phút (300 giây) - Mặc định fallback
  CACHE_TTL_HOT: 120, // 2 phút cho dữ liệu phát sinh thường xuyên (Giao dịch, Summary)
  CACHE_TTL_COLD: 1800, // 30 phút cho danh mục tĩnh (Nhân sự, Khách hàng, Chiến dịch, Cấu hình)
  COLD_SHEETS: ["DB_NHANSU", "DB_KHACHHANG", "DB_CHIENDICH", "DB_CAUHINH"], // DB_CHITIEU được chuyển sang WARM TTL để phản ánh chỉ tiêu realtime
  EDIT_WINDOW_HOURS: 24, // Thời gian cho phép sửa/hủy giao dịch
  MIN_DEPOSIT_AMOUNT: 100000, // 100.000 VNĐ
  MIN_WITHDRAWAL_AMOUNT: 50000, // 50.000 VNĐ
  SYSTEM_PEPPER: "QTDND_YEN_THO_SECURE_PEPPER_2026", // Secret pepper dùng cho HMAC-SHA256 password hashing
  SPREADSHEET_ID: "1FHyyIr_S1u30ROB7szzCwtybmnbiFDjVYBmcerLCSCg" // ID chính thức từ người dùng
};

/**
 * Hàm lấy Spreadsheet Cơ sở dữ liệu.
 * Cơ chế tìm kiếm:
 * 1. Tìm trong Script Properties: SPREADSHEET_ID hoặc SHEET_ID
 * 2. Tìm trong file Config.gs: CONFIG.SPREADSHEET_ID
 * 3. Tìm Spreadsheet tên là 'DB_QTDND_YenTho' trong Drive (Dùng làm cứu cánh)
 * 4. Trả về ActiveSpreadsheet (nếu là bound script)
 */
function getDbSpreadsheet() {
  var ssId = null;
  var props = null;
  
  // 1. Kiểm tra Script Properties
  try {
    props = PropertiesService.getScriptProperties().getProperties();
    ssId = props['SPREADSHEET_ID'] || props['SHEET_ID'] || props['DATABASE_ID'];
  } catch(e) { 
    Logger.log("Không thể truy cập Script Properties: " + e.message);
  }
  
  // 2. Kiểm tra Config hardcode
  if (!ssId) ssId = CONFIG.SPREADSHEET_ID;
  
  // 3. Nếu tìm thấy ID -> Mở
  if (ssId && ssId.trim() !== "") {
    try {
      return SpreadsheetApp.openById(ssId.trim());
    } catch (e) {
      throw new Error("LỖI KẾT NỐI: Không thể mở Spreadsheet với ID '" + ssId + "'. Hãy đảm bảo ID chính xác và Script có quyền truy cập. Chi tiết: " + e.message);
    }
  }
  
  // 4. Cứu cánh: Tìm theo tên trong Drive
  try {
    var files = DriveApp.getFilesByName("DB_QTDND_YenTho");
    if (files.hasNext()) {
      var file = files.next();
      Logger.log("Đã tìm thấy Database bằng DriveApp: " + file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  } catch (e) {
     Logger.log("Không thể tìm kiếm trong Drive: " + e.message);
  }
  
  // 5. Fallback cuối cùng
  var activeSs = SpreadsheetApp.getActiveSpreadsheet();
  if (!activeSs) {
    throw new Error("LỖI CẤU HÌNH: Không tìm thấy ID Spreadsheet. Hãy dán ID vào Config.gs (dòng 31) hoặc thiết lập Script Property 'SPREADSHEET_ID'.");
  }
  
  return activeSs;
}
