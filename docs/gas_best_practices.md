# Google Apps Script Web App: Kiến trúc & Các Mẫu Tối Ưu Hóa (Cookbook)
### Tài liệu Hướng dẫn Thiết kế Hệ thống & Mẫu Code Tái Sử Dụng

Tài liệu này tổng hợp toàn bộ các kỹ thuật tối ưu hóa hiệu năng, an ninh bảo mật và giải pháp lách qua các giới hạn (Quotas & Limits) của nền tảng **Google Apps Script (GAS) Web Application**. Các mẫu thiết kế dưới đây có thể trực tiếp sao chép và áp dụng cho bất kỳ dự án Web App chạy trên nền Google Sheets nào.

---

## 1. MẪU THIẾT KẾ CƠ SỞ DỮ LIỆU (DATABASE REPOSITORY LAYER)

Tránh truy cập trực tiếp vào Google Sheets API từ tầng điều khiển (Controller/Service). Luôn xây dựng một lớp Repository để bọc toàn bộ logic đọc/ghi dữ liệu, hỗ trợ đồng thời khóa tương tranh (Lock) và bộ nhớ đệm (Cache).

### Mẫu Code Repository Core (`Repository.js`)
```javascript
var Repository = {
  // In-Memory L1 Cache (chỉ tồn tại trong thời gian chạy của 1 request)
  _executionCache: {},

  getAll: function(sheetName, useCache) {
    useCache = useCache !== false;
    
    // 1. Đọc từ RAM L1 Cache
    if (useCache && this._executionCache[sheetName]) {
      return this._executionCache[sheetName];
    }

    var cacheKey = "CACHE_SHEET_" + sheetName;
    
    // 2. Đọc từ Script Cache L2
    if (useCache) {
      var cachedData = CacheServiceWrapper.get(cacheKey);
      if (cachedData !== null) {
        this._executionCache[sheetName] = cachedData;
        return cachedData;
      }
    }
    
    // 3. Đọc trực tiếp từ Sheet vật lý
    var ss = SpreadsheetApp.openById("SPREADSHEET_ID");
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error("Không tìm thấy bảng: " + sheetName);
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    
    var headers = data[0].map(function(h) { return String(h).trim(); });
    var result = [];
    
    for (var i = 1; i < data.length; i++) {
      var rowStr = data[i].join('');
      if (rowStr.trim() === '') continue; // Bỏ qua dòng trống
      
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        var cellVal = data[i][j];
        // Đồng bộ hóa ngày tháng về định dạng ISO String
        if (cellVal instanceof Date && !isNaN(cellVal.getTime())) {
          obj[headers[j]] = Utilities.formatDate(cellVal, "Asia/Ho_Chi_Minh", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
        } else {
          obj[headers[j]] = cellVal;
        }
      }
      obj['_rowIndex'] = i + 1; // Lưu vị trí dòng để phục vụ update/delete
      result.push(obj);
    }
    
    // Lưu vào cache
    if (useCache) {
      this._executionCache[sheetName] = result;
      CacheServiceWrapper.put(cacheKey, result, 300); // Lưu 5 phút
    }
    
    return result;
  },

  clearCache: function(sheetName) {
    delete this._executionCache[sheetName];
    CacheServiceWrapper.remove("CACHE_SHEET_" + sheetName);
  }
};
```

---

## 2. LÀM VIỆC VỚI SHEET THEO LÔ (BATCH OPERATIONS)

Tuyệt đối không đọc/ghi từng dòng hoặc từng ô đơn lẻ bằng `.setValue()` trong vòng lặp. Luôn thực hiện đọc và ghi hàng loạt (Batch).

### Kỹ thuật Cập nhật hàng loạt tối ưu (`updateBatch`)
Khi cập nhật nhiều bản ghi không liên tục, thay vì viết từng ô hoặc ghi toàn bộ sheet (rất chậm), ta tính toán phạm vi dòng thay đổi thực tế (`minRow` đến `maxRow`) và ghi đè duy nhất khối dữ liệu đó.

```javascript
updateBatch: function(sheetName, updates) {
  if (!updates || updates.length === 0) return;
  
  var ss = SpreadsheetApp.openById("SPREADSHEET_ID");
  var sheet = ss.getSheetByName(sheetName);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  
  // Đọc toàn bộ dữ liệu
  var allData = sheet.getDataRange().getValues();
  
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

  var numRowsToUpdate = maxRow - minRow + 1;
  var dataToUpdate = allData.slice(minRow - 1, maxRow);
  
  // Bảo vệ tiến trình ghi chống Race Condition bằng ScriptLock
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // Đợi tối đa 15 giây
    sheet.getRange(minRow, 1, numRowsToUpdate, lastCol).setValues(dataToUpdate);
    SpreadsheetApp.flush(); // Ép hệ thống đồng bộ dữ liệu ngay lập tức
  } catch (e) {
    throw new Error("Hệ thống đang bận xử lý giao dịch tương tự, vui lòng thử lại.");
  } finally {
    lock.releaseLock();
  }
  
  this.clearCache(sheetName);
}
```

---

## 3. VƯỢT GIỚI HẠN 100KB CỦA CACHE SERVICE (CHUNKING WRAPPER)

`CacheService` của Google giới hạn 100KB cho mỗi khóa. Khi dữ liệu của bạn lớn hơn (ví dụ hàng nghìn dòng giao dịch), lệnh ghi sẽ lỗi. Hãy sử dụng mẫu wrapper dưới đây để tự động phân rã (Chunking) dữ liệu lớn thành nhiều mảnh 90KB và lưu metadata liên kết.

### Bộ chuyển đổi bộ đệm phân mảnh (`CacheServiceWrapper.js`)
```javascript
var CacheServiceWrapper = {
  CHUNK_SIZE_LIMIT: 90 * 1024, // Dùng 90KB làm ngưỡng an toàn

  put: function(key, value, ttl) {
    var expiration = ttl || 300;
    try {
      var cache = CacheService.getScriptCache();
      var jsonStr = JSON.stringify(value);

      if (jsonStr.length <= this.CHUNK_SIZE_LIMIT) {
        cache.put(key, jsonStr, expiration);
      } else {
        var chunksMap = {};
        var count = 0;
        for (var i = 0; i < jsonStr.length; i += this.CHUNK_SIZE_LIMIT) {
          chunksMap[key + "_chunk_" + count] = jsonStr.substring(i, i + this.CHUNK_SIZE_LIMIT);
          count++;
        }

        var metadata = {
          __isChunked: true,
          count: count,
          totalLength: jsonStr.length,
          timestamp: Date.now()
        };
        
        var batchMap = {};
        batchMap[key] = JSON.stringify(metadata);
        for (var k in chunksMap) {
          batchMap[k] = chunksMap[k];
        }
        
        // Ghi hàng loạt (Chỉ tốn 1 lần gọi I/O)
        cache.putAll(batchMap, expiration);
      }
    } catch (e) {
      Logger.log("Lỗi ghi Cache: " + e.message);
    }
  },

  get: function(key) {
    try {
      var cache = CacheService.getScriptCache();
      var metadataStr = cache.get(key);
      if (metadataStr == null) return null;

      var metadata;
      try {
        metadata = JSON.parse(metadataStr);
      } catch (e) {
        return JSON.parse(metadataStr); // Trường hợp dữ liệu cũ chưa nâng cấp
      }

      if (metadata && metadata.__isChunked) {
        var chunkKeys = [];
        for (var i = 0; i < metadata.count; i++) {
          chunkKeys.push(key + "_chunk_" + i);
        }
        // Đọc hàng loạt các mảnh (1 lần gọi duy nhất)
        var chunkData = cache.getAll(chunkKeys);
        var fullStr = "";
        for (var i = 0; i < metadata.count; i++) {
          var chunk = chunkData[key + "_chunk_" + i];
          if (chunk == null) return null; // Hỏng 1 mảnh coi như hỏng cache
          fullStr += chunk;
        }
        return JSON.parse(fullStr);
      }
      return metadata;
    } catch (e) {
      Logger.log("Lỗi đọc Cache: " + e.message);
    }
    return null;
  },

  remove: function(key) {
    try {
      var cache = CacheService.getScriptCache();
      var metadataStr = cache.get(key);
      if (metadataStr != null) {
        try {
          var metadata = JSON.parse(metadataStr);
          if (metadata && metadata.__isChunked) {
            var keysToRemove = [key];
            for (var i = 0; i < metadata.count; i++) {
              keysToRemove.push(key + "_chunk_" + i);
            }
            cache.removeAll(keysToRemove);
            return;
          }
        } catch (e) {}
      }
      cache.remove(key);
    } catch (e) {}
  }
};
```

---

## 4. AN NINH BẢO MẬT & RATE LIMIT ĐĂNG NHẬP

Không bao giờ lưu trữ mật khẩu thuần hoặc cho phép gọi API vô hạn lần khi thử mật khẩu sai.

### Cơ chế Chống Dò Mật Khẩu (Login Rate Limiter)
```javascript
loginWithPassword: function(email, hashPassword) {
  var cacheKey = 'LOGIN_FAIL_' + email.toLowerCase().trim();
  var cache = CacheService.getScriptCache();
  var failCount = parseInt(cache.get(cacheKey) || '0', 10);
  
  var MAX_ATTEMPTS = 5;
  var LOCK_WINDOW_SECONDS = 15 * 60; // 15 phút
  
  if (failCount >= MAX_ATTEMPTS) {
    throw new Error("Tài khoản bị khóa do quá 5 lần đăng nhập sai. Vui lòng thử lại sau 15 phút.");
  }
  
  // Xác thực tài khoản với Sheet...
  var isPasswordMatch = verifyPasswordInSheet(email, hashPassword);
  
  if (!isPasswordMatch) {
    // Tăng bộ đếm sai mật khẩu
    cache.put(cacheKey, String(failCount + 1), LOCK_WINDOW_SECONDS);
    throw new Error("Thông tin tài khoản hoặc mật khẩu không chính xác.");
  }
  
  // Mật khẩu đúng -> Xóa bộ đếm khóa đăng nhập
  cache.remove(cacheKey);
  
  // Tạo Token ngẫu nhiên và lưu cache 12 giờ
  var token = Utilities.getUuid();
  var userSession = { email: email, loginAt: Date.now() };
  cache.put("SESSIONTOKEN_" + token, JSON.stringify(userSession), 43200);
  
  return { token: token };
}
```

---

## 5. BỘ LỌC NGÀY THÁNG AN TOÀN TRÁNH LỆCH MÚI GIỜ

Trong Google Apps Script, múi giờ của server thường chạy theo giờ Mỹ (PST/UTC) hoặc múi giờ mặc định của Script. Khi người dùng chọn khoảng ngày (ví dụ `2026-05-26` đến `2026-06-25`), nếu không thiết lập giờ tường minh, ngày sẽ bị dịch chuyển hoặc lệch giờ gây mất dữ liệu.

### Quy tắc Chuẩn hóa Ngày Lọc (Sub-day Precision Rules)
Khi nhận ngày từ UI, luôn ép biên thời gian đầu ngày và cuối ngày một cách tường minh trước khi so sánh:

```javascript
// Chuẩn hóa Đầu ngày bắt đầu: 00:00:00.000
var startDate = ValidatorService.parseDate(tuNgay);
if (startDate) {
  startDate.setHours(0, 0, 0, 0);
}

// Chuẩn hóa Cuối ngày kết thúc: 23:59:59.999
var endDate = ValidatorService.parseDate(denNgay);
if (endDate) {
  endDate.setHours(23, 59, 59, 999);
}

// Thực hiện lọc dữ liệu an toàn
var filtered = allData.filter(function(record) {
  var gdDate = ValidatorService.parseDate(record.NgayGD);
  if (!gdDate) return false;
  
  if (startDate && gdDate.getTime() < startDate.getTime()) return false;
  if (endDate && gdDate.getTime() > endDate.getTime()) return false;
  return true;
});
```

---

## 6. FRONTEND STATIC CACHE & TỰ ĐỘNG GIẢI PHÓNG CACHE

Để tránh giao diện bị giật lắc khi người dùng bấm chuyển qua lại giữa các tab (ví dụ: quay lại trang danh sách cán bộ), hãy sử dụng bộ nhớ tạm tại Client-side, đồng thời cài đặt cơ chế tự động giải phóng (Invalidate) cache khi có hành động ghi dữ liệu.

### Mẫu Code Bộ Đệm Phía Client (`app.js`)
```javascript
class AppManager {
  constructor() {
    this._clientCache = {};
    // Định nghĩa các APIs dữ liệu ít thay đổi được phép cache
    this.cacheableActions = ['getAllChienDich', 'getNhanSuActive'];
  }

  callApi(action, payload) {
    payload = payload || {};
    
    // 1. Tự động giải phóng cache Client nếu phát hiện hành động ghi dữ liệu
    const isWriteAction = /submit|save|duyet|huy|insert|update|delete|archive|clear/i.test(action);
    if (isWriteAction) {
      this._clientCache = {}; // Xóa sạch cache
    }

    // 2. Trả về dữ liệu từ cache nếu có
    if (!isWriteAction && this.cacheableActions.includes(action)) {
      const cacheKey = action + JSON.stringify(payload);
      if (this._clientCache[cacheKey]) {
        // Deep clone đối tượng trả về để tránh Client thay đổi trực tiếp cache
        return $.Deferred().resolve(JSON.parse(JSON.stringify(this._clientCache[cacheKey])));
      }
    }

    // 3. Thực hiện gọi API thật lên Server
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler((response) => {
          if (response.status === "success") {
            // Lưu cache
            if (!isWriteAction && this.cacheableActions.includes(action)) {
              const cacheKey = action + JSON.stringify(payload);
              this._clientCache[cacheKey] = response.data;
            }
            resolve(response.data);
          } else {
            reject(response.message);
          }
        })
        .withFailureHandler((err) => reject(err.message))
        .doApiRequest(action, payload);
    });
  }
}
```

---

## 7. THIẾT KẾ BẢNG ĐÁP ỨNG TRÊN MOBILE (`table-mobile-cards`)

Bảng dữ liệu (HTML `table`) rất khó đọc trên điện thoại di động. Kỹ thuật dưới đây sử dụng CSS để tự động chuyển hàng của bảng thành một Card (Thẻ) hiển thị dọc trên màn hình di động mà không cần viết lại mã HTML.

### Thiết lập CSS (`app.css`)
```css
@media (max-width: 575.98px) {
  /* Biến bảng thành dạng block */
  .table-mobile-cards table, 
  .table-mobile-cards tbody, 
  .table-mobile-cards tr, 
  .table-mobile-cards td {
    display: block;
    width: 100% !important;
  }
  
  /* Ẩn tiêu đề cột ngang */
  .table-mobile-cards thead {
    display: none;
  }
  
  /* Tạo giao diện Card cho mỗi dòng <tr> */
  .table-mobile-cards tr {
    margin-bottom: 15px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  /* Biến mỗi ô <td> thành hàng ngang flex */
  .table-mobile-cards td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px dashed #f3f4f6;
  }
  
  .table-mobile-cards td:last-child {
    border-bottom: none;
  }
  
  /* Hiển thị tiêu đề cột phía trái bằng CSS content attr */
  .table-mobile-cards td::before {
    content: attr(data-label);
    font-weight: 700;
    color: #4b5563;
    font-size: 0.85rem;
    margin-right: 15px;
  }
}
```

### Cách nhúng tiêu đề động trong DataTables
```javascript
columnDefs: [
  {
    targets: "_all",
    createdCell: function (td, cellData, rowData, row, col) {
      // Định nghĩa nhãn tiêu đề tương ứng với vị trí cột
      var headers = ["Số Sổ", "Khách Hàng", "Ngày Giao Dịch", "Số Dư"];
      $(td).attr('data-label', headers[col]);
    }
  }
]
```
