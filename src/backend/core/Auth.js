// ==========================================
// AUTH.GS - Xác thực và phân quyền (Tùy chỉnh)
// ==========================================

var AuthService = {
  
  /**
   * Xác thực bằng Mật khẩu (Cho trang Login)
   * Client truyền lên mã hash SHA-256 để kiểm tra, tuyệt đối không gửi password thuần.
   */
  loginWithPassword: function(email, hashPassword) {
    if (!email || !hashPassword) {
      throw new Error("Vui lòng nhập đầy đủ Email và Mật khẩu.");
    }
    
    // [C4] Rate Limiting: Kiểm tra số lần đăng nhập sai trong 15 phút
    var cacheKey = 'LOGIN_FAIL_' + email.toLowerCase().trim();
    var cache = CacheService.getScriptCache();
    var failCount = parseInt(cache.get(cacheKey) || '0', 10);
    var MAX_ATTEMPTS = 5;
    var LOCK_WINDOW_SECONDS = 15 * 60; // 15 phút
    
    if (failCount >= MAX_ATTEMPTS) {
      throw new Error("Tài khoản tạm thời bị khóa do quá nhiều lần đăng nhập sai. Vui lòng thử lại sau 15 phút.");
    }
    
    var sheet = getDbSpreadsheet().getSheetByName(CONFIG.SHEETS.NHANSU);
    if (!sheet) throw new Error("Hệ thống lỗi: Không tìm thấy sheet " + CONFIG.SHEETS.NHANSU);
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) throw new Error("Hệ thống lỗi: Sheet DB_NHANSU không có đủ dữ liệu.");
    
    var headers = data[0];
    var colEmail = headers.indexOf("Email");
    var colTrangThai = headers.indexOf("TrangThai");
    var colRole = headers.indexOf("Role");
    var colMaNV = headers.indexOf("MaNV");
    var colHoTen = headers.indexOf("HoTen");
    var colSdt = headers.indexOf("Sdt");
    var colMatKhau = headers.indexOf("MatKhau");
    
    if (colEmail === -1 || colTrangThai === -1 || colRole === -1 || colMatKhau === -1) {
        throw new Error("LỖI ĐỊNH DẠNG DB: Thiếu cột thiết yếu, đặc biệt là cột 'MatKhau' ở dòng 1 (Headers).");
    }
    
    var normalizedEmail = email.toLowerCase().trim();
    var foundEmailButInactive = false;
    
    for (var i = 1; i < data.length; i++) {
      var sheetEmail = (data[i][colEmail] || "").toString().toLowerCase().trim();
      var trangThai = (data[i][colTrangThai] || "").toString().trim().toUpperCase();
      var dbHash = (data[i][colMatKhau] || "").toString();
      var requireChange = (dbHash === "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
      
      if (sheetEmail === normalizedEmail) {
        if (trangThai === "ACTIVE") {
          // Kiểm tra Password - nếu sai thì tăng fail counter rồi throw
          if (dbHash !== hashPassword) {
            cache.put(cacheKey, String(failCount + 1), LOCK_WINDOW_SECONDS);
            throw new Error("Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.");
          }
          
          // Mật khẩu đúng -> Reset fail counter + Tạo Token
          cache.remove(cacheKey);
          var user = {
            MaNV: data[i][colMaNV],
            HoTen: data[i][colHoTen],
            Email: email,
            Sdt: data[i][colSdt],
            Role: data[i][colRole], // ADMIN / USER
            RequirePasswordChange: requireChange
          };
          
          var token = Utilities.getUuid(); 
          // Lưu Token vào Cache trong 12 giờ
          CacheService.getScriptCache().put("SESSIONTOKEN_" + token, JSON.stringify(user), 43200); 
          
          return {
            token: token,
            user: user
          };
        } else {
          // Email tồn tại nhưng INACTIVE - vẫn trả về thông báo chung tránh user enumeration
          cache.put(cacheKey, String(failCount + 1), LOCK_WINDOW_SECONDS);
          throw new Error("Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.");
        }
      }
    }
    
    // Email không tồn tại trong hệ thống
    cache.put(cacheKey, String(failCount + 1), LOCK_WINDOW_SECONDS);
    throw new Error("Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.");
  },

  /**
   * Xác thực bằng Token (Cho các API Request sau khi đã đăng nhập)
   */
  authenticateToken: function(token) {
    if (!token) return null;
    var cached = CacheService.getScriptCache().get("SESSIONTOKEN_" + token);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  },
  
  verifyAccess: function(token, requiredRole) {
    if (!token) {
      throw new Error("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    }
    
    var user = this.authenticateToken(token);
    if (!user) {
      throw new Error("Truy cập bị từ chối: Token hết hạn, vui lòng đăng nhập lại.");
    }
    
    if (requiredRole && requiredRole === CONFIG.ROLES.ADMIN && user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Truy cập bị từ chối: Cần quyền Quản trị (ADMIN).");
    }
    
    return user;
  }
};
