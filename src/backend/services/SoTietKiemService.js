// ==========================================
// SOTIETKIEMSERVICE.GS - Quản lý Sổ Tiết Kiệm
// ==========================================

var SoTietKiemService = {
  
  /**
   * Kiểm tra Số Sổ đã tồn tại chưa
   */
  isSoTietKiemExists: function(soSo, useCache) {
    if (soSo === undefined || soSo === null) return false;
    useCache = useCache !== false;
    var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, useCache);
    var target = String(soSo).trim();
    return allSo.some(function(so) { return String(so.SoSo).trim() === target; });
  },
  
  /**
   * Thêm Sổ Tiết Kiệm Mới
   * @param {string|Date} ngayPhatHanh Ngay mo so thuc te
   */
  taoMoi: function(maKH, maNV, soSo, soTien, kyHan, loaiSanh, maCD, ngayPhatHanh, laiSuat, loaiLai) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      if (this.isSoTietKiemExists(soSo, false)) {
        throw new Error("Số sổ " + soSo + " đã tồn tại trên hệ thống!");
      }
      
      // Tinh ngay dao han
      var pDate = ngayPhatHanh ? ValidatorService.parseDate(ngayPhatHanh) : new Date();
      var ngayDaoHan = "";
      
      if (kyHan !== "KKH") {
         var thangKyHan = parseInt(kyHan, 10); // Ex: "6TH" -> 6
         if (!isNaN(thangKyHan)) {
            var dDate = new Date(pDate.getTime());
            dDate.setMonth(dDate.getMonth() + thangKyHan);
            ngayDaoHan = dDate;
         }
      }
      
      // Lai suat
      var rate = parseFloat(laiSuat || 0);
      var type = loaiLai || "Standard"; 
      var tienLai = this.calculateInterest(soTien, kyHan, rate, type);
      
      var newSo = {
        SoSo: soSo,
        MaKH: maKH,
        MaNV: maNV,
        MaCD: maCD,
        NgayPhatHanh: pDate,
        NgayDaoHan: ngayDaoHan,
        SoDuBanDau: soTien,
        SoDuHienTai: soTien,
        KyHan: kyHan,
        LoaiSanh: loaiSanh || "BT",
        TrangThai: "ACTIVE",
        LaiSuat: rate,
        LoaiLai: type,
        TienLaiDuKien: tienLai
      };
      
      Repository.insert(CONFIG.SHEETS.SOTIETKIEM, newSo);
      return { soSo: soSo };
    } catch (e) {
      throw new Error(e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Tính toán tiền lãi dự kiến
   */
  calculateInterest: function(soTien, kyHan, laiSuat, loaiLai) {
    if (kyHan === "KKH" || !laiSuat) return 0;
    
    var amount = parseFloat(soTien);
    var rate = parseFloat(laiSuat) / 100; // 6% -> 0.06
    var months = parseInt(kyHan, 10);
    if (isNaN(months)) return 0;

    if (loaiLai === "Compound") {
      // Lãi kép: A = P(1 + r/n)^(nt). Ở đây giả định n=1 (nhập lãi vào gốc hàng tháng nếu user muốn, nhưng thường TK là n=1)
      // Công thức đơn giản cho kỳ hạn: A = P * (1 + r/12)^months
      return Math.round(amount * (Math.pow(1 + rate / 12, months) - 1));
    } else {
      // Lãi đơn: I = P * r * (t/12)
      return Math.round(amount * rate * (months / 12));
    }
  },
  
  /**
   * Lấy danh sách sổ tiết kiệm (không giới hạn ACTIVE để phục vụ theo dõi)
   * Phân quyền: User thấy của mình, Admin thấy hết (hoặc lọc theo MaNV)
   */
  getSoTietKiemList: function(user, filters) {
    filters = filters || {};
    var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
    var khachHangs = KhachHangService.getAll();
    var khMap = {};
    khachHangs.forEach(function(kh) { 
      if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh; 
    });
    
    var userMaNVNormalized = ValidatorService.normalizeId(user.MaNV);
    var userRoleNormalized = (user.Role || "").toString().trim().toUpperCase();

    // Lấy toàn bộ MaNV của team (để hỗ trợ nếu user.MaNV có biến thể khác)
    // Tuy nhiên theo logic hiện tại, normalizeId(user.MaNV) là đủ. 
    // Ta bọc log để debug trên console apps script nếu cần.

    return allSo.filter(function(so) {
      // Quyền truy cập: Admin thấy hết, User chỉ thấy của mình
      var isOwner = (userRoleNormalized === "ADMIN" || ValidatorService.normalizeId(so.MaNV) === userMaNVNormalized);
      if (!isOwner) return false;
      
      // Lọc theo MaNV (Nếu Admin chọn lọc 1 nhân viên cụ thể)
      if (userRoleNormalized === "ADMIN" && filters.MaNV) {
          if (ValidatorService.normalizeId(so.MaNV) !== ValidatorService.normalizeId(filters.MaNV)) return false;
      }
      
      // Lọc theo MaCD
      if (filters.MaCD && ValidatorService.normalizeId(so.MaCD) !== ValidatorService.normalizeId(filters.MaCD)) return false;
      
      // Lọc theo TrangThai
      if (filters.TrangThai && so.TrangThai !== filters.TrangThai) return false;
      
      return true;
    }).map(function(so) {
      var normMaKH = ValidatorService.normalizeId(so.MaKH);
      var kh = khMap[normMaKH] || {};
      so.TenKH = kh.HoTen || so.MaKH || "Unknown";
      so.DiaChiKH = kh.DiaChi || "";
      so.CCCD = kh.CCCD || "";
      return so;
    });
  },

  /**
   * Lấy danh sách sổ của một nhân viên đang ACTIVE (để Rút tiền)
   */
  getActiveByUser: function(user) {
    return this.getSoTietKiemList(user, { TrangThai: "ACTIVE" });
  },

  getDatatable: function(user, payload) {
    var filters = {
      MaNV: payload.MaNV,
      MaCD: payload.MaCD,
      TrangThai: payload.TrangThai
    };
    var allSoFilteredByRole = this.getSoTietKiemList(user, filters);
    var recordsTotal = allSoFilteredByRole.length; // Tổng số bản ghi mà USER có quyền xem
    var filteredSo = allSoFilteredByRole;

    // Search nâng cao
    if (payload.search && payload.search.value) {
      var searchStr = String(payload.search.value).toLowerCase();
      filteredSo = allSoFilteredByRole.filter(function(so) {
        return (so.SoSo && String(so.SoSo).toLowerCase().indexOf(searchStr) > -1) ||
               (so.TenKH && String(so.TenKH).toLowerCase().indexOf(searchStr) > -1) ||
               (so.MaKH && String(so.MaKH).toLowerCase().indexOf(searchStr) > -1) ||
               (so.CCCD && String(so.CCCD).toLowerCase().indexOf(searchStr) > -1);
      });
    }

    // Sort theo colIndex (mặc định NgayPhatHanh desc)
    if (payload.order && payload.order[0]) {
       // Frontend columns: [0:TT, 1:SoSo, 2:SoDuHienTai, 3:TenKH, 4:NgayPhatHanh, 5:KyHan, 6:TrangThai]
       var colMap = [null, "SoSo", "SoDuHienTai", "TenKH", "NgayPhatHanh", "KyHan", "TrangThai"];
       var colIdx = payload.order[0].column;
       var dir = payload.order[0].dir;
       var field = colMap[colIdx];
        if (field) {
          filteredSo.sort(function(a, b) {
            var valA = a[field], valB = b[field];
            if (field === "NgayPhatHanh" || field === "NgayDaoHan") {
              var getTimeSafe = function(v) {
                if (!v) return 0;
                var d = new Date(v);
                return (!isNaN(d.getTime())) ? d.getTime() : 0;
              };
              valA = getTimeSafe(valA);
              valB = getTimeSafe(valB);
            } else if (field === "SoDuHienTai") {
              valA = parseFloat(valA) || 0;
              valB = parseFloat(valB) || 0;
            } else {
              valA = String(valA !== null && valA !== undefined ? valA : "").toLowerCase();
              valB = String(valB !== null && valB !== undefined ? valB : "").toLowerCase();
            }
            if (valA < valB) return dir === "asc" ? -1 : 1;
            if (valA > valB) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
    }

    var recordsFiltered = filteredSo.length;
    var start = parseInt(payload.start) || 0;
    var length = parseInt(payload.length) || 10;
    var dataSlice = (length === -1) ? filteredSo.slice(start) : filteredSo.slice(start, start + length);

    return {
       draw: parseInt(payload.draw || 1),
       recordsTotal: recordsTotal,
       recordsFiltered: recordsFiltered,
       data: dataSlice
    };
  },

  /**
   * Lấy danh sách Khách hàng đang quản lý cho DataTable
   */
  getManagedKhachHangDatatable: function(user, payload) {
    var filters = {
      MaNV: payload.MaNV,
      MaCD: payload.MaCD
    };
    
    // Lấy toàn bộ sổ khớp filter
    var allSo = this.getSoTietKiemList(user, filters);
    
    // Gom nhóm theo MaKH
    var khGroups = {};
    allSo.forEach(function(so) {
      if (!khGroups[so.MaKH]) {
        khGroups[so.MaKH] = {
          MaKH: so.MaKH,
          HoTen: so.TenKH,
          DiaChi: so.DiaChiKH,
          TongSoSo: 0,
          TongTien: 0,
          HasActive: false
        };
      }
      khGroups[so.MaKH].TongSoSo += 1;
      khGroups[so.MaKH].TongTien += parseFloat(so.SoDuHienTai || 0);
      if (so.TrangThai === "ACTIVE") khGroups[so.MaKH].HasActive = true;
    });
    
    var list = Object.keys(khGroups).map(function(key) {
      var item = khGroups[key];
      item.HienTrang = item.HasActive ? "Còn gửi" : "Đã tất toán";
      return item;
    });
    
    var recordsTotal = list.length;
    var filtered = list;
    
    // Search
    if (payload.search && payload.search.value) {
      var searchStr = String(payload.search.value).toLowerCase();
      filtered = list.filter(function(kh) {
        return String(kh.HoTen).toLowerCase().indexOf(searchStr) > -1 ||
               String(kh.MaKH).toLowerCase().indexOf(searchStr) > -1 ||
               String(kh.DiaChi).toLowerCase().indexOf(searchStr) > -1;
      });
    }
    
    // Sorting
    if (payload.order && payload.order[0]) {
       // Columns: [0:TT, 1:MaKH, 2:HoTen, 3:DiaChi, 4:TongSoSo, 5:TongTien, 6:HienTrang]
       var colMap = [null, "MaKH", "HoTen", "DiaChi", "TongSoSo", "TongTien", "HienTrang"];
       var colIdx = payload.order[0].column;
       var dir = payload.order[0].dir;
       var field = colMap[colIdx];
        if (field) {
          filtered.sort(function(a, b) {
            var valA = a[field], valB = b[field];
            if (field === "TongSoSo" || field === "TongTien") {
              valA = parseFloat(valA) || 0;
              valB = parseFloat(valB) || 0;
            } else {
              valA = String(valA !== null && valA !== undefined ? valA : "").toLowerCase();
              valB = String(valB !== null && valB !== undefined ? valB : "").toLowerCase();
            }
            if (valA < valB) return dir === "asc" ? -1 : 1;
            if (valA > valB) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
    }

    var recordsFiltered = filtered.length;
    var start = parseInt(payload.start) || 0;
    var length = parseInt(payload.length) || 10;
    var dataSlice = (length === -1) ? filtered.slice(start) : filtered.slice(start, start + length);
    
    return {
      draw: parseInt(payload.draw || 1),
      recordsTotal: recordsTotal,
      recordsFiltered: recordsFiltered,
      data: dataSlice
    };
  },

  // ==========================================
  // MODULE ĐỐI CHIẾU SỔ (RECONCILIATION)
  // ==========================================

  /**
   * 1. Phân tích đối chiếu: Đọc DB_SYS_STK (Cột SO_SO_TG)
   * So sánh với danh sách sổ đang ACTIVE trên hệ thống.
   * Cảnh báo những Sổ khuyết (Có trên App mà DB không có).
   */
  analyzeReconciliation: function() {
    LoggerService.log("INFO", "analyzeReconciliation", "START", {});
    
    // 1. Đọc dữ liệu từ DB_SYS_STK (Bypass cache)
    var sysData = Repository.getAll(CONFIG.SHEETS.STK_CORE, false);
    var sysMap = {};
    if (!sysData || sysData.length === 0) {
      throw new Error("Không có dữ liệu trong " + CONFIG.SHEETS.STK_CORE + ". Vui lòng chép danh sách sổ vào cột SO_SO_TG trước khi đối chiếu.");
    }

    // 2. Chuyển thành Hash Bản đồ để tra cứu O(1)
    sysData.forEach(function(row) {
      if (row.SO_SO_TG) {
        sysMap[ValidatorService.normalizeId(row.SO_SO_TG)] = true;
      }
    });

    // 3. Quét hệ thống App -> Lấy tất cả sổ ACTIVE (Bypass cache)
    var allActiveSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, false).filter(function(so) {
      return so.TrangThai === "ACTIVE";
    });

    var khachHangs = Repository.getAll(CONFIG.SHEETS.KHACHHANG, false);
    var khMap = {};
    khachHangs.forEach(function(kh) { 
      khMap[ValidatorService.normalizeId(kh.MaKH)] = kh; 
    });

    var dsCanTatToan = [];
    var totalSoDuBocHoi = 0;

    allActiveSo.forEach(function(so) {
      var normSoSo = ValidatorService.normalizeId(so.SoSo);
      if (!sysMap[normSoSo]) {
        // Cuốn sổ này đang ảo -> Cần Tất Toán
        var kh = khMap[ValidatorService.normalizeId(so.MaKH)] || {};
        totalSoDuBocHoi += parseFloat(so.SoDuHienTai || 0);
        
        dsCanTatToan.push({
          SoSo: so.SoSo,
          MaKH: so.MaKH,
          TenKH: kh.HoTen || so.MaKH,
          MaVN: so.MaNV,
          SoDuHienTai: so.SoDuHienTai,
          KyHan: so.KyHan,
          NgayPhatHanh: so.NgayPhatHanh
        });
      }
    });

    // Trả về kết quả Phân tích
    return {
      totalKiemTra: allActiveSo.length,
      totalPhatHien: dsCanTatToan.length,
      totalTienBiTru: totalSoDuBocHoi,
      danhSachThuHoi: dsCanTatToan
    };
  },

  /**
   * 2. Thực thi Tất toán HÀNG LOẠT (Bỏ qua Duyệt Admin)
   * Tạo lệnh rút, Cập nhật Sổ (CLOSED), và Đè KPI
   */
  executeReconciliation: function(user, payload) {
    var dsTruyThu = payload.DanhSachSo || [];
    if (dsTruyThu.length === 0) throw new Error("Không có Sổ nào để thực thi.");

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); // Đảm bảo đồng bộ

      // Bypass cache khi đọc danh sách sổ để bảo vệ dòng _rowIndex
      var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, false);
      var soMapBySoSo = {};
      allSo.forEach(function(so) {
        soMapBySoSo[ValidatorService.normalizeId(so.SoSo)] = so;
      });

      var capNhatSOTIETKIEM = [];
      var capNhatGIAODICH = [];
      var affectedUsers = {}; // Danh sách MaNV cần trừ điểm

      var now = new Date();

      dsTruyThu.forEach(function(item) {
        var soToanTrang = soMapBySoSo[ValidatorService.normalizeId(item.SoSo)];
        if (!soToanTrang || soToanTrang.TrangThai !== "ACTIVE") return;

        var soTienRut = parseFloat(soToanTrang.SoDuHienTai);
        if (soTienRut <= 0) return;

        var sysMaGD = "RC_" + Math.random().toString(36).substr(2, 6).toUpperCase() + "_" + Date.now();

        // 1. Tạo Phiếu GIAODICH (RÚT) -> ÉP CHẠY ACTIVE TRỰC TIẾP
        capNhatGIAODICH.push({
          MaGD: sysMaGD,
          LoaiGD: "RUT",
          MaKH: soToanTrang.MaKH,
          MaNV: soToanTrang.MaNV,
          SoTien: soTienRut,
          SoSo: soToanTrang.SoSo,
          KyHan: soToanTrang.KyHan,
          MaCD: soToanTrang.MaCD,
          NgayGD: now,
          GhiChu: "Hệ thống TỰ ĐỘNG ĐÓNG based trên đối chiếu DB_SYS_STK.",
          TrangThai: "ACTIVE", // Bypass Maker-Checker
          DuyetBoi: "SYS_RECONCILE",
          NgayDuyet: now
        });

        // 2. Chốt số SOTIETKIEM
        capNhatSOTIETKIEM.push({
          rowIndex: soToanTrang._rowIndex,
          data: {
            SoDuHienTai: 0,
            TrangThai: "CLOSED"
          }
        });

        // 3. Nạp array trừ điểm
        var nvKey = soToanTrang.MaNV + "_" + soToanTrang.MaCD;
        affectedUsers[nvKey] = { nv: soToanTrang.MaNV, cd: soToanTrang.MaCD };
      });

      // BATCH EXECUTE
      if (capNhatGIAODICH.length > 0) {
         Repository.insertBatch(CONFIG.SHEETS.GIAODICH, capNhatGIAODICH);
      }
      if (capNhatSOTIETKIEM.length > 0) {
         Repository.updateBatch(CONFIG.SHEETS.SOTIETKIEM, capNhatSOTIETKIEM);
      }

      // TRIGGER KPI (Chạy ngầm liên hoàn)
      Object.keys(affectedUsers).forEach(function(key) {
         KPIService.updateSummary(affectedUsers[key].nv, affectedUsers[key].cd);
      });

      LoggerService.log("INFO", "executeReconciliation", "SUCCESS", { Tally: capNhatGIAODICH.length });

      return {
        success: true,
        message: "Hệ thống đã thực thi Tất Toán & Khấu trừ KPI tự động thành công (" + capNhatGIAODICH.length + " sổ).",
        total: capNhatGIAODICH.length
      };

    } catch (e) {
      LoggerService.log("ERROR", "executeReconciliation", "FAIL", { err: e.message });
      throw new Error("Lỗi khi xử lý hàng loạt: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Tự động chạy đối chiếu và đồng bộ các sổ ảo thuộc một Chiến dịch cụ thể
   */
  syncCampaignReconciliation: function(user, maCD) {
    if (!maCD) return;
    
    // 1. Đọc dữ liệu từ DB_SYS_STK (Bypass cache)
    var sysData = Repository.getAll(CONFIG.SHEETS.STK_CORE, false);
    var sysMap = {};
    if (!sysData || sysData.length === 0) {
      // Không có dữ liệu đối chiếu, không làm gì để tránh xóa nhầm dữ liệu
      return;
    }

    // Chuyển thành Hash Bản đồ để tra cứu O(1)
    sysData.forEach(function(row) {
      if (row.SO_SO_TG) {
        sysMap[ValidatorService.normalizeId(row.SO_SO_TG)] = true;
      }
    });

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); // Đảm bảo đồng bộ chống race condition

      // 2. Lấy tất cả sổ ACTIVE của chiến dịch này (Bypass cache)
      var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, false);
      var normMaCD = ValidatorService.normalizeId(maCD);
      
      var capNhatSOTIETKIEM = [];
      var capNhatGIAODICH = [];
      var affectedUsers = {};
      var now = new Date();

      allSo.forEach(function(so) {
        if (so.TrangThai !== "ACTIVE") return;
        if (ValidatorService.normalizeId(so.MaCD) !== normMaCD) return;
        
        var normSoSo = ValidatorService.normalizeId(so.SoSo);
        if (!sysMap[normSoSo]) {
          // Cuốn sổ này đang ảo (không tồn tại trong core) -> Tự động đóng (CLOSED)
          var soTienRut = parseFloat(so.SoDuHienTai || 0);
          if (soTienRut <= 0) return;

          var sysMaGD = "RC_" + Math.random().toString(36).substr(2, 6).toUpperCase() + "_" + Date.now();

          // Tạo Phiếu GIAODICH (RÚT) trực tiếp ACTIVE
          capNhatGIAODICH.push({
            MaGD: sysMaGD,
            LoaiGD: "RUT",
            MaKH: so.MaKH,
            MaNV: so.MaNV,
            SoTien: soTienRut,
            SoSo: so.SoSo,
            KyHan: so.KyHan,
            MaCD: so.MaCD,
            NgayGD: now,
            GhiChu: "Hệ thống TỰ ĐỘNG ĐÓNG khi chạy báo cáo chiến dịch " + maCD + " (không có trong DB_SYS_STK).",
            TrangThai: "ACTIVE",
            DuyetBoi: "SYS_RECONCILE_REPORT",
            NgayDuyet: now
          });

          // Chốt số SOTIETKIEM
          capNhatSOTIETKIEM.push({
            rowIndex: so._rowIndex,
            data: {
              SoDuHienTai: 0,
              TrangThai: "CLOSED"
            }
          });

          var nvKey = so.MaNV + "_" + so.MaCD;
          affectedUsers[nvKey] = { nv: so.MaNV, cd: so.MaCD };
        }
      });

      // Thực thi batch ghi
      if (capNhatGIAODICH.length > 0) {
         Repository.insertBatch(CONFIG.SHEETS.GIAODICH, capNhatGIAODICH);
      }
      if (capNhatSOTIETKIEM.length > 0) {
         Repository.updateBatch(CONFIG.SHEETS.SOTIETKIEM, capNhatSOTIETKIEM);
      }

      // Trigger KPI cập nhật lại bảng Summary
      Object.keys(affectedUsers).forEach(function(key) {
         KPIService.updateSummary(affectedUsers[key].nv, affectedUsers[key].cd);
      });

      if (capNhatGIAODICH.length > 0) {
        LoggerService.log("INFO", "syncCampaignReconciliation", "SUCCESS", { MaCD: maCD, Count: capNhatGIAODICH.length });
      }
    } catch(e) {
      LoggerService.log("ERROR", "syncCampaignReconciliation", "FAILED", { error: e.message, MaCD: maCD });
      throw new Error("Lỗi khi đồng bộ dữ liệu sổ tiết kiệm cho chiến dịch: " + e.message);
    } finally {
      lock.releaseLock();
    }
  }
};
