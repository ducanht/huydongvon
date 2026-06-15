// ==========================================
// CACHESERVICE.GS - Tính năng Memory Caching cho Backend
// ==========================================

var CacheServiceWrapper = {
  // Giới hạn an toàn cho mỗi chunk của CacheService (100KB là limit cứng, ta dùng 90KB cho an toàn)
  CHUNK_SIZE_LIMIT: 90 * 1024, 

  /**
   * Lấy dữ liệu từ cache (Hỗ trợ tự động ghép các chunks nếu có)
   */
  get: function(key) {
    try {
      var cache = CacheService.getScriptCache();
      var metadataStr = cache.get(key);
      if (metadataStr == null) return null;

      var metadata;
      try {
        metadata = JSON.parse(metadataStr);
      } catch (e) {
        // Nếu không phải JSON metadata, có thể là giá trị cũ chưa nâng cấp
        return JSON.parse(metadataStr);
      }

      // Kiểm tra nếu là dữ liệu chia nhỏ (Chunks)
      if (metadata && metadata.__isChunked) {
        var chunkKeys = [];
        for (var i = 0; i < metadata.count; i++) {
          chunkKeys.push(key + "_chunk_" + i);
        }
        var chunkData = cache.getAll(chunkKeys);
        var fullStr = "";
        for (var i = 0; i < metadata.count; i++) {
          var chunk = chunkData[key + "_chunk_" + i];
          if (chunk == null) return null; // Mất 1 chunk coi như hỏng cache
          fullStr += chunk;
        }
        return JSON.parse(fullStr);
      }

      return metadata; // Trường hợp JSON bình thường
    } catch (e) {
      LoggerService.log("SYSTEM_ERROR", "Cache get Error", "FAILED", { key: key, error: e.message });
    }
    return null;
  },

  /**
   * Lưu dữ liệu vào cache (Hỗ trợ tự động chia nhỏ nếu dữ liệu quá 100KB)
   */
  put: function(key, value, ttl) {
    var expiration = ttl || 300; // Mặc định 5 phút
    try {
      var cache = CacheService.getScriptCache();
      var jsonStr = JSON.stringify(value);

      if (jsonStr.length <= this.CHUNK_SIZE_LIMIT) {
        cache.put(key, jsonStr, expiration);
      } else {
        // Dữ liệu quá lớn, thực hiện Chunking
        var chunksMap = {};
        var count = 0;
        for (var i = 0; i < jsonStr.length; i += this.CHUNK_SIZE_LIMIT) {
          chunksMap[key + "_chunk_" + count] = jsonStr.substring(i, i + this.CHUNK_SIZE_LIMIT);
          count++;
        }

        // Lưu metadata để biết đường ghép lại
        var metadata = {
          __isChunked: true,
          count: count,
          totalLength: jsonStr.length,
          timestamp: Date.now()
        };
        
        // Tạo map ghi hàng loạt
        var batchMap = {};
        batchMap[key] = JSON.stringify(metadata);
        for (var k in chunksMap) {
          batchMap[k] = chunksMap[k];
        }
        
        cache.putAll(batchMap, expiration);
      }
    } catch (e) {
      LoggerService.log("SYSTEM_ERROR", "Cache put Error", "FAILED", { key: key, error: e.message });
    }
  },

  /**
   * Xóa cache
   */
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
      cache.remove(key); // Luôn gọi remove để đảm bảo khóa chính được xóa sạch
    } catch (e) {
      LoggerService.log("SYSTEM_ERROR", "Cache remove Error", "FAILED", { key: key, error: e.message });
    }
  },

  /**
   * Xóa hàng loạt cache (Keys)
   */
  clearAllItems: function(keys) {
    try {
      var self = this;
      keys.forEach(function(k) { self.remove(k); });
    } catch (e) {
      LoggerService.log("SYSTEM_ERROR", "Cache clearAllItems Error", "FAILED", { error: e.message });
    }
  }
};
