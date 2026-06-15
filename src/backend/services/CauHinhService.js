// ==========================================
// CAUHINHSERVICE.GS - Quản lý Cấu hình hệ thống
// ==========================================

var CauHinhService = {
  /**
   * Lấy giá trị cấu hình theo Key
   */
  get: function(key, useCache) {
    if (!key) return null;
    var allConfigs = Repository.getAll(CONFIG.SHEETS.CAUHINH, useCache);
    var found = allConfigs.filter(function(item) {
      return item.Key === key;
    })[0];
    return found ? found.Value : null;
  },

  /**
   * Lưu hoặc cập nhật cấu hình theo Key
   */
  set: function(key, value, description) {
    if (!key) throw new Error("Key cấu hình không được để trống.");
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      // Đọc data mới nhất trực tiếp từ sheet dưới lock để chống race condition
      var allConfigs = Repository.getAll(CONFIG.SHEETS.CAUHINH, false);
      var existConfig = allConfigs.filter(function(item) {
        return item.Key === key;
      })[0];
      
      if (existConfig) {
        Repository.updateBatch(CONFIG.SHEETS.CAUHINH, [{
          rowIndex: existConfig._rowIndex,
          data: {
            Value: value,
            Description: description || existConfig.Description || ""
          }
        }]);
      } else {
        Repository.insert(CONFIG.SHEETS.CAUHINH, {
          Key: key,
          Value: value,
          Description: description || ""
        });
      }
      return true;
    } catch (e) {
      throw new Error("Lỗi cập nhật cấu hình: " + e.message);
    } finally {
      lock.releaseLock();
    }
  }
};
