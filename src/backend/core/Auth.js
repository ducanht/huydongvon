// ==========================================
// AUTH.GS - Xác thực và phân quyền (Tùy chỉnh)
// ==========================================

var AuthService = {
  
  /**
   * Tính mã băm Salted HMAC-SHA256
   * Kết hợp mật khẩu từ Client + Salt của User + System Pepper
   */
  hashWithSalt: function(clientHash, salt) {
    if (!clientHash) return "";
    var pepper = CONFIG.SYSTEM_PEPPER || "QTDND_YEN_THO_SECURE_PEPPER_2026";
    var rawBytes = Utilities.computeHmacSha256Signature(String(clientHash) + ":" + String(salt || ""), pepper);
    var hex = "";
    for (var i = 0; i < rawBytes.length; i++) {
      var byteVal = rawBytes[i];
      if (byteVal < 0) byteVal += 256;
      var byteStr = byteVal.toString(16);
      if (byteStr.length === 1) byteStr = "0" + byteStr;
      hex += byteStr;
    }
    return hex;
  },

  /**
   * Xác thực bằng Mật khẩu (Cho trang Login)
   * Hỗ trợ xác thực Salted HMAC và tự động di trú (Auto-migrate) tài khoản cũ.
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
    var colSalt = headers.indexOf("Salt");
    
    if (colEmail === -1 || colTrangThai === -1 || colRole === -1 || colMatKhau === -1) {
        throw new Error("LỖI ĐỊNH DẠNG DB: Thiếu cột thiết yếu, đặc biệt là cột 'MatKhau' ở dòng 1 (Headers).");
    }
    
    var normalizedEmail = email.toLowerCase().trim();
    
    for (var i = 1; i < data.length; i++) {
      var sheetEmail = (data[i][colEmail] || "").toString().toLowerCase().trim();
      var trangThai = (data[i][colTrangThai] || "").toString().trim().toUpperCase();
      var dbHash = (data[i][colMatKhau] || "").toString();
      var dbSalt = colSalt !== -1 ? (data[i][colSalt] || "").toString().trim() : "";
      
      if (sheetEmail === normalizedEmail) {
        if (trangThai === "ACTIVE") {
          var isPasswordValid = false;
          var needsMigration = false;
          
          if (dbSalt !== "") {
            // Xác thực theo chuẩn Salted HMAC-SHA256 mới
            var computedHash = AuthService.hashWithSalt(hashPassword, dbSalt);
            isPasswordValid = (computedHash === dbHash);
          } else {
            // Xác thực tương thích ngược (Legacy SHA-256)
            isPasswordValid = (dbHash === hashPassword);
            if (isPasswordValid) {
              needsMigration = true; // Sẽ tự động nâng cấp Salt ngay
            }
          }
          
          // Nếu mật khẩu sai -> Ghi nhận thất bại
          if (!isPasswordValid) {
            cache.put(cacheKey, String(failCount + 1), LOCK_WINDOW_SECONDS);
            throw new Error("Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.");
          }
          
          // Mật khẩu đúng -> Reset fail counter
          cache.remove(cacheKey);
          
          // Tự động nâng cấp tài khoản cũ sang Salted HMAC-SHA256 (Zero-interruption Migration)
          if (needsMigration) {
            try {
              var newSalt = Utilities.getUuid();
              var upgradedHash = AuthService.hashWithSalt(hashPassword, newSalt);
              if (colSalt === -1) {
                // Nếu chưa có cột Salt trên sheet thì chèn cột Salt
                var lastCol = sheet.getLastColumn();
                sheet.getRange(1, lastCol + 1).setValue("Salt");
                colSalt = lastCol;
              }
              sheet.getRange(i + 1, colMatKhau + 1).setValue(upgradedHash);
              sheet.getRange(i + 1, colSalt + 1).setValue(newSalt);
              Logger.log(">> [SECURITY AUTO-MIGRATED] Nhân sự " + data[i][colMaNV] + " đã được nâng cấp sang Salted HMAC.");
            } catch (migErr) {
              Logger.log("Lỗi nâng cấp Salt: " + migErr.message);
            }
          }
          
          var defaultRawHash = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"; // Hash của '123456'
          var isDefaultPassword = (hashPassword === defaultRawHash);
          
          var user = {
            MaNV: data[i][colMaNV],
            HoTen: data[i][colHoTen],
            Email: email,
            Sdt: data[i][colSdt],
            Role: data[i][colRole], // ADMIN / USER
            RequirePasswordChange: isDefaultPassword
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
