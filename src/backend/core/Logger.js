// ==========================================
// LOGGER.GS - Ghi log hệ thống
// ==========================================

var LoggerService = {
  // [H1] userContext: truyền {MaNV, Email} từ session token, không dùng Session.getActiveUser()
  log: function(action, description, status, details, userContext) {
    try {
      var ss = getDbSpreadsheet();
      var logSheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
      if (!logSheet) return;
      
      var timestamp = new Date();
      // Dùng userContext được truyền vào thay vì GAS runner email
      var userIdentity = userContext 
          ? (userContext.MaNV || userContext.Email || 'SYSTEM')
          : 'SYSTEM';
      
      // Batch write log
      logSheet.appendRow([
        Utilities.getUuid(), // LogID
        timestamp,           // Timestamp (thời gian thực hiện)
        userIdentity,        // User (người thực hiện)
        action,              // Action (tên sự việc)
        description,         // Description
        status,              // Status
        JSON.stringify(details || {}), // Details (chi tiết - đã được filter hash)
        userContext ? (userContext.IP || "0.0.0.0") : "0.0.0.0" // IP
      ]);
    } catch (e) {
      console.error("Ghi log lỗi: " + e.message);
    }
  }
};
