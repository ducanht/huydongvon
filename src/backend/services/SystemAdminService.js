// ==========================================
// SYSTEMADMINSERVICE.GS - Quản trị Logs và Archive
// ==========================================

var SystemAdminService = {
  
  /**
   * Xác thực Mật khẩu Quản trị Hệ thống
   */
  verifyMasterPassword: function(hash) {
      if (!hash) throw new Error("Vui lòng cung cấp mật khẩu Quản trị Hệ thống (Master Password).");
      
      var currentMaster = CauHinhService.get("MASTER_PASSWORD");
      if (!currentMaster) { 
          // Nếu chưa có, thiết lập mật khẩu này làm mật khẩu chuẩn lần đầu
          CauHinhService.set("MASTER_PASSWORD", hash, "Mật khẩu Quản trị hệ thống (Đã Hash SHA256) dùng để xoá Log/Archive");
          return true; 
      }
      
      if (currentMaster !== hash) {
          throw new Error("Mật khẩu Quản trị Hệ thống không chính xác!");
      }
      return true;
  },

  /**
   * Lấy toàn bộ Log hệ thống
   */
  getSystemLogs: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Chỉ ADMIN mới có quyền xem Nhật ký hệ thống.");
    }
    
    // Đọc không cần cache, vì log cập nhật liên tục
    var allLogs = Repository.getAll(CONFIG.SHEETS.LOG, false); 
    
    // Sort descending by timestamp (mới nhất lên đầu)
    allLogs.sort(function(a, b) {
      var dateA = ValidatorService.parseDate(a.Timestamp);
      var dateB = ValidatorService.parseDate(b.Timestamp);
      return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0);
    });

    // Lọc theo khoảng thời gian nếu có
    var startDt = (payload && payload.tuNgay && String(payload.tuNgay).trim() !== "" && String(payload.tuNgay) !== "null" && String(payload.tuNgay) !== "undefined") ? ValidatorService.parseDate(payload.tuNgay) : null;
    if (startDt) startDt.setHours(0, 0, 0, 0);
    var endDt = (payload && payload.denNgay && String(payload.denNgay).trim() !== "" && String(payload.denNgay) !== "null" && String(payload.denNgay) !== "undefined") ? ValidatorService.parseDate(payload.denNgay) : null;
    if (endDt) endDt.setHours(23, 59, 59, 999);
    
    if (startDt || endDt) {
        allLogs = allLogs.filter(function(r) {
            var rDate = ValidatorService.parseDate(r.Timestamp);
            if (!rDate) return false;
            var rTime = rDate.getTime();
            
            if (startDt && rTime < startDt.getTime()) return false;
            if (endDt && rTime > endDt.getTime()) return false;
            return true;
        });
    }

    // Lọc theo Cán bộ (User)
    if (payload && payload.userFilter) {
        var uFilter = payload.userFilter.toLowerCase();
        allLogs = allLogs.filter(function(r) {
            return r.User && r.User.toLowerCase().indexOf(uFilter) !== -1;
        });
    }

    // Lọc theo Hành động (Action)
    if (payload && payload.actionFilter) {
        var aFilter = payload.actionFilter.toLowerCase();
        allLogs = allLogs.filter(function(r) {
            return r.Action && r.Action.toLowerCase().indexOf(aFilter) !== -1;
        });
    }

    // Giới hạn số lượng trả về để tránh quá tải RAM trình duyệt (VD 2000 dòng gần nhất)
    if (allLogs.length > 2000) {
       allLogs = allLogs.slice(0, 2000);
    }

    // [TỐI ƯU] Loại bỏ cột Details khỏi danh sách để giảm tải cho trình duyệt
    // Chi tiết sẽ được tải động (Lazy load) khi người dùng nhấn xem.
    return allLogs.map(function(log) {
       var shallow = {};
       for (var k in log) {
          if (k !== 'Details') shallow[k] = log[k];
       }
       return shallow;
    });
  },

  /**
   * Lấy chi tiết nội dung (Details) của 1 Log duy nhất theo ID
   */
  getLogDetail: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Chỉ ADMIN mới có quyền xem Nhật ký hệ thống.");
    }
    
    var logId = payload.LogID;
    if (!logId) throw new Error("Thiếu mã LogID.");
    
    var allLogs = Repository.getAll(CONFIG.SHEETS.LOG, false);
    var found = allLogs.find(function(l) { return l.LogID === logId; });
    
    if (!found) throw new Error("Không tìm thấy nhật ký yêu cầu.");
    return found.Details || "{}";
  },

  /**
   * Xoá bớt Logs cũ trước số ngày chỉ định
   */
  clearSystemLogs: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Chỉ ADMIN mới có quyền xoá Nhật ký hệ thống.");
    }
    
    // Xác minh password
    SystemAdminService.verifyMasterPassword(payload.masterHash);
    
    var daysToKeep = parseInt(payload.daysToKeep);
    if (isNaN(daysToKeep) || daysToKeep < 0) {
      throw new Error("Số ngày giữ lại không hợp lệ.");
    }
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var ss = getDbSpreadsheet();
      var sheetLog = ss.getSheetByName(CONFIG.SHEETS.LOG);
      if (!sheetLog) throw new Error("Không tìm thấy Sheet LOG.");
      
      var lastRow = sheetLog.getLastRow();
      var lastCol = sheetLog.getLastColumn();
      if (lastRow <= 1) return "Không có nhật ký nào để xóa.";
      
      var headers = sheetLog.getRange(1, 1, 1, lastCol).getValues()[0];
      var timestampIndex = headers.indexOf("Timestamp");
      if (timestampIndex === -1) throw new Error("Cột Timestamp không tồn tại trong sheet LOG.");
      
      // Lấy bộ lọc từ payload
      var uFilter = payload.userFilter ? String(payload.userFilter).trim().toLowerCase() : null;
      var aFilter = payload.actionFilter ? String(payload.actionFilter).trim().toLowerCase() : null;
      var startDt = (payload.tuNgay && String(payload.tuNgay).trim() !== "" && String(payload.tuNgay) !== "null" && String(payload.tuNgay) !== "undefined") ? ValidatorService.parseDate(payload.tuNgay) : null;
      if (startDt) startDt.setHours(0, 0, 0, 0);
      var endDt = (payload.denNgay && String(payload.denNgay).trim() !== "" && String(payload.denNgay) !== "null" && String(payload.denNgay) !== "undefined") ? ValidatorService.parseDate(payload.denNgay) : null;
      if (endDt) endDt.setHours(23, 59, 59, 999);

      // TRƯỜNG HỢP 1: XÓA TOÀN BỘ LOGS (daysToKeep = 0 và không có bộ lọc tùy biến)
      if (daysToKeep === 0 && !startDt && !endDt && !uFilter && !aFilter) {
        var countAll = lastRow - 1;
        sheetLog.getRange(2, 1, countAll, lastCol).clearContent();
        if (sheetLog.getMaxRows() > 200) {
          sheetLog.deleteRows(2, countAll);
        }
        SpreadsheetApp.flush();
        Repository.clearCache(CONFIG.SHEETS.LOG);
        return "Đã xoá sạch toàn bộ " + countAll + " bản ghi nhật ký hệ thống!";
      }

      // TRƯỜNG HỢP 2: XÓA THEO SỐ NGÀY HOẶC BỘ LỌC
      var cutoffDate = null;
      if (!isNaN(daysToKeep) && daysToKeep > 0) {
        cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      }
      
      var data = sheetLog.getDataRange().getValues();
      var rowsToDelete = [];
      var tsIdx = headers.indexOf("Timestamp");
      var userIdx = headers.indexOf("User");
      var actionIdx = headers.indexOf("Action");
      
      // Scan từ dưới lên (bỏ qua header dòng 1)
      for (var i = data.length - 1; i >= 1; i--) {
          var row = data[i];
          var rowDate = new Date(row[tsIdx]);
          var rowTime = rowDate.getTime();
          var rowUser = String(row[userIdx] || "").toLowerCase();
          var rowAction = String(row[actionIdx] || "").toLowerCase();
  
          var match = true;
          // 1. Lọc ngày cũ (daysToKeep)
          if (cutoffDate && rowTime >= cutoffDate.getTime()) match = false;
          // 2. Lọc Range ngày
          if (match && startDt && rowTime < startDt.getTime()) match = false;
          if (match && endDt && rowTime > endDt.getTime()) match = false;
          // 3. Lọc User
          if (match && uFilter && rowUser.indexOf(uFilter) === -1) match = false;
          // 4. Lọc Action
          if (match && aFilter && rowAction.indexOf(aFilter) === -1) match = false;
  
          if (match) {
              rowsToDelete.push(i + 1); 
          }
      }
      
      if (rowsToDelete.length === 0) {
        return "Không tìm thấy nhật ký nào phù hợp với điều kiện để xoá.";
      }
      
      // Batch delete (Xóa từ dưới lên để không lệch index dòng)
      rowsToDelete.sort(function(a, b) { return b - a; });
      
      // Run-length deletion
      var runStart = -1;
      var runLength = 0;
      
      rowsToDelete.forEach(function(rIndex) {
         if (runStart === -1) {
             runStart = rIndex;
             runLength = 1;
         } else if (rIndex === runStart - runLength) {
             runLength++;
         } else {
             sheetLog.deleteRows(runStart - runLength + 1, runLength);
             runStart = rIndex;
             runLength = 1;
         }
      });
  
      if (runStart !== -1) {
         sheetLog.deleteRows(runStart - runLength + 1, runLength);
      }
      
      SpreadsheetApp.flush();
      Repository.clearCache(CONFIG.SHEETS.LOG);
      
      if (daysToKeep > 0) {
        return "Đã xoá thành công " + rowsToDelete.length + " nhật ký cũ (chỉ giữ lại " + daysToKeep + " ngày gần nhất).";
      } else {
        return "Đã xoá thành công " + rowsToDelete.length + " nhật ký thỏa mãn điều kiện.";
      }
    } catch(e) {
      throw new Error("Lỗi khi xoá nhật ký: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Lấy dữ liệu Archive (Giao dịch đã huỷ/từ chối)
   */
  getArchiveData: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Chỉ ADMIN mới có quyền xem Kho lưu trữ.");
    }
    
    var ss = getDbSpreadsheet();
    var sheetArchive = ss.getSheetByName(CONFIG.SHEETS.GIAODICH_ARCHIVE);
    if (!sheetArchive) {
        return []; // Chưa tạo Archive hoặc trống
    }
    
    var archives = Repository.getAll(CONFIG.SHEETS.GIAODICH_ARCHIVE, false); // No cache
    
    // Sắp xếp
    archives.sort(function(a, b) {
      var dateA = ValidatorService.parseDate(a.NgayGD);
      var dateB = ValidatorService.parseDate(b.NgayGD);
      return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0);
    });

    // Lọc Date Range
    var startDt = (payload && payload.tuNgay && String(payload.tuNgay).trim() !== "" && String(payload.tuNgay) !== "null" && String(payload.tuNgay) !== "undefined") ? ValidatorService.parseDate(payload.tuNgay) : null;
    if (startDt) startDt.setHours(0, 0, 0, 0);
    var endDt = (payload && payload.denNgay && String(payload.denNgay).trim() !== "" && String(payload.denNgay) !== "null" && String(payload.denNgay) !== "undefined") ? ValidatorService.parseDate(payload.denNgay) : null;
    if (endDt) endDt.setHours(23, 59, 59, 999);
    
    if (startDt || endDt) {
        archives = archives.filter(function(r) {
            var rDate = ValidatorService.parseDate(r.NgayGD);
            if (!rDate) return false;
            var rTime = rDate.getTime();
            
            if (startDt && rTime < startDt.getTime()) return false;
            if (endDt && rTime > endDt.getTime()) return false;
            return true;
        });
    }

    if (archives.length > 2000) {
       archives = archives.slice(0, 2000);
    }
    
    // Gắn thêm Tên KH và Nội dung
    var listKH = KhachHangService.getAll();
    var khMap = {};
    listKH.forEach(function(kh) { if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh.HoTen; });

    archives = archives.map(function(gd) {
       var normMaKH = ValidatorService.normalizeId(gd.MaKH);
       gd.TenKH = khMap[normMaKH] || gd.MaKH || "";
       return gd;
    });

    return archives;
  },

  /**
   * Xoá sạch dữ liệu kiểm thử có chọn lọc (Chiến dịch, Giao dịch, Sổ tiết kiệm, KPI)
   * Phục vụ dọn dẹp sau khi kiểm thử tự động (Playwright)
   */
  deleteTestData: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Chỉ ADMIN mới có quyền xóa dữ liệu kiểm thử.");
    }
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var maGDs = payload.MaGDs || [];
      var soSos = payload.SoSos || [];
      var maCDs = payload.MaCDs || [];
      var tenCDs = payload.TenCDs || [];
      
      // Chuẩn hóa và làm sạch tham số đầu vào
      maGDs = maGDs.map(function(id) { return String(id).trim().toUpperCase(); }).filter(Boolean);
      soSos = soSos.map(function(so) { return String(so).trim().toUpperCase(); }).filter(Boolean);
      maCDs = maCDs.map(function(id) { return String(id).trim().toUpperCase(); }).filter(Boolean);
      tenCDs = tenCDs.map(function(name) { return String(name).trim().toLowerCase(); }).filter(Boolean);
      
      var ss = getDbSpreadsheet();
      
      // 1. Xóa Chiến Dịch theo MaCD hoặc TenCD
      if (maCDs.length > 0 || tenCDs.length > 0) {
        var sheetCD = ss.getSheetByName(CONFIG.SHEETS.CHIENDICH);
        if (sheetCD) {
          var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH, false);
          var rowsToDelete = [];
          allCD.forEach(function(cd) {
            var match = false;
            if (cd.MaCD && maCDs.indexOf(String(cd.MaCD).toUpperCase()) !== -1) match = true;
            if (cd.TenCD && tenCDs.indexOf(String(cd.TenCD).toLowerCase()) !== -1) match = true;
            if (match) {
              rowsToDelete.push(cd._rowIndex);
              if (cd.MaCD && maCDs.indexOf(String(cd.MaCD).toUpperCase()) === -1) {
                maCDs.push(String(cd.MaCD).toUpperCase());
              }
            }
          });
          
          if (rowsToDelete.length > 0) {
            rowsToDelete.sort(function(a, b) { return b - a; });
            rowsToDelete.forEach(function(rIndex) {
              sheetCD.deleteRow(rIndex);
            });
          }
        }
      }
      
      // 2. Xóa KPI Phân Bổ (DB_CHITIEU) theo MaCD
      if (maCDs.length > 0) {
        var sheetCT = ss.getSheetByName(CONFIG.SHEETS.CHITIEU);
        if (sheetCT) {
          var allCT = Repository.getAll(CONFIG.SHEETS.CHITIEU, false);
          var rowsToDelete = [];
          allCT.forEach(function(ct) {
            if (ct.MaCD && maCDs.indexOf(String(ct.MaCD).toUpperCase()) !== -1) {
              rowsToDelete.push(ct._rowIndex);
            }
          });
          
          if (rowsToDelete.length > 0) {
            rowsToDelete.sort(function(a, b) { return b - a; });
            rowsToDelete.forEach(function(rIndex) {
              sheetCT.deleteRow(rIndex);
            });
          }
        }
      }
      
      // 3. Xóa KPI Summary (DB_SUMMARY) theo MaCD
      if (maCDs.length > 0) {
        var sheetSM = ss.getSheetByName(CONFIG.SHEETS.SUMMARY);
        if (sheetSM) {
          var allSM = Repository.getAll(CONFIG.SHEETS.SUMMARY, false);
          var rowsToDelete = [];
          allSM.forEach(function(sm) {
            if (sm.MaCD && maCDs.indexOf(String(sm.MaCD).toUpperCase()) !== -1) {
              rowsToDelete.push(sm._rowIndex);
            }
          });
          
          if (rowsToDelete.length > 0) {
            rowsToDelete.sort(function(a, b) { return b - a; });
            rowsToDelete.forEach(function(rIndex) {
              sheetSM.deleteRow(rIndex);
            });
          }
        }
      }

      // 4. Xóa Sổ Tiết Kiệm (DB_SOTIETKIEM) theo SoSo
      if (soSos.length > 0) {
        var sheetSTK = ss.getSheetByName(CONFIG.SHEETS.SOTIETKIEM);
        if (sheetSTK) {
          var allSTK = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, false);
          var rowsToDelete = [];
          allSTK.forEach(function(stk) {
            if (stk.SoSo && soSos.indexOf(String(stk.SoSo).toUpperCase()) !== -1) {
              rowsToDelete.push(stk._rowIndex);
            }
          });
          
          if (rowsToDelete.length > 0) {
            rowsToDelete.sort(function(a, b) { return b - a; });
            rowsToDelete.forEach(function(rIndex) {
              sheetSTK.deleteRow(rIndex);
            });
          }
        }
      }

      // 5. Xóa Giao Dịch (DB_GIAODICH) theo MaGD hoặc SoSo
      if (maGDs.length > 0 || soSos.length > 0) {
        var sheetGD = ss.getSheetByName(CONFIG.SHEETS.GIAODICH);
        if (sheetGD) {
          var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH, false);
          var rowsToDelete = [];
          allGD.forEach(function(gd) {
            var match = false;
            if (gd.MaGD && maGDs.indexOf(String(gd.MaGD).toUpperCase()) !== -1) match = true;
            if (gd.SoSo && soSos.indexOf(String(gd.SoSo).toUpperCase()) !== -1) match = true;
            if (match) {
              rowsToDelete.push(gd._rowIndex);
            }
          });
          
          if (rowsToDelete.length > 0) {
            rowsToDelete.sort(function(a, b) { return b - a; });
            rowsToDelete.forEach(function(rIndex) {
              sheetGD.deleteRow(rIndex);
            });
          }
        }
      }
      
      // Xóa Cache toàn diện để đồng bộ dữ liệu ngay lập tức
      Repository.clearAllCache();
      SpreadsheetApp.flush();
      
      return "Đã xóa sạch dữ liệu kiểm thử thành công.";
    } catch(e) {
      throw new Error("Lỗi khi xóa dữ liệu kiểm thử: " + e.message);
    } finally {
      lock.releaseLock();
    }
  }
};

