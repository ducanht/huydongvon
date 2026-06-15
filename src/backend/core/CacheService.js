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
        var fullStr = "";
        for (var i = 0; i < metadata.count; i++) {
          var chunk = cache.get(key + "_chunk_" + i);
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
        var chunks = [];
        for (var i = 0; i < jsonStr.length; i += this.CHUNK_SIZE_LIMIT) {
          chunks.push(jsonStr.substring(i, i + this.CHUNK_SIZE_LIMIT));
        }

        // Lưu metadata để biết đường ghép lại
        var metadata = {
          __isChunked: true,
          count: chunks.length,
          totalLength: jsonStr.length,
          timestamp: Date.now()
        };
        
        cache.put(key, JSON.stringify(metadata), expiration);
        
        // Lưu từng chunk
        for (var j = 0; j < chunks.length; j++) {
          cache.put(key + "_chunk_" + j, chunks[j], expiration);
        }
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
            // Xóa hết các chunks
            for (var i = 0; i < metadata.count; i++) {
              cache.remove(key + "_chunk_" + i);
            }
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
