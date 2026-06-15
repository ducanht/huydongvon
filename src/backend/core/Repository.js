// ==========================================
// REPOSITORY.GS - Xử lý Database Google Sheets
// ==========================================

var Repository = {
  // Bổ sung In-Memory Cache để tránh đọc Sheet nhiều lần trong cùng 1 lần thực hiện (Single Execution)
  _executionCache: {},
  
  getAll: function(sheetName, useCache) {
    useCache = useCache !== false; 
    
    // 1. Kiểm tra In-Memory Cache (Tồn tại trong duy nhất 1 lần chạy script - Cực nhanh)
    if (useCache && this._executionCache[sheetName]) return this._executionCache[sheetName];

    var cacheStr = "CACHE_SHEET_" + sheetName;
    
    // 2. Kiểm tra Script Cache (12 giờ)
    if (useCache) {
        var cachedData = CacheServiceWrapper.get(cacheStr);
        if (cachedData !== null) {
            this._executionCache[sheetName] = cachedData; // Lưu vào In-Memory để lần sau nhanh hơn
            return cachedData; 
        }
    }
    
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Không tìm thấy bảng: " + sheetName);
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; 
    
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var result = [];
    
    for (var i = 1; i < data.length; i++) {
        var rowStr = data[i].join('');
        if (rowStr.trim() === '') continue; 
        
        var obj = {};
        for (var j = 0; j < headers.length; j++) {
            var cellVal = data[i][j];
            if (cellVal instanceof Date && !isNaN(cellVal.getTime())) {
                obj[headers[j]] = Utilities.formatDate(cellVal, "Asia/Ho_Chi_Minh", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
            } else {
                obj[headers[j]] = cellVal;
            }
        }
        obj['_rowIndex'] = i + 1; 
        result.push(obj);
    }
    
    // 3. Lưu vào cả 2 lớp Cache (Deep clone trước khi lưu để đảm bảo tính bất biến)
    var clones = this.deepClone(result);
    if (useCache) {
        this._executionCache[sheetName] = clones;
        CacheServiceWrapper.put(cacheStr, clones, CONFIG.CACHE_TTL);
    }
    
    return clones;
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
  }
};
