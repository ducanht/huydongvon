// ==========================================
// NHANSUSERVICE.GS - Quản lý Nhân Sự
// ==========================================

var NhanSuService = {
  getAll: function(useCache) {
    return Repository.getAll(CONFIG.SHEETS.NHANSU, useCache);
  },
  
  getActiveNhanSu: function() {
    return this.getAll().filter(function(ns) {
      return ns.TrangThai === "ACTIVE";
    });
  },
  
  getByEmail: function(email) {
    return this.getAll().filter(function(ns) {
       return ns.Email === email;
    })[0];
  },
  
  /**
   * Thêm mới hoặc Cập nhật thông tin Nhân Sự
   */
  saveNhanSu: function(payload) {
    ValidatorService.requireFields(payload, ["HoTen", "Email", "Role"]);
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var allNS = this.getAll(false); // Lấy data mới nhất trực tiếp dưới lock
      
      if (payload.MaNV) {
        // Flow CẬP NHẬT
        var existNS = allNS.filter(function(ns) { return ns.MaNV === payload.MaNV; })[0];
        if (!existNS) throw new Error("Không tìm thấy Nhân sự cần sửa!");
        
        var emailExist = allNS.filter(function(ns) { 
            return ns.Email === payload.Email && ns.MaNV !== payload.MaNV; 
        }).length > 0;
        if (emailExist) throw new Error("Email này đã được sử dụng bởi Cán bộ khác.");
        
        Repository.updateBatch(CONFIG.SHEETS.NHANSU, [{
          rowIndex: existNS._rowIndex,
          data: {
            HoTen: payload.HoTen,
            Email: payload.Email,
            Sdt: payload.Sdt ? ("'" + String(payload.Sdt).trim()) : "",
            Role: payload.Role,
            TrangThai: payload.TrangThai || "ACTIVE"
          }
        }]);
        return "Cập nhật thành công " + payload.MaNV;
      } else {
        // Flow THÊM MỚI
        var emailExistNew = allNS.filter(function(ns) { return ns.Email === payload.Email; }).length > 0;
        if (emailExistNew) throw new Error("Email đã tồn tại trên hệ thống!");
        
        var newID = Repository.generateId("NV_");
        
        // Mặc định sinh password là 123456
        var initPassword = "123456";
        var initHash = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";
        
        Repository.insert(CONFIG.SHEETS.NHANSU, {
           MaNV: newID, HoTen: payload.HoTen, Email: payload.Email,
           Sdt: payload.Sdt ? ("'" + String(payload.Sdt).trim()) : "", Role: payload.Role,
           TrangThai: payload.TrangThai || "ACTIVE", MatKhau: initHash
        });
        return "Thêm mới thành công " + newID + ". Mật khẩu khởi tạo là 123456 và tự động ép đổi (Làm mới sau khi đăng nhập).";
      }
    } catch(e) {
      throw new Error("Lỗi khi lưu Nhân sự: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Đổi mật khẩu cho người dùng hiện tại
   */
  changePassword: function(user, oldHash, newHash) {
    if (!oldHash || !newHash) throw new Error("Dữ liệu mật khẩu không hợp lệ.");
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var allNS = this.getAll(false); // Lấy data mới nhất trực tiếp dưới lock
      var existNS = allNS.filter(function(ns) { return ns.MaNV === user.MaNV; })[0];
      
      if (!existNS) throw new Error("Không tìm thấy thông tin tài khoản.");
      var dbHash = existNS.MatKhau || "";
      if (dbHash !== oldHash) throw new Error("Mật khẩu hiện tại không chính xác.");
      if (oldHash === newHash) throw new Error("Mật khẩu mới không được trùng mật khẩu cũ.");
  
      // Cập nhật Mật khẩu
      Repository.updateBatch(CONFIG.SHEETS.NHANSU, [{
          rowIndex: existNS._rowIndex,
          data: {
            MatKhau: newHash
          }
      }]);
  
      return "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.";
    } catch(e) {
      throw new Error("Lỗi đổi mật khẩu: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * [C2] Admin Reset mật khẩu
   */
  resetPassword: function(adminUser, targetMaNV) {
    if (adminUser.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Bạn không có quyền thực hiện chức năng này.");
    }
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var allNS = this.getAll(false); // Lấy data mới nhất trực tiếp dưới lock
      var targetNS = allNS.filter(function(ns) { return ns.MaNV === targetMaNV; })[0];
      if (!targetNS) throw new Error("Không tìm thấy nhân viên " + targetMaNV);
  
      // Reset mật khẩu mặc định: 123456
      var newHash = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";
      
      Repository.updateBatch(CONFIG.SHEETS.NHANSU, [{ rowIndex: targetNS._rowIndex, data: { MatKhau: newHash } }]);
  
      return "Mật khẩu của " + targetNS.HoTen + " (" + targetNS.Email + ") đã được đặt lại thành: 123456. Cán bộ bắt buộc phải đổi lại mật khẩu khi đăng nhập.";
    } catch(e) {
      throw new Error("Lỗi đặt lại mật khẩu: " + e.message);
    } finally {
      lock.releaseLock();
    }
  }
};
