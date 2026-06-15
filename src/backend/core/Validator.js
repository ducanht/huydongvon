// ==========================================
// VALIDATOR.GS - Kiểm tra dữ liệu đầu vào
// ==========================================

var ValidatorService = {
  /**
   * Kiểm tra chuỗi rỗng
   */
  isEmpty: function(value) {
    return (value === null || value === undefined || ("" + value).trim() === "");
  },
  
  /**
   * Validate CCCD/CMND Việt Nam: phải là 9 hoặc 12 chữ số liên tiếp
   */
  isValidCCCD: function(cccd) {
    if (this.isEmpty(cccd)) return false;
    var cleaned = String(cccd).trim().replace(/\s/g, '');
    return /^[0-9]{9}$/.test(cleaned) || /^[0-9]{12}$/.test(cleaned);
  },

  /**
   * Kiểm tra mức tiền tối thiểu
   */
  isPositiveAmount: function(amount) {
    if (this.isEmpty(amount)) return false;
    var num = parseFloat(amount);
    return !isNaN(num) && num > 0;
  },
  
  /**
   * Kiểm tra xem 2 thời điểm có nằm trong khoảng giới hạn sửa đổi (giờ) không
   */
  isWithinEditWindow: function(timestampStr, windowHours) {
    var ts = new Date(timestampStr).getTime();
    var now = new Date().getTime();
    var diffHours = (now - ts) / (1000 * 60 * 60);
    return diffHours <= windowHours;
  },
  
  /**
   * Validation bắt buộc các trường
   */
  requireFields: function(obj, fields) {
    var missing = [];
    fields.forEach(function(field) {
      if (ValidatorService.isEmpty(obj[field])) {
        missing.push(field);
      }
    });
    if (missing.length > 0) {
      throw new Error("Thiếu thông tin bắt buộc: " + missing.join(", "));
    }
  },
  
  /**
   * Chuyển đổi linh hoạt các định dạng ngày (dd/mm/yyyy hoặc ISO) sang Date object
   * Đồng thời khắc phục lỗi múi giờ 07:00 AM khi nhận chuỗi YYYY-MM-DD rỗng giờ
   */
  parseDate: function(dateVal) {
    if (!dateVal) return null;
    if (dateVal instanceof Date) return dateVal;
    
    var d = new Date(dateVal);
    if (d && d.getTime && !isNaN(d.getTime())) {
      // [FIX] Lỗi múi giờ: "YYYY-MM-DD" mặc định parse thành Nửa đêm UTC (07:00 AM VN)
      // Bổ sung Giờ/Phút/Giây hiện tại của máy chủ để khớp với thời gian thao tác thực.
      if (typeof dateVal === 'string' && dateVal.length === 10 && dateVal.indexOf('-') === 4) {
         var now = new Date();
         d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      }
      return d;
    }
    
    // Fallback cho định dạng dd/mm/yyyy (Phổ biến trên Google Sheets)
    if (typeof dateVal === 'string' && dateVal.indexOf('/') > -1) {
      try {
        var parts = dateVal.split('/');
        if (parts.length === 3) {
          var day = parseInt(parts[0], 10);
          var month = parseInt(parts[1], 10) - 1;
          var year = parseInt(parts[2], 10);
          var d2 = new Date(year, month, day);
          if (d2 && d2.getTime && !isNaN(d2.getTime())) return d2;
        }
      } catch(e) {}
    }
    return null;
  },

  /**
   * Sinh mật khẩu ngẫu nhiên cho tra cứu sổ (6 ký tự IN HOA/Số)
   */
  generateRandomPassword: function(length) {
    length = length || 6;
    var charset = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // Bỏ I, O dễ nhầm
    var retVal = "";
    for (var i = 0; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return retVal;
  },

  /**
   * Chuẩn hóa ID (MaNV, MaKH, MaCD) để so khớp không phân biệt chữ hoa thường
   */
  normalizeId: function(id) {
    if (this.isEmpty(id)) return "";
    // Xử lý cả trường hợp số hoặc các kiểu dữ liệu khác
    return String(id).toString().trim().toUpperCase(); // Sử dụng UPPERCASE để đồng bộ toàn hệ thống
  }
};
