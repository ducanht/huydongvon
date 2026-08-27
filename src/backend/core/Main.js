// ==========================================
// MAIN.GS - API Gateway & SPA Entry Point
// ==========================================

/**
 * Xử lý GET request (Khởi chạy trang Web)
 * Trả về index.html được đóng gói bởi Vite.
 */
function doGet(e) {
  try {
    return HtmlService.createHtmlOutputFromFile("index")
      .setTitle(CONFIG.APP_NAME || "Quản Lý Huy Động Vốn - QTDND Yên Thọ")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    return HtmlService.createHtmlOutput("Lỗi khởi tạo ứng dụng: " + error.message);
  }
}

/**
 * Xử lý POST request (API gateway dành riêng cho Local Dev Proxy)
 */
function doPost(e) {
  try {
    var postData = JSON.parse(e.postData.contents);
    var action = postData.action;
    var payload = postData.payload;
    
    // Chuyển tiếp yêu cầu trực tiếp vào API Gateway gốc của hệ thống
    var resultStr = doApiRequest(action, payload);
    
    return ContentService.createTextOutput(resultStr)
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.message || error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Hàm load file HTML
 */
function loadHtml(filename, args) {
  var template = HtmlService.createTemplateFromFile(filename);
  if (args) {
    for (var key in args) {
      template[key] = args[key];
    }
  }
  return template.evaluate()
    .setTitle(CONFIG.APP_NAME)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // Nếu cần nhúng Iframe
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Web App gọi hàm File Bao gồm
 */
function include(filename) {
  try {
    return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
  } catch (e) {
    // Fallback in case the file does not have valid scriplets
    try {
      return HtmlService.createHtmlOutputFromFile(filename).getContent();
    } catch (e2) {
      // Bỏ qua lỗi hiển thị trang nguyên khối. Nếu một tệp bị thiếu/xoá (như frmChienDich)
      // Hệ thống thay vì chết cứng (Crash) sẽ bỏ qua và chèn 1 đoạn mã HTML lỗi vào thẻ cha
      // Giúp 90% giao diện còn lại vẫn chạy bình thường.
      LoggerService.log("SYSTEM_ERROR", "include", "MISSING_MODULE", { filename: filename, error: e2.message });
      return "<div class='alert alert-danger p-3 m-3 shadow-sm border-0 border-start border-4 border-danger'>" +
             " <h6 class='fw-bold text-danger mb-1'><i class='bx bx-error-circle'></i> Lỗi Tải Module</h6>" +
             " <p class='mb-0 small text-muted'>Không thể nạp Giao diện <b>" + filename + "</b> do tệp tin đã bị xóa hoặc đổi phân hệ.</p>" +
             "</div>";
    }
  }
}

/**
 * CHUYỂN TIẾP AJAX (API Endpoint)
 * Tất cả lệnh gọi Client-Side gọi qua google.script.run doApiRequest()
 */
function doApiRequest(action, payload) {
  try {
    var user = null;
    
    // 1. Phân quyền và Validation theo Route (Bằng Token)
    if (action !== 'login') {
       // Ngoại lệ: Cho phép tải giao diện Login mà không cần Token
       var isPublicModule = (action === 'getHtmlModule' && payload && payload.moduleName === 'frmLogin');
       
       if (!isPublicModule) {
          if (!payload || !payload.token) {
             throw new Error("Không tìm thấy Session Token. Vui lòng đăng nhập lại.");
          }
          user = AuthService.authenticateToken(payload.token);
          if (!user) {
             throw new Error("TOKEN_EXPIRED"); // Mã lỗi đặc biệt để Client tự văng ra màn hình Login
          }
          if (payload.ClientIP) {
             user.IP = payload.ClientIP;
          }
       }
        if (user) {
           if (user.RequirePasswordChange && action !== 'changePassword' && action !== 'clearSessionToken' && action !== 'logout' && action !== 'getUserProfile') {
              throw new Error("Bạn bắt buộc phải Đổi Mật Khẩu ở lần đăng nhập đầu tiên để tiếp tục sử dụng hệ thống.");
           }
           Logger.log("[API] Action: " + action + " | User: " + user.MaNV + " | Role: " + user.Role);
        }
    }
    
    // --- API CACHE LAYER (READ ONLY) ---
    var cacheableActions = [
      'getDashboardData', 'getDashboardKpi', 'getLeaderboard',
      'getLichSuDatatable', 'getKhachHangDatatable', 'getSoTietKiemDatatable', 'getManagedKhachHangDatatable',
      'getBaoCaoTangTruong', 'getBaoCaoTongHop_ChienDich', 'getBaoCaoChiTietUser', 'getSotietkiemManagedByUser',
      'getPendingGiaoDich', 'getPendingCount', 'getNhanSuActive', 'getAllChienDich', 'getChienDichActive',
      'getSoTietKiemActive', 'getKhachHangActive', 'getEmployeeDetails',
      'getChienDichOverviewStats', 'getChienDichGroupedList'
    ];
    
    var isCacheable = cacheableActions.indexOf(action) !== -1;
    var cacheKey = null;
    
    if (isCacheable) {
      var version = getCacheVersion();
      var payloadStr = payload ? JSON.stringify(payload) : "";
      cacheKey = "API_RESP_v" + version + "_" + action + "_" + (user ? user.MaNV : "GUEST") + "_" + (user ? user.Role : "") + "_" + payloadStr;
      cacheKey = cacheKey.replace(/[^a-zA-Z0-9_]/g, "_");
      if (cacheKey.length > 200) {
        var rawDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, cacheKey);
        var hash = "";
        for (var i = 0; i < rawDigest.length; i++) {
          var byteVal = rawDigest[i];
          if (byteVal < 0) byteVal += 256;
          var byteString = byteVal.toString(16);
          if (byteString.length == 1) byteString = "0" + byteString;
          hash += byteString;
        }
        cacheKey = cacheKey.substring(0, 150) + "_" + hash;
      }
      
      var cachedData = CacheServiceWrapper.get(cacheKey);
      if (cachedData !== null) {
        return JSON.stringify({ status: "success", data: cachedData });
      }
    }

    var result = null;
    
    // 2. Dispatchers
    switch (action) {
      // --- SYSTEM / AUTH ---
      case 'login':
          result = AuthService.loginWithPassword(payload.email, payload.hash);
          break;
      
      case 'changePassword':
          result = NhanSuService.changePassword(user, payload.oldHash, payload.newHash);
          break;
          
      case 'resetPassword':
          // Security Phase 6 Remediation: Enforce HR/Admin Roles
          if (!user || (user.Role !== 'ADMIN' && user.Role !== 'TP_NHANSU')) {
              throw new Error('Bạn không có quyền thực hiện thao tác đặt lại mật khẩu nhân sự.');
          }
          result = NhanSuService.resetPassword(user, payload.targetMaNV);
          break;
          
      case 'getUserProfile':
          result = user;
          break;
          
      // --- GET DATA DASHBOARD ---
      case 'getHtmlModule':
          var ALLOWED_MODULES = [
              'frmDashboard', 'frmKhachHang', 'frmLichSuGiaoDich',
              'frmGiaoDichGui', 'frmGiaoDichRut', 'frmChiTieu',
              'frmNhanSu', 'frmBaoCao', 'frmSoTietKiem',
              'frmChoDuyet', 'frmDuyetGiaoDich', 'frmDoiMatKhau',
              'frmHeThong', 'frmTangTruong'
          ];
          if (!payload.moduleName || ALLOWED_MODULES.indexOf(payload.moduleName) === -1) {
              throw new Error("Module '" + (payload.moduleName || '') + "' không hợp lệ hoặc không tồn tại.");
          }
          var htmlContent = include('src/frontend/' + payload.moduleName);
          result = { html: htmlContent };
          break;

      // Endpoint gộp: Lấy KPI + Leaderboard cùng lúc (1 API call thay vì 2)
      case 'getDashboardData':
          result = {
              kpi: KPIService.getSummary(user, payload),
              leaderboard: ReportService.getLeaderboard(user, payload)
          };
          break;

      case 'getDashboardKpi':
          result = KPIService.getSummary(user, payload);
          break;
      case 'getLeaderboard':
          result = ReportService.getLeaderboard(user, payload);
          break;
      case 'getEmployeeDetails':
          if (user.Role !== CONFIG.ROLES.ADMIN && payload.MaNV !== user.MaNV) {
              throw new Error("Bạn không có quyền xem chi tiết giao dịch của Cán bộ khác.");
          }
          result = ReportService.getEmployeeDetails(payload);
          break;
          
      // --- GIAO DỊCH ---
      case 'submitGiaoDichGui':
          result = GiaoDichService.themGiaoDichGui(user, payload);
          break;
      case 'submitGiaoDichRut':
          // Giao dịch rút sẽ ở trạng thái PENDING chờ Admin duyệt, nên USER được phép tạo lệnh.
          result = GiaoDichService.themGiaoDichRut(user, payload);
          break;
      case 'submitHuyGiaoDich':
          result = GiaoDichService.huyGiaoDich(user, payload.MaGD);
          break;
      case 'revertGiaoDich':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được phép đảo ngược giao dịch đã duyệt.");
          result = GiaoDichService.revertGiaoDichThanhCong(user, payload.MaGD);
          break;
      case 'getLichSuGiaoDich':
          result = GiaoDichService.getLichSu(user);
          break;
      case 'getPendingGiaoDich':
          // API tối ưu chỉ trả về PENDING - dùng cho trang Chờ Duyệt
          result = GiaoDichService.getPendingGiaoDich(user);
          break;
      case 'getPendingCount':
          // Chỉ đếm số PENDING - dùng cho badge Admin (hiệu quả hơn lấy toàn bộ)
          result = GiaoDichService.getPendingCount(user);
          break;
      case 'getLichSuDatatable':
          result = GiaoDichService.getLichSuDatatable(user, payload);
          break;
      case 'archiveTransactions':
          result = GiaoDichService.archiveTransactions(user);
          break;
      
      // --- DANH MỤC ---
      case 'getChienDichActive':
          result = ChienDichService.getActive();
          break;
      case 'getSoTietKiemActive':
          result = SoTietKiemService.getActiveByUser(user);
          break;
      case 'getKhachHangActive':
          result = KhachHangService.getAll();
          break;
      case 'getKhachHangDatatable':
          result = KhachHangService.getDatatable(user, payload);
          break;
      
      case 'getSoTietKiemDatatable':
          result = SoTietKiemService.getDatatable(user, payload);
          break;
      case 'getManagedKhachHangDatatable':
          result = SoTietKiemService.getManagedKhachHangDatatable(user, payload);
          break;
      
      // --- ĐỐI CHIẾU SỔ TỰ ĐỘNG ---
      case 'analyzeReconciliation':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được phép thao tác đối chiếu hệ thống.");
          result = SoTietKiemService.analyzeReconciliation();
          break;
      case 'executeReconciliation':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được phép tất toán tự động hệ thống.");
          result = SoTietKiemService.executeReconciliation(user, payload);
          break;
      
      // --- CHỨC NĂNG ADMIN ---
      case 'getSystemDiagnostics':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được xem chẩn đoán.");
          result = diagnoseSheetStructure();
          break;
      case 'auditDatabaseIntegrity':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được rà soát dữ liệu.");
          result = auditDatabaseIntegrity();
          break;
      case 'getAllNhanSu':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được xem danh sách nhân sự.");
          result = NhanSuService.getAll();
          break;
      case 'getNhanSuActive':
          result = NhanSuService.getActiveNhanSu();
          break;
      case 'saveNhanSu':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được thêm/sửa nhân sự.");
          result = NhanSuService.saveNhanSu(payload);
          break;
      case 'getAllChienDich':
          result = ChienDichService.getAll();
          break;
      case 'getChienDichOverviewStats':
          result = ChienDichService.getChienDichOverviewStats();
          break;
      case 'getChienDichGroupedList':
          result = ChienDichService.getChienDichGroupedList();
          break;
      case 'saveChienDich':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được quản lý chiến dịch.");
          result = ChienDichService.saveChienDich(payload);
          break;
      case 'getChiTieuNhanVien':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được phân bổ KPI.");
          result = KPIService.getChiTieuNhanVien(payload.MaCD);
          break;
      case 'saveChiTieu':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được lưu KPI.");
          result = KPIService.saveChiTieu(user, payload);
          break;
      case 'copyChiTieuFromCampaign':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được sao chép chỉ tiêu KPI.");
          result = KPIService.copyChiTieuFromCampaign(user, payload);
          break;
      case 'saveKhachHang':
          result = KhachHangService.saveKhachHang(user, payload);
          break;
       case 'duyetGiaoDichGui':
       case 'submitDuyetRutTatToan':
       case 'duyetGiaoDich': // Common endpoint
           if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được duyệt lệnh.");
           result = GiaoDichService.duyetGiaoDichGui(user, payload);
           break;
           
       case 'clearServerCache':
           Repository.clearAllCache();
           result = { status: 'success', message: 'Bộ nhớ tạm (Cache) trên Server đã được xóa sạch.' };
           break;
       case 'clearSessionToken':
           // [H2] Chỉ xóa token nếu token này chính xác thuộc về user request
           // user đã được xác thực ở đầu Main.gs (nếu không có user -> endpoint này sẽ reject trước)
           if (payload.token) {
               CacheService.getScriptCache().remove('SESSIONTOKEN_' + payload.token);
           }
           result = { status: 'success' };
           break;
      case 'getBaoCaoTongHop_ChienDich':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được xem báo cáo tổng hợp.");
          result = ReportService.getBaoCaoTongHop_ChienDich(user, payload);
          break;
      case 'getBaoCaoTangTruong':
          // Báo cáo tăng trưởng tiền gửi theo nghiệp vụ (KH mới + phần tăng của KH cũ)
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được xem báo cáo Tăng Trưởng.");
          result = ReportService.getBaoCaoTangTruong(user, payload);
          break;
      case 'getBaoCaoChiTietUser':
          result = ReportService.getBaoCaoChiTietUser(user, payload);
          break;
      case 'getSotietkiemManagedByUser':
          result = ReportService.getSotietkiemManagedByUser(user, payload);
          break;
      case 'initDummyData':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được khởi tạo dữ liệu.");
          result = DummyDataService.cleanAndGenerateRealisticData();
          break;
          
      // --- SYSTEM LOGS & ARCHIVE ---
      case 'getSystemLogs':
          result = SystemAdminService.getSystemLogs(user, payload);
          break;
      case 'getLogDetail':
          result = SystemAdminService.getLogDetail(user, payload);
          break;
      case 'clearSystemLogs':
          result = SystemAdminService.clearSystemLogs(user, payload);
          break;
      case 'getArchiveData':
          result = SystemAdminService.getArchiveData(user, payload);
          break;
      case 'recalculateAllKpi':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được phép đồng bộ lại dữ liệu KPI.");
          result = KPIService.recalculateAllSummary(user, payload);
          break;
      case 'deleteTestData':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được phép xóa dữ liệu kiểm thử.");
          result = SystemAdminService.deleteTestData(user, payload);
          break;
      case 'debugLeaderboardDates':
          if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được truy cập dữ liệu chẩn đoán.");
          result = (function() {
             var cdDateMap = _buildCdDateMap();
             var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
             var targetCD = cdDateMap[ValidatorService.normalizeId(payload.maCD)];
             var reports = [];
             allGD.forEach(function(gd) {
               if (gd.MaCD === payload.maCD) {
                 var gdDate = ValidatorService.parseDate(gd.NgayGD);
                 reports.push({
                   MaGD: gd.MaGD,
                   NgayGD: gd.NgayGD,
                   gdDateStr: gdDate ? gdDate.toISOString() : 'null',
                   gdDateTime: gdDate ? gdDate.getTime() : 0,
                   cdStartStr: targetCD && targetCD.start ? targetCD.start.toISOString() : 'null',
                   cdStartTime: targetCD && targetCD.start ? targetCD.start.getTime() : 0,
                   beforeStart: targetCD && targetCD.start && gdDate ? (gdDate.getTime() < targetCD.start.getTime()) : false,
                   afterEnd: targetCD && targetCD.end && gdDate ? (gdDate.getTime() > targetCD.end.getTime()) : false,
                   DuyetBoi: gd.DuyetBoi
                 });
               }
             });
             return { targetCD: targetCD, reports: reports };
          })();
          break;
      
      default:
          throw new Error("Hành động không hợp lệ: " + action);
    }
    
    
    var AUDIT_ACTIONS = [
        'login', 'submitGiaoDichGui', 'submitGiaoDichRut', 'duyetGiaoDich', 
        'duyetGiaoDichGui', 'submitDuyetRutTatToan', 'submitHuyGiaoDich',
        'revertGiaoDich', 'saveKhachHang', 'changePassword', 'resetPassword',
        'saveNhanSu', 'saveChienDich', 'saveChiTieu',  
        'archiveTransactions', 'clearServerCache', 'initDummyData',
        'clearSystemLogs', 'recalculateAllKpi', 'deleteTestData'
    ];
                         
    // Hàm loại bỏ thông tin nhạy cảm trước khi log
    var sanitizePayload = function(p) {
        if (!p) return {};
        var safe = JSON.parse(JSON.stringify(p)); // Clone
        if (safe.hash) safe.hash = '***';
        if (safe.oldHash) safe.oldHash = '***';
        if (safe.newHash) safe.newHash = '***';
        if (safe.token) safe.token = '***';
        return safe;
    };
                         
    if (AUDIT_ACTIONS.indexOf(action) !== -1) {
        var logData = { 
           payload: sanitizePayload(payload),
           ip: payload.ClientIP || payload.ip || "0.0.0.0" 
        };
        if (result && Array.isArray(result)) logData.count = result.length;
        else if (result && result.data && Array.isArray(result.data)) logData.count = result.data.length;

        var userContextStr = user ? user.MaNV : (action === 'login' ? payload.email : 'SYSTEM');
        LoggerService.log(action, "Execute API", "SUCCESS", logData, { MaNV: userContextStr, IP: logData.ip });
    }
    
    // Invalidate or save cache based on action type
    var writeActions = [
        'submitGiaoDichGui', 'submitGiaoDichRut', 'duyetGiaoDich', 
        'duyetGiaoDichGui', 'submitDuyetRutTatToan', 'submitHuyGiaoDich',
        'revertGiaoDich', 'saveKhachHang', 'changePassword', 'resetPassword',
        'saveNhanSu', 'saveChienDich', 'saveChiTieu', 'copyChiTieuFromCampaign', 
        'archiveTransactions', 'clearServerCache', 'initDummyData',
        'clearSystemLogs', 'recalculateAllKpi', 'deleteTestData',
        'executeReconciliation'
    ];
    if (writeActions.indexOf(action) !== -1) {
      invalidateApiCache();
    } else if (isCacheable && result !== null) {
      // Xác định TTL phân tầng theo loại Action (Cache Tiering)
      var ttl = CacheServiceWrapper.TIERS.WARM; // Mặc định 5 phút
      var hotActions = ['getDashboardData', 'getDashboardKpi', 'getLeaderboard', 'getDanhSachChoDuyet', 'getSotietkiemManagedByUser'];
      var coldActions = ['getDanhMucCauHinh', 'getSystemLogs', 'getChienDichOverviewStats', 'getSystemDiagnostics'];
      
      if (hotActions.indexOf(action) !== -1) {
        ttl = CacheServiceWrapper.TIERS.HOT; // 60s
      } else if (coldActions.indexOf(action) !== -1) {
        ttl = CacheServiceWrapper.TIERS.COLD; // 6 giờ
      }
      
      CacheServiceWrapper.put(cacheKey, result, ttl);
    }
    
    return JSON.stringify({ status: 'success', data: result });
    
  } catch (err) {
      if (typeof sanitizePayload === 'undefined') {
          var sanitizePayload = function(p) {
             if (!p) return {};
             var safe = JSON.parse(JSON.stringify(p));
             if (safe.hash) safe.hash = '***';
             if (safe.oldHash) safe.oldHash = '***';
             if (safe.newHash) safe.newHash = '***';
             if (safe.token) safe.token = '***';
             return safe;
          };
      }
      var ipFallback = payload ? (payload.ClientIP || payload.ip || "0.0.0.0") : "0.0.0.0";
      var logDataFail = { error: err.message, payload: sanitizePayload(payload), ip: ipFallback };
      var userContextFail = user ? user.MaNV : (action === 'login' && payload && payload.email ? payload.email : 'SYSTEM');
      LoggerService.log(action, "API Execute Failed", "FAILED", logDataFail, { MaNV: userContextFail, IP: ipFallback });
      return JSON.stringify({ status: 'error', message: err.message, stack: err.stack });
  }
}

/**
 * Lấy phiên bản Cache hiện tại (Generational Cache)
 */
function getCacheVersion() {
  var cache = CacheService.getScriptCache();
  var version = cache.get("API_CACHE_VERSION");
  if (version === null) {
    version = "1";
    cache.put("API_CACHE_VERSION", version, 12 * 60 * 60); // 12 hours
  }
  return version;
}

/**
 * Làm mới Cache của API Gateway (Tăng phiên bản cache)
 */
function invalidateApiCache() {
  var cache = CacheService.getScriptCache();
  var version = String(Date.now());
  cache.put("API_CACHE_VERSION", version, 12 * 60 * 60);
  Repository.clearAllCache();
}
