// ==========================================
// CHIENDICHSERVICE.GS - Quản lý Chiến Dịch
// ==========================================

var ChienDichService = {
  
  /**
   * Lấy danh sách chiến dịch (Tất cả để Admin giao KPI linh hoạt)
   */
  getActive: function() {
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var todayStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
    
    // Chỉ lấy chiến dịch đang ACTIVE và trong thời hạn chạy (Đang diễn ra)
    var activeCD = allCD.filter(function(cd) {
      if (cd.TrangThai !== 'ACTIVE') return false;
      
      // Kiểm tra ngày bắt đầu (nếu có)
      if (cd.NgayBatDau) {
        var startStr = cd.NgayBatDau.indexOf('T') !== -1 ? cd.NgayBatDau.split('T')[0] : cd.NgayBatDau;
        if (startStr > todayStr) return false; // Chưa bắt đầu
      }
      
      // Kiểm tra ngày kết thúc (nếu có)
      if (cd.NgayKetThuc) {
        var endStr = cd.NgayKetThuc.indexOf('T') !== -1 ? cd.NgayKetThuc.split('T')[0] : cd.NgayKetThuc;
        if (endStr < todayStr) return false; // Đã hết hạn
      }
      
      return true;
    });
    
    activeCD.sort(function(a, b) {
      var getTimeSafe = function(d) {
        if (!d) return 0;
        var dt = new Date(d);
        return (!isNaN(dt.getTime())) ? dt.getTime() : 0;
      };
      var timeA = getTimeSafe(a.NgayBatDau);
      var timeB = getTimeSafe(b.NgayBatDau);
      return timeB - timeA;
    });
    
    return activeCD;
  },
  
  getAll: function() {
    return Repository.getAll(CONFIG.SHEETS.CHIENDICH);
  },
  
  /**
   * Thêm hoặc Cập nhật Chiến dịch
   */
  saveChienDich: function(payload) {
    ValidatorService.requireFields(payload, ["TenCD", "LoaiCD", "NgayBatDau"]);
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      // Đọc dữ liệu mới nhất không dùng cache
      var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH, false);
      
      var dateBatDau = ValidatorService.parseDate(payload.NgayBatDau);
      if (!dateBatDau) throw new Error("Ngày bắt đầu không hợp lệ.");
      
      var dateKetThuc = null;
      if (payload.NgayKetThuc) {
        dateKetThuc = ValidatorService.parseDate(payload.NgayKetThuc);
        if (!dateKetThuc) throw new Error("Ngày kết thúc không hợp lệ.");
        if (dateKetThuc.getTime() < dateBatDau.getTime()) {
          throw new Error("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");
        }
      }
      
      if (payload.MaCD) {
        // CẬP NHẬT
        var existCD = allCD.filter(function(cd) { return cd.MaCD === payload.MaCD; })[0];
        if (!existCD) throw new Error("Không tìm thấy Chiến dịch để sửa!");
        
        Repository.updateBatch(CONFIG.SHEETS.CHIENDICH, [{
          rowIndex: existCD._rowIndex,
          data: {
            TenCD: payload.TenCD,
            LoaiCD: payload.LoaiCD,
            NgayBatDau: dateBatDau,
            NgayKetThuc: dateKetThuc || "", // Rỗng tức là Vô thời hạn
            TrangThai: payload.TrangThai || "ACTIVE"
          }
        }]);
        return "Cập nhật thành công chiến dịch: " + payload.TenCD;
      } else {
        // THÊM MỚI
        var newID = Repository.generateId("CD_");
        Repository.insert(CONFIG.SHEETS.CHIENDICH, {
          MaCD: newID,
          TenCD: payload.TenCD,
          LoaiCD: payload.LoaiCD,
          NgayBatDau: dateBatDau,
          NgayKetThuc: dateKetThuc || "",
          TrangThai: payload.TrangThai || "ACTIVE"
        });
        return "Đã tạo mới chiến dịch: " + payload.TenCD;
      }
    } catch (e) {
      throw new Error(e.message);
    } finally {
      lock.releaseLock();
    }
  }
};
