// ==========================================
// REPOSITORY.GS - Xử lý Database Google Sheets
// ==========================================

var Repository = {
  // Bổ sung In-Memory Cache để tránh đọc Sheet nhiều lần trong cùng 1 lần thực hiện (Single Execution)
  _executionCache: {},
  
  _getSpreadsheet: function() {
    return getDbSpreadsheet();
  },
  
  getAll: function(sheetName, useCache, filterFn) {
    useCache = useCache !== false; 
    
    // 1. Kiểm tra In-Memory Cache (Tồn tại trong duy nhất 1 lần chạy script - Cực nhanh)
    if (useCache && this._executionCache[sheetName]) {
      var cached = this._executionCache[sheetName];
      return filterFn ? cached.filter(filterFn) : cached;
    }

    var cacheStr = "CACHE_SHEET_" + sheetName;
    
    // 2. Kiểm tra Script Cache (12 giờ)
    if (useCache) {
        var cachedData = CacheServiceWrapper.get(cacheStr);
        if (cachedData !== null) {
            this._executionCache[sheetName] = cachedData; // Lưu vào In-Memory để lần sau nhanh hơn
            return filterFn ? cachedData.filter(filterFn) : cachedData; 
        }
    }
    
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Không tìm thấy bảng: " + sheetName);
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; 
    
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var idxMaCD = headers.indexOf("MaCD");
    var idxNgayBatDau = headers.indexOf("NgayBatDau");
    var resultForCache = [];
    var resultFiltered = [];
    
    for (var i = 1; i < data.length; i++) {
        var rowStr = data[i].join('');
        if (rowStr.trim() === '') continue; 
        
        var obj = {};
        for (var j = 0; j < headers.length; j++) {
            var cellVal = data[i][j];
            if (headers[j] === "TenCD") {
                var rawMaCD = idxMaCD !== -1 ? data[i][idxMaCD] : null;
                var rawNgayBatDau = idxNgayBatDau !== -1 ? data[i][idxNgayBatDau] : null;
                obj[headers[j]] = Repository._sanitizeTenCD(cellVal, rawMaCD, rawNgayBatDau);
            } else if (cellVal instanceof Date && !isNaN(cellVal.getTime())) {
                obj[headers[j]] = Utilities.formatDate(cellVal, "Asia/Ho_Chi_Minh", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
            } else {
                obj[headers[j]] = cellVal;
            }
        }
        obj['_rowIndex'] = i + 1; 
        
        if (useCache) {
          resultForCache.push(obj);
        }
        
        if (!filterFn || filterFn(obj)) {
          resultFiltered.push(obj);
        }
    }
    
    // 3. Lưu vào cả 2 lớp Cache (Deep clone trước khi lưu để đảm bảo tính bất biến)
    if (useCache) {
        var clones = this.deepClone(resultForCache);
        this._executionCache[sheetName] = clones;
        var ttl = (CONFIG.COLD_SHEETS && CONFIG.COLD_SHEETS.indexOf(sheetName) !== -1)
          ? (CONFIG.CACHE_TTL_COLD || 1800)
          : (CONFIG.CACHE_TTL_HOT || 120);
        CacheServiceWrapper.put(cacheStr, clones, ttl);
        return filterFn ? clones.filter(filterFn) : clones;
    }
    
    return resultFiltered;
  },

  /**
   * [HELPER] Chuẩn hóa Tên Chiến Dịch (khử triệt để chuỗi ISO date hoặc Date object từ Sheets)
   */
  _sanitizeTenCD: function(val, maCD, ngayBatDau) {
    if (val === null || val === undefined || val === "" || val === "undefined" || val === "null") {
      if (ngayBatDau) {
        var dt = (typeof ValidatorService !== "undefined" && ValidatorService.parseDate) ? ValidatorService.parseDate(ngayBatDau) : new Date(ngayBatDau);
        if (dt && !isNaN(dt.getTime())) {
          return "Chiến Dịch Tháng " + (dt.getMonth() + 1) + "/" + dt.getFullYear();
        }
      }
      return maCD ? ("Chiến Dịch " + maCD) : "Chiến Dịch";
    }
    if (val instanceof Date) {
      return "Chiến Dịch Tháng " + (val.getMonth() + 1) + "/" + val.getFullYear();
    }
    var s = String(val).trim();
    if (s.indexOf('T00:00:00') !== -1 || /^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(s) || /^\d{4}-\d{2}/.test(s)) {
      var dt2 = (typeof ValidatorService !== "undefined" && ValidatorService.parseDate) ? ValidatorService.parseDate(s) : new Date(s);
      if (dt2 && !isNaN(dt2.getTime())) {
        return "Chiến Dịch Tháng " + (dt2.getMonth() + 1) + "/" + dt2.getFullYear();
      }
    }
    return s;
  },

  /**
   * Tạo bản sao sâu để tránh Mutation (Thay đổi dữ liệu gốc trong Cache)
   */
  deepClone: function(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
        // Cách nhanh và an toàn nhất cho dữ liệu JSON-like trong GAS
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        // Fallback cho các trường hợp đặc biệt nếu có
        var copy = Array.isArray(obj) ? [] : {};
        for (var attr in obj) {
            if (obj.hasOwnProperty(attr)) copy[attr] = this.deepClone(obj[attr]);
        }
        return copy;
    }
  },
  
  clearCache: function(sheetName) {
    delete this._executionCache[sheetName];
    CacheServiceWrapper.remove("CACHE_SHEET_" + sheetName);
  },

  /**
   * Xóa cache chọn lọc cho danh sách các sheet cụ thể
   * @param {Array<string>} sheetNames Danh sách tên bảng cần xóa cache
   */
  invalidateSpecificCache: function(sheetNames) {
    if (!sheetNames || !Array.isArray(sheetNames)) return;
    var self = this;
    var keys = [];
    sheetNames.forEach(function(s) {
      if (s) {
        delete self._executionCache[s];
        keys.push("CACHE_SHEET_" + s);
      }
    });
    if (keys.length > 0) {
      CacheServiceWrapper.clearAllItems(keys);
    }
  },
  
  clearAllCache: function() {
    this._executionCache = {};
    var keys = [];
    for (var s in CONFIG.SHEETS) {
      keys.push("CACHE_SHEET_" + CONFIG.SHEETS[s]);
    }
    CacheServiceWrapper.clearAllItems(keys);
  },
  
  /**
   * Thêm 1 dòng mới vào Sheet
   * `record` là object dạng key: value
   */
  insert: function(sheetName, record) {
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Không tìm thấy bảng: " + sheetName);
    
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
    var rowToInsert = [];
    
    for (var i = 0; i < headers.length; i++) {
      var key = headers[i];
      // Điền giá trị hoặc chuỗi rỗng nếu undefined
      rowToInsert.push(record[key] !== undefined ? record[key] : ""); 
    }
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); // Đợi tối đa 15 giây
      sheet.appendRow(rowToInsert);
      SpreadsheetApp.flush();
    } catch (e) {
      throw new Error("Hệ thống đang bận xử lý giao dịch khác, vui lòng thử lại sau giây lát.");
    } finally {
      lock.releaseLock();
    }
    this.clearCache(sheetName);
  },
  
  /**
   * Batch Insert - Thêm nhiều dòng cùng lúc
   * `records` là mảng các object {key: value}
   */
  insertBatch: function(sheetName, records) {
    if (!records || records.length === 0) return;
    
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Không tìm thấy bảng: " + sheetName);
    
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                       .map(function(h) { return String(h).trim(); });
    
    var dataToInsert = records.map(function(record) {
      return headers.map(function(header) {
        return record[header] !== undefined ? record[header] : "";
      });
    });
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      sheet.getRange(sheet.getLastRow() + 1, 1, dataToInsert.length, headers.length).setValues(dataToInsert);
      SpreadsheetApp.flush();
    } catch (e) {
      throw new Error("Lỗi chèn dữ liệu hàng loạt: " + e.message);
    } finally {
      lock.releaseLock();
    }
    this.clearCache(sheetName);
  },
  
  /**
   * Batch Update - Cập nhật nhiều dòng hoặc nhiều cột cùng lúc
   * Tối ưu: Chỉ viết lại từng dòng cần cập nhật thay vì toàn bộ sheet
   */
  updateBatch: function(sheetName, updates) {
    if (!updates || updates.length === 0) return;
    
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Không tìm thấy bảng: " + sheetName);
    
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                       .map(function(h) { return String(h).trim(); });
    
    // Đọc toàn bộ dữ liệu hiện có
    var allData = sheet.getDataRange().getValues();
    
    // Tìm range dòng cần update (từ minRow đến maxRow) để tối ưu hóa vùng ghi
    var minRow = Infinity;
    var maxRow = -Infinity;
    
    updates.forEach(function(upd) {
        var rowIdx = upd.rowIndex; 
        if (rowIdx < 2 || rowIdx > allData.length) return;
        
        minRow = Math.min(minRow, rowIdx);
        maxRow = Math.max(maxRow, rowIdx);
        
        var rowData = allData[rowIdx - 1];
        Object.keys(upd.data).forEach(function(key) {
           var colIndex = headers.indexOf(key);
           if (colIndex > -1) {
               rowData[colIndex] = upd.data[key];
           }
        });
    });
    
    if (minRow === Infinity) return;

    // GHI BATCH: Thay vì ghi từng dòng, ta xác định vùng bị thay đổi và ghi 1 lần duy nhất
    var numRowsToUpdate = maxRow - minRow + 1;
    var dataToUpdate = allData.slice(minRow - 1, maxRow);
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      sheet.getRange(minRow, 1, numRowsToUpdate, lastCol).setValues(dataToUpdate);
      SpreadsheetApp.flush();
    } catch (e) {
      throw new Error("Lỗi cập nhật dữ liệu do xung đột truy cập, vui lòng thử lại.");
    } finally {
      lock.releaseLock();
    }
    
    this.clearCache(sheetName);
  },
  
  /**
   * Sinh tự động Mã ID (dùng UUID để đảm bảo uniqueness)
   */
  generateId: function(prefix) {
    // Dùng UUID để tránh trùng lặp trong môi trường multi-user concurrent
    var uuid = Utilities.getUuid().replace(/-/g, '').toUpperCase().substring(0, 10);
    return prefix + uuid;
  },

  /**
   * Truy vấn tối ưu hóa lọc theo khoảng ngày (Range Filtering)
   */
  getRangeByDate: function(sheetName, dateColName, fromDate, toDate, useCache) {
    var dtFrom = fromDate ? (fromDate instanceof Date ? fromDate : ValidatorService.parseDate(fromDate)) : null;
    var dtTo = toDate ? (toDate instanceof Date ? toDate : ValidatorService.parseDate(toDate)) : null;
    if (dtFrom) dtFrom.setHours(0, 0, 0, 0);
    if (dtTo) dtTo.setHours(23, 59, 59, 999);

    return this.getAll(sheetName, useCache, function(row) {
      if (!dtFrom && !dtTo) return true;
      var rawDate = row[dateColName];
      if (!rawDate) return false;
      var rowDt = rawDate instanceof Date ? rawDate : ValidatorService.parseDate(rawDate);
      if (!rowDt || isNaN(rowDt.getTime())) return false;

      if (dtFrom && rowDt.getTime() < dtFrom.getTime()) return false;
      if (dtTo && rowDt.getTime() > dtTo.getTime()) return false;
      return true;
    });
  }
};
