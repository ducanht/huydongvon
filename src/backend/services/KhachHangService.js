// ==========================================
// KHACHHANGSERVICE.GS - Quản lý Khách Hàng
// ==========================================

var KhachHangService = {
  
  /**
   * Thêm khách hàng mới nếu chưa tồn tại
   * Dựa theo Căn Cước Công Dân (CCCD)
   */
  addIfNotExists: function(khachHangData) {
    if (!khachHangData || !khachHangData.CCCD) return null;
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      // Đọc dữ liệu mới nhất không cache từ Sheet để tránh trùng lặp, dùng filterFn để tối ưu bộ nhớ
      var targetCCCD = String(khachHangData.CCCD).trim();
      var exists = Repository.getAll(CONFIG.SHEETS.KHACHHANG, false, function(kh) {
        return String(kh.CCCD).trim() === targetCCCD;
      })[0];
      
      if (exists) {
        return exists.MaKH; // Trả về Mã KH cũ
      } else {
        var newMaKH = Repository.generateId("KH_");
        var newKH = {
          MaKH: newMaKH,
          HoTen: khachHangData.HoTen,
          CCCD: khachHangData.CCCD ? ("'" + String(khachHangData.CCCD).trim()) : "",
          DiaChi: khachHangData.DiaChi || "",
          Sdt: khachHangData.Sdt ? ("'" + String(khachHangData.Sdt).trim()) : "",
          SoTheTV: khachHangData.SoTheTV || "",
          NgayTao: new Date(),
          TrangThai: "ACTIVE"
        };
        
        Repository.insert(CONFIG.SHEETS.KHACHHANG, newKH);
        return newMaKH;
      }
    } catch (e) {
      throw new Error("Lỗi khi thêm khách hàng: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },
  
  getAll: function() {
    return Repository.getAll(CONFIG.SHEETS.KHACHHANG);
  },

  getDatatable: function(user, payload) {
    var allKH = Repository.getAll(CONFIG.SHEETS.KHACHHANG);
    var filteredKH = allKH;
    var recordsTotal = allKH.length;

    // [ENHANCED] Decide whether to enforce MaNV filter
    // If payload.onlyMine is true, we enforce user.MaNV
    var activeMaNV = payload.MaNV; 
    if (user.Role !== CONFIG.ROLES.ADMIN) {
        activeMaNV = (payload.onlyMine === true) ? user.MaNV : null;
    }

    // Lọc tìm kiếm nâng cao
    var hasExtraFilter = false;
    if (payload.extraFilter) {
      var fMaKH = String(payload.extraFilter.MaKH || "").trim();
      var fHoTen = String(payload.extraFilter.HoTen || "").trim();
      var fDiaChi = String(payload.extraFilter.DiaChi || "").trim();
      var fCCCD = String(payload.extraFilter.CCCD || "").trim();
      var fSdt = String(payload.extraFilter.Sdt || "").trim();
      var fSoTheTV = String(payload.extraFilter.SoTheTV || "").trim();

      if (fMaKH || fHoTen || fDiaChi || fCCCD || fSdt || fSoTheTV) {
        hasExtraFilter = true;
      }
    }

    if (hasExtraFilter) {
      var fMaKH_lc = String(payload.extraFilter.MaKH || "").trim().toLowerCase();
      var fHoTen_lc = String(payload.extraFilter.HoTen || "").trim().toLowerCase();
      var fDiaChi_lc = String(payload.extraFilter.DiaChi || "").trim().toLowerCase();
      var fCCCD_lc = String(payload.extraFilter.CCCD || "").trim().toLowerCase();
      var fSdt_lc = String(payload.extraFilter.Sdt || "").trim().toLowerCase();
      var fSoTheTV_lc = String(payload.extraFilter.SoTheTV || "").trim().toLowerCase();

      filteredKH = filteredKH.filter(function(kh) {
        if (fMaKH_lc && String(kh.MaKH || "").toLowerCase().indexOf(fMaKH_lc) === -1) return false;
        if (fHoTen_lc && String(kh.HoTen || "").toLowerCase().indexOf(fHoTen_lc) === -1) return false;
        if (fDiaChi_lc && String(kh.DiaChi || "").toLowerCase().indexOf(fDiaChi_lc) === -1) return false;
        if (fCCCD_lc && String(kh.CCCD || "").toLowerCase().indexOf(fCCCD_lc) === -1) return false;
        if (fSdt_lc && String(kh.Sdt || "").toLowerCase().indexOf(fSdt_lc) === -1) return false;
        if (fSoTheTV_lc && String(kh.SoTheTV || "").toLowerCase().indexOf(fSoTheTV_lc) === -1) return false;
        return true;
      });
    }

    // Tìm kiếm toàn cầu (Global Search)
    if (payload.search && payload.search.value) {
      var searchVal = String(payload.search.value).trim().toLowerCase();
      if (searchVal) {
        filteredKH = filteredKH.filter(function(kh) {
          var maKH = String(kh.MaKH || "").toLowerCase();
          var hoTen = String(kh.HoTen || "").toLowerCase();
          var cccd = String(kh.CCCD || "").toLowerCase();
          var sdt = String(kh.Sdt || "").toLowerCase();
          var diaChi = String(kh.DiaChi || "").toLowerCase();
          var soTheTV = String(kh.SoTheTV || "").toLowerCase();

          return maKH.indexOf(searchVal) !== -1 ||
                 hoTen.indexOf(searchVal) !== -1 ||
                 cccd.indexOf(searchVal) !== -1 ||
                 sdt.indexOf(searchVal) !== -1 ||
                 diaChi.indexOf(searchVal) !== -1 ||
                 soTheTV.indexOf(searchVal) !== -1;
        });
      }
    }
    
    // [ENHANCED] Role-based filtering or Staff-specific Filter
    // If user is not Admin, OR if an Admin specifically selects a Staff (MaNV)
    if (activeMaNV) {
        var fMaNV = ValidatorService.normalizeId(activeMaNV);
        var managedMaKHs = {}; 
        
        // 1. Join with GIAODICH (To catch new customers with pending/approved transactions)
        var transactions = Repository.getAll(CONFIG.SHEETS.GIAODICH);
        transactions.forEach(function(tr) {
            if (ValidatorService.normalizeId(tr.MaNV) === fMaNV) {
                managedMaKHs[ValidatorService.normalizeId(tr.MaKH)] = true;
            }
        });

        // 2. Join with SOTIETKIEM (As a fallback to catch older ownership if any)
        var ss = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
        ss.forEach(function(s) { 
            if (ValidatorService.normalizeId(s.MaNV) === fMaNV) {
                managedMaKHs[ValidatorService.normalizeId(s.MaKH)] = true;
            }
        });

        // Apply ownership filter
        filteredKH = filteredKH.filter(function(kh) {
            return managedMaKHs[ValidatorService.normalizeId(kh.MaKH)];
        });
    }

    Logger.log("[KhachHang] Filtered " + filteredKH.length + " of " + recordsTotal + " records. MaNV Filter: " + (payload.MaNV || "none"));

    // Sorting
    var colMap = ["MaKH", "HoTen", "CCCD", "SoTheTV", "Sdt", "DiaChi", "NgayTao", "TrangThai"];
    if (payload.order && payload.order.length > 0) {
      var sortColIdx = payload.order[0].column;
      var sortDir = payload.order[0].dir;
      var sortField = colMap[sortColIdx];
      
      if (sortField) {
        filteredKH.sort(function(a, b) {
           var valA = a[sortField] || "";
           var valB = b[sortField] || "";
           
            if (sortField === "NgayTao") {
              // GAS Date parsing - Safe handling
              var getSafeTime = function(v) {
                if (!v) return 0;
                var dObj = v instanceof Date ? v : (ValidatorService.parseDate ? ValidatorService.parseDate(v) : new Date(v));
                return (dObj && dObj.getTime && !isNaN(dObj.getTime())) ? dObj.getTime() : 0;
              };
              valA = getSafeTime(valA);
              valB = getSafeTime(valB);
            } else {
              valA = String(valA).toLowerCase();
              valB = String(valB).toLowerCase();
           }
           
           if (valA < valB) return sortDir === 'asc' ? -1 : 1;
           if (valA > valB) return sortDir === 'asc' ? 1 : -1;
           return 0;
        });
      }
    }

    var recordsFiltered = filteredKH.length;

    // Pagination
    var start = parseInt(payload.start) || 0;
    var length = parseInt(payload.length) || 10;
    var dataSlice = (length === -1) ? filteredKH.slice(start) : filteredKH.slice(start, start + length);

    return {
       draw: parseInt(payload.draw || 1),
       recordsTotal: recordsTotal,
       recordsFiltered: recordsFiltered,
       data: dataSlice
    };
  },
  
  /**
   * Cập nhật hoặc Thêm mới thông tin Khách hàng từ trang Quản trị Khách Hàng
   * Chỉ cho phép đổi: Tên, SĐT, Số thẻ TV, Địa chỉ, Trạng thái (và Mã nếu thêm mới)
   */
  saveKhachHang: function(user, payload) {
    var maKHNormalized = ValidatorService.normalizeId(payload.MaKH);
    if (!maKHNormalized) throw new Error("Mã Khách Hàng không được để trống.");
    if (!payload.HoTen) throw new Error("Họ và tên không được để trống.");
    if (!payload.CCCD) throw new Error("Số CCCD không được để trống.");
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);

      // Đọc mới nhất không cache từ Sheet
      var allKH = Repository.getAll(CONFIG.SHEETS.KHACHHANG, false);
      var isNew = payload.isNew === true || payload.isNew === "true";
      var targetKH = null;

      // KIỂM TRA TRÙNG LẶP MÃ KHÁCH HÀNG (Nếu là Thêm Mới)
      if (isNew) {
          var existingMaKH = allKH.filter(function(kh) { return ValidatorService.normalizeId(kh.MaKH) === maKHNormalized; })[0];
          if (existingMaKH) {
              throw new Error("Mã Khách Hàng [" + maKHNormalized + "] đã tồn tại trên hệ thống! Vui lòng chọn mã khác.");
          }
      } else {
          targetKH = allKH.filter(function(kh) { return ValidatorService.normalizeId(kh.MaKH) === maKHNormalized; })[0];
          if (!targetKH) throw new Error("Không tìm thấy Khách hàng này trong CSDL để cập nhật.");
      }
      
      // KIỂM TRA TRÙNG LẶP CCCD & SĐT (Áp dụng cho cả Thêm Mới và Cập Nhật)
      var cccdStr = String(payload.CCCD).trim();
      var sdtStr = payload.Sdt ? String(payload.Sdt).trim() : "";

      var duplicateCccd = allKH.filter(function(kh) { 
          return String(kh.CCCD).trim() === cccdStr && ValidatorService.normalizeId(kh.MaKH) !== maKHNormalized; 
      }).length > 0;
      
      if (duplicateCccd) throw new Error("Số CCCD [" + cccdStr + "] đã thuộc về Khách hàng khác trên hệ thống!");

      if (sdtStr) {
          var duplicateSdt = allKH.filter(function(kh) { 
              return String(kh.Sdt).trim() === sdtStr && ValidatorService.normalizeId(kh.MaKH) !== maKHNormalized; 
          }).length > 0;
          if (duplicateSdt) throw new Error("Số điện thoại [" + sdtStr + "] đã được sử dụng bởi Khách hàng khác!");
      }
      
      // GHI DỮ LIỆU
      if (isNew) {
          // TẠO MỚI
          var newKH = {
              MaKH: maKHNormalized,
              HoTen: payload.HoTen,
              CCCD: cccdStr ? ("'" + cccdStr) : "",
              Sdt: sdtStr ? ("'" + sdtStr) : "",
              DiaChi: payload.DiaChi || "",
              SoTheTV: payload.SoTheTV ? ("'" + String(payload.SoTheTV).trim()) : "",
              NgayTao: new Date(),
              TrangThai: payload.TrangThai || "ACTIVE"
          };
          Repository.insert(CONFIG.SHEETS.KHACHHANG, newKH);
          
          // Log tạo mới
          Repository.insert(CONFIG.SHEETS.KH_HISTORY, {
              HistoryID: Repository.generateId("LKH_"),
              MaKH: maKHNormalized,
              Action: "CREATE_INFO",
              Timestamp: new Date(),
              Details: "Thêm mới KH: " + payload.HoTen,
              NguoiThucHien: user ? user.MaNV : "SYSTEM",
              IP: payload.ClientIP || "0.0.0.0"
          });

          return "Thêm mới thành công Khách hàng: " + payload.HoTen;

      } else {
          // CẬP NHẬT
          Repository.updateBatch(CONFIG.SHEETS.KHACHHANG, [{
            rowIndex: targetKH._rowIndex,
            data: {
              HoTen: payload.HoTen || targetKH.HoTen,
              CCCD: cccdStr ? ("'" + cccdStr) : "",
              Sdt: sdtStr ? ("'" + sdtStr) : "",
              DiaChi: payload.DiaChi || "",
              SoTheTV: payload.SoTheTV ? ("'" + String(payload.SoTheTV).trim()) : "",
              TrangThai: payload.TrangThai || targetKH.TrangThai
            }
          }]);
          
          // Log cập nhật
          Repository.insert(CONFIG.SHEETS.KH_HISTORY, {
              HistoryID: Repository.generateId("LKH_"),
              MaKH: maKHNormalized,
              Action: "UPDATE_INFO",
              Timestamp: new Date(),
              Details: "Sửa TT KH qua Form",
              NguoiThucHien: user ? user.MaNV : "SYSTEM",
              IP: payload.ClientIP || "0.0.0.0"
          });
          
          return "Cập nhật thành công thông tin Khách hàng: " + payload.HoTen;
      }
    } catch (e) {
      throw new Error(e.message);
    } finally {
      lock.releaseLock();
    }
  }
};
