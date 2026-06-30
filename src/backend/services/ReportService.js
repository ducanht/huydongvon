// ==========================================
// REPORTSERVICE.GS - Báo cáo và Bảng xếp hạng
// ==========================================

/**
 * [Standalone] Tạo bản đồ ngày bắt đầu/kết thúc của từng Chiến dịch.
 * Dùng trong chế độ KPI Thi Đua (THI_DUA) để chỉ tính GD trong thời gian chiến dịch.
 * @returns {Object} { [normMaCD]: { start: Date|null, end: Date|null } }
 */
function _buildCdDateMap() {
  var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
  var cdDateMap = {};
  allCD.forEach(function(cd) {
    if (!cd.MaCD) return;
    var normId = ValidatorService.normalizeId(cd.MaCD);
    var start = cd.NgayBatDau ? ValidatorService.parseDate(cd.NgayBatDau) : null;
    var end   = cd.NgayKetThuc ? ValidatorService.parseDate(cd.NgayKetThuc) : null;
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);
    cdDateMap[normId] = { start: start, end: end };
  });
  return cdDateMap;
}

var ReportService = {
  
  /**
   * Lấy Top 3 Leaderboard theo Cán bộ có số Net cao nhất
   * Tương thích với bộ Lọc (Filters)
   */
  getLeaderboard: function(user, filters) {
    filters = filters || {};
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var maNV = ValidatorService.normalizeId(filters.maNV);
    var tuNgay = filters.tuNgay ? ValidatorService.parseDate(filters.tuNgay) : null;
    if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
    var denNgay = filters.denNgay ? ValidatorService.parseDate(filters.denNgay) : null;
    if (denNgay) denNgay.setHours(23, 59, 59, 999);

    var kpiMode = filters.kpiMode || 'THI_DUA';
    var cdDateMap = _buildCdDateMap();
    var finalLeaderboard = [];

    // ── NẾU LÀ CHẾ ĐỘ THI ĐUA VÀ CÓ CHỌN CHIẾN DỊCH ──────────────────────────
    if (kpiMode === 'THI_DUA' && maCD) {
      // 1. Chạy báo cáo tăng trưởng chi tiết
      var tangTruongData = this.getBaoCaoTangTruong(user, { maCD: maCD, maNV: maNV, kpiMode: 'THI_DUA' }, true);
      var summaryList = tangTruongData.summary || [];
      
      // 2. Lấy toàn bộ GD để tính raw Gui/Rut cho từng cán bộ
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
      var filteredGD = allGD.filter(function(gd) {
        if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "PENDING" || gd.TrangThai === "REJECTED" || gd.TrangThai === "REVERTED") return false;
        if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
        if (maNV && ValidatorService.normalizeId(gd.MaNV) !== maNV) return false;
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (tuNgay && gdDate < tuNgay) return false;
        if (denNgay && gdDate > denNgay) return false;
        
        var normMaCD = ValidatorService.normalizeId(gd.MaCD);
        if (cdDateMap[normMaCD]) {
          var limits = cdDateMap[normMaCD];
          if (limits.start && gdDate < limits.start) return false;
          if (limits.end && gdDate > limits.end) return false;
        }
        return true;
      });

      var rawTellersMap = {};
      filteredGD.forEach(function(gd) {
        var mnv = ValidatorService.normalizeId(gd.MaNV);
        if (!mnv) return;
        if (!rawTellersMap[mnv]) {
          rawTellersMap[mnv] = { gui: 0, rut: 0, booksCount: {} };
        }
        var val = parseFloat(gd.SoTien || 0);
        if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
          rawTellersMap[mnv].gui += val;
          if (gd.SoSo) rawTellersMap[mnv].booksCount[gd.SoSo] = true;
        } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
          rawTellersMap[mnv].rut += val;
        }
      });

      var onlyAssignedKpi = (filters.onlyAssignedKpi === true || String(filters.onlyAssignedKpi).toLowerCase() === 'true');
      var list = [];

      var allNhanSu = NhanSuService.getAll();
      var nsMap = {};
      allNhanSu.forEach(function(ns) { 
        if(ns.MaNV) nsMap[ValidatorService.normalizeId(ns.MaNV)] = ns; 
      });

      summaryList.forEach(function(r) {
        var mnv = ValidatorService.normalizeId(r.MaNV);
        var rawStats = rawTellersMap[mnv] || { gui: 0, rut: 0, booksCount: {} };
        var ns = nsMap[mnv] || {};

        var item = {
          MaNV: r.MaNV,
          TenNV: r.TenNV,
          ChiTieu: r.ChiTieu,
          Net: r.TongTangTruong,             // Thực đạt Net theo KPI Tăng Trưởng
          HoanThanh: r.TyLeHoanThanh,        // % Hoàn thành theo KPI Tăng Trưởng
          TongGui: rawStats.gui,             // Số tiền gửi thực tế phát sinh trong CD
          TongRut: rawStats.rut,             // Số tiền rút thực tế phát sinh trong CD
          SoMoi: Object.keys(rawStats.booksCount).length, // Số lượng sổ mở trong CD
          SoKH: r.SoKHMoi + r.SoKHCuTang,     // Số lượng KH tăng trưởng (nguyên người)
          Email: ns.Email || ""
        };

        // Lọc theo onlyAssignedKpi
        if (onlyAssignedKpi && item.ChiTieu <= 0) return;
        
        list.push(item);
      });

      // Sắp xếp theo Net (Giảm dần)
      list.sort(function(a, b) {
        return b.Net - a.Net;
      });

      // Gán hạng cụ thể
      list.forEach(function(item, index) { item.Rank = index + 1; });

      finalLeaderboard = list;
    } else {
      // ── CHẾ ĐỘ THỰC TẾ HOẶC KHÔNG CHỌN CHIẾN DỊCH (GIỮ NGUYÊN BẢN GỐC) ────────
      var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
      var targetChiTieu = allChiTieu;
      if (maCD) targetChiTieu = targetChiTieu.filter(function(ct) { return ValidatorService.normalizeId(ct.MaCD) === maCD; });
      if (maNV) targetChiTieu = targetChiTieu.filter(function(ct) { return ValidatorService.normalizeId(ct.MaNV) === maNV; });

      // Gom nhóm Chỉ tiêu theo Nhân viên từ DB_CHITIEU
      var userMap = {};
      targetChiTieu.forEach(function(ct) {
        if (!userMap[ct.MaNV]) {
          userMap[ct.MaNV] = { MaNV: ct.MaNV, Net: 0, ChiTieu: 0, TongGui: 0, TongRut: 0, SoMoi: 0, KhachHangMap: {} };
        }
        userMap[ct.MaNV].ChiTieu += parseFloat(ct.ChiTieu || 0);
      });

      // Tính Net thực tế theo bộ lọc bằng cách duyệt Giao Dịch
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
      var filteredGD = allGD.filter(function(gd) {
        if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "PENDING" || gd.TrangThai === "REJECTED" || gd.TrangThai === "REVERTED") return false;
        if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
        if (maNV && ValidatorService.normalizeId(gd.MaNV) !== maNV) return false;
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (tuNgay && gdDate < tuNgay) return false;
        if (denNgay && gdDate > denNgay) return false;
        
        // Áp dụng bộ lọc cho chế độ Thi Đua (THI_DUA)
        if (kpiMode === 'THI_DUA') {
          var normMaCD = ValidatorService.normalizeId(gd.MaCD);
          if (cdDateMap[normMaCD]) {
            var limits = cdDateMap[normMaCD];
            if (limits.start && gdDate < limits.start) return false;
            if (limits.end && gdDate > limits.end) return false;
          }
        }

        return true;
      });

      filteredGD.forEach(function(gd) {
        if (!userMap[gd.MaNV]) {
           userMap[gd.MaNV] = { MaNV: gd.MaNV, Net: 0, ChiTieu: 0, TongGui: 0, TongRut: 0, SoMoi: 0, KhachHangMap: {} };
        }
        var soTienGD = parseFloat(gd.SoTien || 0);
        if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
           userMap[gd.MaNV].Net += soTienGD;
           userMap[gd.MaNV].TongGui += soTienGD;
           userMap[gd.MaNV].SoMoi += 1; // Số Hợp đồng gửi
        } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
           userMap[gd.MaNV].Net -= soTienGD;
           userMap[gd.MaNV].TongRut += soTienGD;
        }
        // Ghi nhận Mã Khách Hàng (Tập hợp khách hàng duy nhất)
        if (gd.MaKH) {
           userMap[gd.MaNV].KhachHangMap[gd.MaKH] = true;
        }
      });

      var onlyAssignedKpi = (filters.onlyAssignedKpi === true || String(filters.onlyAssignedKpi).toLowerCase() === 'true');

      var list = [];
      Object.keys(userMap).forEach(function(key) {
        var item = userMap[key];
        
        // Nếu lọc chỉ hiện cán bộ có chỉ tiêu
        if (onlyAssignedKpi && item.ChiTieu <= 0) return;
        
        // Bỏ qua USER không được giao chỉ tiêu và không có giao dịch phát sinh
        if (!onlyAssignedKpi && item.ChiTieu <= 0 && item.Net === 0 && item.TongGui === 0 && item.TongRut === 0) return;
        
        // Chỉ push vào mảng nếu có Giao dịch trong thời gian này, HOẶC nếu không lọc by date
        if ((tuNgay || denNgay) && item.Net === 0 && item.ChiTieu === 0) return;
        
        item.HoanThanh = item.ChiTieu > 0 ? (item.Net / item.ChiTieu) * 100 : 0;
        item.SoKH = Object.keys(item.KhachHangMap).length; // Số lượng khách hàng
        delete item.KhachHangMap; // Bỏ field trung gian trước khi trả về
        list.push(item);
      });
      
      // Sắp xếp theo Net (Giảm dần) và lưu Rank thực
      list.sort(function(a, b) {
        return b.Net - a.Net;
      });
      
      // Gán hạng cụ thể (vì sau filter array index không còn đúng nữa)
      list.forEach(function(item, index) { item.Rank = index + 1; });
      
      // Map Tên Nhân viên
      var allNhanSu = NhanSuService.getAll();
      var nsMap = {};
      allNhanSu.forEach(function(ns) { 
        if(ns.MaNV) nsMap[ValidatorService.normalizeId(ns.MaNV)] = ns; 
      });
      
      finalLeaderboard = list.map(function(item) {
        var ns = nsMap[ValidatorService.normalizeId(item.MaNV)];
        item.TenNV = ns ? ns.HoTen : item.MaNV;
        item.Email = ns ? ns.Email : "";
        return item;
      });
    }

    // Kiểm tra và áp dụng giới hạn hiển thị theo vai trò (chỉ ADMIN mới xem toàn bộ)
    var userRole = (user && user.Role) ? String(user.Role).toUpperCase() : "";
    if (userRole !== "ADMIN") {
      var normalizedUserMaNV = ValidatorService.normalizeId(user ? user.MaNV : "");
      var filteredList = finalLeaderboard.filter(function(r) {
        return ValidatorService.normalizeId(r.MaNV) === normalizedUserMaNV;
      });

      // Nếu không tìm thấy dòng dữ liệu của chính user (do không có KPI hoặc giao dịch), tạo dòng giả lập để hiển thị
      if (filteredList.length === 0) {
        var fallbackRow = {
          MaNV: user ? user.MaNV : "",
          TenNV: user ? (user.HoTen || user.MaNV) : "Không rõ",
          ChiTieu: 0,
          Net: 0,
          HoanThanh: 0,
          TongGui: 0,
          TongRut: 0,
          SoMoi: 0,
          SoKH: 0,
          Email: user ? (user.Email || "") : "",
          Rank: finalLeaderboard.length + 1
        };
        filteredList = [fallbackRow];
      }
      return filteredList;
    }

    return finalLeaderboard;
  },
  
  /**
   * Báo cáo tổng hợp Giao dịch động (Có hỗ trợ Filter)
   */
  getBaoCaoTongHop: function(user, filters) {
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    
    // Parse filters
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var maNV = ValidatorService.normalizeId(filters.maNV);
    var tuNgay = filters.tuNgay ? ValidatorService.parseDate(filters.tuNgay) : null;
    if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
    var denNgay = filters.denNgay ? ValidatorService.parseDate(filters.denNgay) : null;
    
    // Chỉnh denNgay đến cuối ngày để so sánh
    if (denNgay) {
       denNgay.setHours(23, 59, 59, 999);
    }
    
    // Map Tên Nhân viên và Tên Khách hàng
    var khachHangs = KhachHangService.getAll();
    var khMap = {};
    khachHangs.forEach(function(kh) { if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh; });
    
    var nhanSus = NhanSuService.getAll();
    var nsMap = {};
    nhanSus.forEach(function(ns) { if(ns.MaNV) nsMap[ValidatorService.normalizeId(ns.MaNV)] = ns; });
    
    // Lọc dữ liệu
    var result = allGD.filter(function(gd) {
      if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "REVERTED") return false;
      
      // Khớp quyền
      if (user.Role !== CONFIG.ROLES.ADMIN && ValidatorService.normalizeId(gd.MaNV) !== ValidatorService.normalizeId(user.MaNV)) return false;
      
      // Khớp Filter form
      if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
      // Dù form gửi lên MaNV nhưng chỉ có tác dụng nếu user là Admin
      if (maNV && ValidatorService.normalizeId(gd.MaNV) !== maNV && user.Role === CONFIG.ROLES.ADMIN) return false; 
      
      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (tuNgay && gdDate < tuNgay) return false;
      if (denNgay && gdDate > denNgay) return false;
      
      return true;
    });
    
    // Enrich Data
    return result.map(function(gd) {
       gd.TenKH = khMap[ValidatorService.normalizeId(gd.MaKH)] ? khMap[ValidatorService.normalizeId(gd.MaKH)].HoTen : "";
       gd.TenNV = nsMap[ValidatorService.normalizeId(gd.MaNV)] ? nsMap[ValidatorService.normalizeId(gd.MaNV)].HoTen : "";
       return gd;
    });
  },

  /**
   * Báo cáo Tổng hợp Cán Bộ (Dành cho ADMIN)
   * Hiển thị: Cán bộ, Chỉ tiêu, Gửi, KH Gửi, Rút, KH Rút, NET, Đánh giá
   */
  getBaoCaoTongHop_ChienDich: function(user, filters) {
    if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Không có quyền truy cập Báo cáo Tổng hợp.");
    
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var maNV = ValidatorService.normalizeId(filters.maNV);
    var kpiMode = filters.kpiMode || 'THI_DUA';
    var cdDateMap = _buildCdDateMap();
    
    // Tự động đồng bộ và tất toán sổ ảo của chiến dịch trước khi xuất báo cáo
    if (maCD) {
      SoTietKiemService.syncCampaignReconciliation(user, maCD);
    }

    var reconciled = this._getReconciledAccounts(maCD, maNV);

    var tuNgay = filters.tuNgay ? ValidatorService.parseDate(filters.tuNgay) : null;
    if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
    var denNgay = filters.denNgay ? ValidatorService.parseDate(filters.denNgay) : null;
    if (denNgay) denNgay.setHours(23, 59, 59, 999);

    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    if (maCD) allChiTieu = allChiTieu.filter(function(ct) { return ValidatorService.normalizeId(ct.MaCD) === maCD; });

    var userMap = {};
    allChiTieu.forEach(function(ct) {
      if (!userMap[ct.MaNV]) {
        userMap[ct.MaNV] = { MaNV: ct.MaNV, ChiTieu: 0, Gui: 0, Rut: 0, Net: 0, KHMap: {}, SoSoMap: {} };
      }
      userMap[ct.MaNV].ChiTieu += parseFloat(ct.ChiTieu || 0);
    });

    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var filteredGD = allGD.filter(function(gd) {
      if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "PENDING" || gd.TrangThai === "REJECTED" || gd.TrangThai === "REVERTED") return false;
      if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
      if (maNV && ValidatorService.normalizeId(gd.MaNV) !== maNV) return false;
      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (tuNgay && gdDate < tuNgay) return false;
      if (denNgay && gdDate > denNgay) return false;
      
      // Áp dụng bộ lọc cho chế độ Thi Đua (THI_DUA)
      if (kpiMode === 'THI_DUA') {
        var normMaCD = ValidatorService.normalizeId(gd.MaCD);
        if (cdDateMap[normMaCD]) {
          var limits = cdDateMap[normMaCD];
          if (limits.start && gdDate < limits.start) return false;
          if (limits.end && gdDate > limits.end) return false;
        }
      }

      return true;
    });

    // Tối ưu hóa KH Mới: Một KH được coi là mới nếu giao dịch hiện tại cách giao dịch trước đó > 180 ngày 
    // hoặc chưa từng giao dịch trước đó. Sử dụng Map để tăng tốc độ lookup.
    var khGDMoiMap = {}; // MaNV -> { MaKH: true }
    
    // 1. Phân nhóm GD theo MaKH để tính toán Date nhanh hơn
    var gdByKH = {};
    allGD.forEach(function(gd) {
      if (gd.TrangThai !== "ACTIVE") return;
      if (!gdByKH[gd.MaKH]) gdByKH[gd.MaKH] = [];
      gdByKH[gd.MaKH].push(ValidatorService.parseDate(gd.NgayGD));
    });
    
    // 2. Sắp xếp ngày cho từng KH (mảng con nhỏ nên nhanh hơn sắp xếp mảng tổng 10k+ dòng)
    for (var mkh in gdByKH) {
      gdByKH[mkh].sort(function(a, b) { return a - b; });
    }

    // 3. Kiểm tra từng giao dịch trong filteredGD xem có phải là "Mới" không
    filteredGD.forEach(function(gd) {
      if (!userMap[gd.MaNV]) {
         userMap[gd.MaNV] = { MaNV: gd.MaNV, ChiTieu: 0, Gui: 0, Rut: 0, Net: 0, KHMap: {}, SoSoMap: {}, KHMoiMap: {} };
      }
      var soTienGD = parseFloat(gd.SoTien || 0);
      var maKH = gd.MaKH;
      if (maKH) userMap[gd.MaNV].KHMap[maKH] = true;
      if (gd.SoSo && gd.LoaiGD === CONFIG.GIAO_DICH.GUI) userMap[gd.MaNV].SoSoMap[gd.SoSo] = true;

      // Logic xác định KH Mới tại thời điểm gd.NgayGD
      var curDate = ValidatorService.parseDate(gd.NgayGD);
      var khDates = gdByKH[maKH] || [];
      var isNew = false;
      
      // Tìm vị trí của curDate trong chuỗi dates của khách này
      var idx = khDates.findIndex(function(d) { return d.getTime() === curDate.getTime(); });
      if (idx === 0) {
        isNew = true; // Giao dịch đầu tiên trọn đời
      } else if (idx > 0) {
        var prevDate = khDates[idx - 1];
        var diffDays = (curDate - prevDate) / (1000 * 60 * 60 * 24);
        if (diffDays > 180) isNew = true; // Quay lại sau 6 tháng
      }

      if (isNew) {
        if (!khGDMoiMap[gd.MaNV]) khGDMoiMap[gd.MaNV] = {};
        khGDMoiMap[gd.MaNV][maKH] = true;
      }

      if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
         userMap[gd.MaNV].Gui += soTienGD;
         userMap[gd.MaNV].Net += soTienGD;
      } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
         userMap[gd.MaNV].Rut += soTienGD;
         userMap[gd.MaNV].Net -= soTienGD;
      }
    });

    var nsMap = {};
    NhanSuService.getAll().forEach(function(ns) { 
      if(ns.MaNV) nsMap[ValidatorService.normalizeId(ns.MaNV)] = ns; 
    });

    var onlyAssignedKpi = (filters.onlyAssignedKpi === true || String(filters.onlyAssignedKpi).toLowerCase() === 'true');

    var result = [];
    Object.keys(userMap).forEach(function(key) {
      var item = userMap[key];
      
      // Nếu lọc chỉ hiện cán bộ có chỉ tiêu
      if (onlyAssignedKpi && item.ChiTieu <= 0) return;
      
      // Bỏ qua USER không được giao chỉ tiêu và không có giao dịch phát sinh
      if (!onlyAssignedKpi && item.ChiTieu <= 0 && item.Net === 0 && item.Gui === 0 && item.Rut === 0) return;
      
      var ns = nsMap[ValidatorService.normalizeId(item.MaNV)];
      var khMoiSet = khGDMoiMap[item.MaNV] || {};
      
      var resItem = {
        TenNV: ns ? ns.HoTen : item.MaNV,
        ChiTieu: item.ChiTieu,
        Gui: item.Gui,
        Rut: item.Rut,
        Net: item.Net,
        TongSoSo: Object.keys(item.SoSoMap).length,
        SoKH: Object.keys(item.KHMap).length,
        SoKHMoi: Object.keys(khMoiSet).length
      };
      
      resItem.TyLe = resItem.ChiTieu > 0 ? (resItem.Net / resItem.ChiTieu) * 100 : 0;
      resItem.DanhGia = resItem.Net >= resItem.ChiTieu ? "ĐẠT" : "KHÔNG ĐẠT";
      
      result.push(resItem);
    });

    // Sort by Net descending
    result.sort(function(a, b) { return b.Net - a.Net; });
    return {
      report: result,
      reconciled: reconciled
    };
  },

  /**
   * Báo cáo Chi tiết cho USER
   * Hiển thị: Danh sách các sổ | Khách hàng đã gửi | Khách hàng đã rút | Theo chiến dịch | Tổng số tiền
   */
  getBaoCaoChiTietUser: function(user, filters) {
    if (user.Role !== CONFIG.ROLES.USER && user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Tính năng dành riêng cho USER và ADMIN.");
    
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var maNV = ValidatorService.normalizeId(filters.maNV || user.MaNV);
    var kpiMode = filters.kpiMode || 'THI_DUA';
    var cdDateMap = _buildCdDateMap();
    
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      maNV = ValidatorService.normalizeId(user.MaNV);
    }

    // Tự động đồng bộ và tất toán sổ ảo của chiến dịch trước khi xuất báo cáo
    if (maCD) {
      SoTietKiemService.syncCampaignReconciliation(user, maCD);
    }

    var reconciled = this._getReconciledAccounts(maCD, maNV);

    var tuNgay = filters.tuNgay ? ValidatorService.parseDate(filters.tuNgay) : null;
    if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
    var denNgay = filters.denNgay ? ValidatorService.parseDate(filters.denNgay) : null;
    if (denNgay) denNgay.setHours(23, 59, 59, 999);

    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var filteredGD = allGD.filter(function(gd) {
      if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "PENDING" || gd.TrangThai === "REJECTED" || gd.TrangThai === "REVERTED") return false;
      if (ValidatorService.normalizeId(gd.MaNV) !== maNV) return false;
      if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (tuNgay && gdDate < tuNgay) return false;
      if (denNgay && gdDate > denNgay) return false;
      
      // Áp dụng bộ lọc cho chế độ Thi Đua (THI_DUA)
      if (kpiMode === 'THI_DUA') {
        var normMaCD = ValidatorService.normalizeId(gd.MaCD);
        if (cdDateMap[normMaCD]) {
          var limits = cdDateMap[normMaCD];
          if (limits.start && gdDate < limits.start) return false;
          if (limits.end && gdDate > limits.end) return false;
        }
      }

      return true;
    });

    // Sắp xếp theo Ngày GD mới nhất
    filteredGD.sort(function(a, b) {
      var getTimeSafe = function(d) {
        if (!d) return 0;
        var dt = d instanceof Date ? d : new Date(d);
        return (!isNaN(dt.getTime())) ? dt.getTime() : 0;
      };
      return getTimeSafe(b.NgayGD) - getTimeSafe(a.NgayGD);
    });

    var recordsTotal = filteredGD.length;

    // Phân trang (hỗ trợ DataTables serverSide format)
    var start = parseInt(filters.start) || 0;
    // Nếu không truyền length (như khi load báo cáo client-side), mặc định trả về toàn bộ dữ liệu (-1)
    var length = (filters.length !== undefined && filters.length !== null) ? parseInt(filters.length) : -1;
    var dataSlice = (length === -1) ? filteredGD : filteredGD.slice(start, start + length);

    var khMap = {};
    KhachHangService.getAll().forEach(function(kh) { if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh; });
    
    var nvMap = {};
    NhanSuService.getAll().forEach(function(nv) { if(nv.MaNV) nvMap[ValidatorService.normalizeId(nv.MaNV)] = nv; });

    var cdMap = {};
    ChienDichService.getAll().forEach(function(cd) { if(cd.MaCD) cdMap[ValidatorService.normalizeId(cd.MaCD)] = cd; });

    var data = dataSlice.map(function(gd) {
       var normMaKH = ValidatorService.normalizeId(gd.MaKH);
       var normMaNV = ValidatorService.normalizeId(gd.MaNV);
       var normMaCD = ValidatorService.normalizeId(gd.MaCD);
       return {
           MaGD: gd.MaGD,
           TenKH: khMap[normMaKH] ? khMap[normMaKH].HoTen : gd.MaKH || "",
           TenNV: nvMap[normMaNV] ? nvMap[normMaNV].HoTen : gd.MaNV || "",
           TenCD: cdMap[normMaCD] ? cdMap[normMaCD].TenCD : gd.MaCD || "",
           SoSo: gd.SoSo,
           LoaiGD: gd.LoaiGD,
           SoTien: parseFloat(gd.SoTien || 0),
           NgayGD: gd.NgayGD,
           TrangThai: gd.TrangThai
       };
    });

    return {
      draw: parseInt(filters.draw || 1),
      recordsTotal: recordsTotal,
      recordsFiltered: recordsTotal,
      data: data,
      reconciled: reconciled
    };
  },

  /**
   * Phân tích dữ liệu chi tiết của 1 Cán Bộ (Cho modal Click từ Leaderboard)
   */
  getEmployeeDetails: function(payload) {
    var maNV = ValidatorService.normalizeId(payload.MaNV);
    var filters = payload.Filters || {};
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var tuNgay = filters.tuNgay ? ValidatorService.parseDate(filters.tuNgay) : null;
    if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
    var denNgay = filters.denNgay ? ValidatorService.parseDate(filters.denNgay) : null;
    if (denNgay) denNgay.setHours(23, 59, 59, 999);

    var kpiMode = filters.kpiMode || 'THI_DUA';
    var cdDateMap = _buildCdDateMap();

    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    
    var res = {
        SoMoi: 0,
        SoTatToan: 0,
        KhachHangQL: 0,
        KyHanMap: {},
        Timeline: []
    };

    var khachHangSet = {};
    var timelineMap = {};

    var filteredGD = allGD.filter(function(gd) {
      if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "PENDING" || gd.TrangThai === "REJECTED" || gd.TrangThai === "REVERTED") return false;
      if (ValidatorService.normalizeId(gd.MaNV) !== maNV) return false;
      if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (tuNgay && gdDate < tuNgay) return false;
      if (denNgay && gdDate > denNgay) return false;
      
      // Áp dụng bộ lọc cho chế độ Thi Đua (THI_DUA)
      if (kpiMode === 'THI_DUA') {
        var normMaCD = ValidatorService.normalizeId(gd.MaCD);
        if (cdDateMap[normMaCD]) {
          var limits = cdDateMap[normMaCD];
          if (limits.start && gdDate < limits.start) return false;
          if (limits.end && gdDate > limits.end) return false;
        }
      }

      return true;
    });

    var stkMap = {};
    if (filteredGD.length > 0) {
       var allSTK = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
       allSTK.forEach(function(s) { if(s.SoSo) stkMap[s.SoSo.toString().trim()] = s.KyHan; });
    }

    filteredGD.forEach(function(gd) {
        khachHangSet[gd.MaKH] = true;
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (!gdDate) return;
        
        var yyyy = gdDate.getFullYear();
        var mm = ("0" + (gdDate.getMonth() + 1)).slice(-2);
        var dd = ("0" + gdDate.getDate()).slice(-2);
        var dateStr = yyyy + "-" + mm + "-" + dd;

        if (!timelineMap[dateStr]) timelineMap[dateStr] = { Net: 0, SoMoi: 0 };
        var soTienGD = parseFloat(gd.SoTien || 0);

        if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
            res.SoMoi++;
            timelineMap[dateStr].Net += soTienGD;
            timelineMap[dateStr].SoMoi += 1;
            
            // Robust KyHan detection logic (Synced with KPIService)
            var kyHan = "KKH"; 
            var normSoSo = String(gd.SoSo || "").trim().toUpperCase();

            if (stkMap[normSoSo]) {
              kyHan = stkMap[normSoSo];
            } else if (gd.GhiChu) {
              try {
                var logMatch = gd.GhiChu.match(/SYS_LOG:\s*(\{.*?\})/);
                if (logMatch) {
                  var logObj = JSON.parse(logMatch[1]);
                  if (logObj.kyHan) kyHan = logObj.kyHan;
                }
                if (kyHan === "KKH") {
                  var dataMatch = gd.GhiChu.match(/SYS_DATA:\s*(\{.*?\})/);
                  if (dataMatch) {
                    var dataObj = JSON.parse(dataMatch[1]);
                    if (dataObj.KyHan) kyHan = dataObj.KyHan;
                  }
                }
              } catch(e) { }
              if (kyHan === "KKH") {
                var m = gd.GhiChu.match(/(?:Kỳ hạn|Ky han) ([^,)|]+)/i);
                if (m) kyHan = m[1].trim();
              }
            }
            
            // Normalize display label
            var displayKyHan = kyHan === "KKH" ? "Không Kỳ Hạn" : kyHan;
            
            if (!res.KyHanMap[displayKyHan]) res.KyHanMap[displayKyHan] = { count: 0, amount: 0 };
            res.KyHanMap[displayKyHan].count++;
            res.KyHanMap[displayKyHan].amount += soTienGD;

        } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
            res.SoTatToan++;
            timelineMap[dateStr].Net -= soTienGD;
        }
    });

    var timeline = Object.keys(timelineMap).sort().map(function(k) {
        return { Date: k, Net: timelineMap[k].Net, SoMoi: timelineMap[k].SoMoi };
    });
    res.Timeline = timeline;

    res.KhachHangQL = Object.keys(khachHangSet).length;
    return res;
  },

  /**
   * Danh sách Sổ tiết kiệm đang quản lý bởi USER
   */
  getSotietkiemManagedByUser: function(user, filters) {
    if (user.Role !== CONFIG.ROLES.USER && user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Tính năng dành riêng cho USER và ADMIN.");
    
    var listNV = NhanSuService.getAll();
    var listCD = ChienDichService.getAll();
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);

    var nvMap = {};
    listNV.forEach(function(nv) {
      if(nv.MaNV) nvMap[ValidatorService.normalizeId(nv.MaNV)] = nv;
    });
    
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
    
    var filteredSo = allSo.filter(function(so) {
      if (so.TrangThai !== "ACTIVE") return false;
      
      var targetMaNV = ValidatorService.normalizeId(user.MaNV);
      if (user.Role === CONFIG.ROLES.ADMIN && filters.maNV) {
          targetMaNV = ValidatorService.normalizeId(filters.maNV);
      }
      
      if (ValidatorService.normalizeId(so.MaNV) !== targetMaNV) return false;
      if (maCD && ValidatorService.normalizeId(so.MaCD) !== maCD) return false;
      return true;
    });

    var khMap = {};
    KhachHangService.getAll().forEach(function(kh) { if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh; });
    
    var cdMap = {};
    ChienDichService.getAll().forEach(function(cd) { if(cd.MaCD) cdMap[ValidatorService.normalizeId(cd.MaCD)] = cd; });

    return filteredSo.map(function(so) {
       var kh = khMap[ValidatorService.normalizeId(so.MaKH)];
       var cd = cdMap[ValidatorService.normalizeId(so.MaCD)];
       return {
           SoSo: so.SoSo,
           TenKH: kh ? kh.HoTen : so.MaKH,
           TenCD: cd ? cd.TenCD : so.MaCD,
           SoDuHienTai: parseFloat(so.SoDuHienTai || 0),
           KyHan: so.KyHan,
           LaiSuat: so.LaiSuat,
           LoaiLai: so.LoaiLai,
           NgayDaoHan: so.NgayDaoHan
       };
     });
   },





/**
    * Lấy danh sách sổ ảo bị đóng tự động của Chiến dịch (và Nhân viên nếu có)
    */
  /**
   * [HELPER] Phân loại KH Mới / KH Cũ dựa trên lịch sử giao dịch TOÀN BỘ hệ thống.
   * KH Mới = KH có giao dịch ACTIVE đầu tiên trong toàn DB >= ngày bắt đầu chiến dịch.
   * @param {Array} allGD - Toàn bộ mảng giao dịch
   * @param {Date} cdStartDate - Ngày bắt đầu chiến dịch
   * @param {Object} targetMaKHSet - { MaKH: true } tập hợp KH cần phân loại
   * @returns {{ newSet: Object, oldSet: Object }}
   */
  _classifyCustomers: function(allGD, cdStartDate, targetMaKHSet) {
    var newSet = {};
    var oldSet = {};

    // Nhóm giao dịch active theo MaKH để tìm cho nhanh
    var activeGdsByKH = {};
    allGD.forEach(function(gd) {
      if (gd.TrangThai !== 'ACTIVE') return;
      var maKH = ValidatorService.normalizeId(gd.MaKH);
      if (!maKH) return;
      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (!gdDate) return;
      
      if (!activeGdsByKH[maKH]) {
        activeGdsByKH[maKH] = [];
      }
      activeGdsByKH[maKH].push(gdDate);
    });

    // Sắp xếp ngày tăng dần cho từng khách hàng
    Object.keys(activeGdsByKH).forEach(function(maKH) {
      activeGdsByKH[maKH].sort(function(a, b) { return a - b; });
    });

    Object.keys(targetMaKHSet).forEach(function(maKH) {
      var dates = activeGdsByKH[maKH] || [];
      if (dates.length === 0) {
        newSet[maKH] = true;
        return;
      }

      // Tìm giao dịch đầu tiên trong chiến dịch (date >= cdStartDate)
      var firstCampDate = null;
      var firstCampIndex = -1;
      for (var i = 0; i < dates.length; i++) {
        if (dates[i] >= cdStartDate) {
          firstCampDate = dates[i];
          firstCampIndex = i;
          break;
        }
      }

      if (!firstCampDate) {
        firstCampDate = cdStartDate;
      }

      // Tìm giao dịch gần nhất trước đó
      var lastPriorDate = null;
      if (firstCampIndex > 0) {
        lastPriorDate = dates[firstCampIndex - 1];
      } else if (firstCampIndex === -1 && dates.length > 0) {
        lastPriorDate = dates[dates.length - 1];
      }

      if (!lastPriorDate) {
        newSet[maKH] = true;
      } else {
        var gapDays = (firstCampDate.getTime() - lastPriorDate.getTime()) / (1000 * 60 * 60 * 24);
        if (gapDays >= 180) {
          newSet[maKH] = true;
        } else {
          oldSet[maKH] = true;
        }
      }
    });

    return { newSet: newSet, oldSet: oldSet };
  },

  /**
   * [HELPER] Tính số dư thuần (Net Balance) của KH Cũ TRƯỚC ngày bắt đầu chiến dịch.
   * Đây là "Số Dư Đầu Kỳ" để tính phần tăng trưởng của KH Cũ.
   * @param {Array} allGD - Toàn bộ mảng giao dịch
   * @param {Date} cdStartDate - Ngày bắt đầu chiến dịch
   * @param {Object} oldSet - { MaKH: true } chỉ tập KH Cũ
   * @returns {Object} { MaKH: soDuDauKy (number) }
   */
  /**
   * [HELPER] Tính số dư thuần (Net Balance) của các sổ tiết kiệm TRƯỚC ngày bắt đầu chiến dịch.
   * @param {Array} allGD - Toàn bộ mảng giao dịch
   * @param {Date} cdStartDate - Ngày bắt đầu chiến dịch
   * @param {Object} positiveBookSet - { SoSo: true } chỉ tập các sổ có hoạt động trong kỳ
   * @returns {Object} { SoSo: soDuDauKy (number) }
   */
  _buildPreCampaignBookBalanceMap: function(allGD, cdStartDate, positiveBookSet) {
    var balanceMap = {}; // { SoSo: { gui: 0, rut: 0 } }

    allGD.forEach(function(gd) {
      if (gd.TrangThai !== 'ACTIVE') return;
      var soSo = String(gd.SoSo || "").trim();
      if (!soSo || !positiveBookSet[soSo]) return; // Chỉ xét các sổ có phát sinh trong chiến dịch

      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (!gdDate || gdDate >= cdStartDate) return; // Chỉ GD TRƯỚC chiến dịch

      if (!balanceMap[soSo]) balanceMap[soSo] = { gui: 0, rut: 0 };
      var soTien = parseFloat(gd.SoTien || 0);
      if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
        balanceMap[soSo].gui += soTien;
      } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
        balanceMap[soSo].rut += soTien;
      }
    });

    var result = {};
    Object.keys(balanceMap).forEach(function(soSo) {
      result[soSo] = balanceMap[soSo].gui - balanceMap[soSo].rut;
    });
    // Các sổ chưa có GD nào trước CD (mở mới trong CD) => số dư đầu kỳ = 0
    Object.keys(positiveBookSet).forEach(function(soSo) {
      if (result[soSo] === undefined) result[soSo] = 0;
    });
    return result;
  },

  /**
   * [PUBLIC API] Báo cáo Tăng Trưởng Tiền Gửi theo Chiến Dịch & Cán Bộ.
   * Tính Net Growth theo nghiệp vụ:
   *   - KH Mới: Tính toàn bộ (dương).
   *   - KH Cũ: Chỉ tính phần tăng thêm nếu dương (bỏ qua nếu giảm).
   * @param {Object} user - User object (phải là ADMIN)
   * @param {Object} filters - { maCD, maNV, kpiMode }
   * @returns {Object} { summary, chiTietKHMoi, chiTietKHCuTang }
   */
  getBaoCaoTangTruong: function(user, filters, isInternalCall) {
    if (!isInternalCall && user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error('Chỉ có ADMIN mới được xem báo cáo Tăng Trưởng.');
    }

    filters = filters || {};
    var maCD = ValidatorService.normalizeId(filters.maCD);
    if (!maCD) throw new Error('Vui lòng chọn Chiến Dịch để phân tích tăng trưởng.');

    var maNVFilter = ValidatorService.normalizeId(filters.maNV);
    if (!isInternalCall && user.Role !== CONFIG.ROLES.ADMIN) {
      maNVFilter = ValidatorService.normalizeId(user.MaNV);
    }
    var kpiMode = filters.kpiMode || 'THI_DUA';

    // ── 1. Lấy metadata chiến dịch (ngày bắt đầu, kết thúc) ──────────────────
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var cdInfo = null;
    allCD.forEach(function(cd) {
      if (ValidatorService.normalizeId(cd.MaCD) === maCD) cdInfo = cd;
    });
    if (!cdInfo) throw new Error('Không tìm thấy thông tin Chiến Dịch: ' + maCD);

    var cdStartDate = cdInfo.NgayBatDau ? ValidatorService.parseDate(cdInfo.NgayBatDau) : null;
    var cdEndDate   = cdInfo.NgayKetThuc ? ValidatorService.parseDate(cdInfo.NgayKetThuc) : null;
    if (!cdStartDate) throw new Error('Chiến Dịch chưa có Ngày Bắt Đầu. Vui lòng cập nhật thông tin chiến dịch.');
    if (cdStartDate) cdStartDate.setHours(0, 0, 0, 0);
    if (cdEndDate) cdEndDate.setHours(23, 59, 59, 999);

    var year = cdStartDate.getFullYear();
    var yearStart = new Date(year, 0, 1, 0, 0, 0, 0); // Ngày 1/1 của năm diễn ra chiến dịch

    // ── 2. Lấy toàn bộ GD và ChiTiêu (1 lần vào RAM) ────────────────────────
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);

    // Lọc GD trong phạm vi chiến dịch (đã duyệt + đúng CD + theo kpiMode)
    // Lưu ý: Không lọc maNVFilter sớm ở đây để đảm bảo tính tổng net của khách hàng trên toàn hệ thống (Anti-churn).
    var filteredGD = allGD.filter(function(gd) {
      if (gd.TrangThai !== 'ACTIVE') return false;
      if (ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;

      // Lọc theo ngày bắt đầu / kết thúc chiến dịch nếu kpiMode = THI_DUA
      if (kpiMode === 'THI_DUA') {
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (cdStartDate && gdDate < cdStartDate) return false;
        if (cdEndDate && gdDate > cdEndDate) return false;
      }
      return true;
    });

    // ── 3. Xây dựng tập KH tham gia chiến dịch ───────────────────────────────
    var targetMaKHSet = {}; // Tập KH xuất hiện trong filteredGD
    filteredGD.forEach(function(gd) {
      if (gd.MaKH) targetMaKHSet[ValidatorService.normalizeId(gd.MaKH)] = true;
    });

    // ── 4. Phân loại KH Mới / KH Cũ ──────────────────────────────────────────
    var classified = this._classifyCustomers(allGD, cdStartDate, targetMaKHSet);
    var newKHSet = classified.newSet;   // { MaKH: true }
    var oldKHSet = classified.oldSet;   // { MaKH: true }

    // ── 5. Tính Net trong chiến dịch theo từng Sổ tiết kiệm và từng Cán bộ ──────────
    var bookNetMap = {}; // { "SoSo_MaNV": { SoSo, MaNV, MaKH, gui, rut } }
    var tellersSet = {}; // Tập cán bộ có hoạt động giao dịch

    filteredGD.forEach(function(gd) {
      var soSo = String(gd.SoSo || "").trim();
      if (!soSo) return; // Bỏ qua giao dịch không có số sổ

      var maNV = ValidatorService.normalizeId(gd.MaNV);
      var maKH = ValidatorService.normalizeId(gd.MaKH);
      if (!maNV || !maKH) return;

      tellersSet[maNV] = true;

      var key = soSo + "_" + maNV;
      if (!bookNetMap[key]) {
        bookNetMap[key] = { SoSo: gd.SoSo, MaNV: maNV, MaKH: maKH, gui: 0, rut: 0 };
      }

      var soTien = parseFloat(gd.SoTien || 0);
      if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
        bookNetMap[key].gui += soTien;
      } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
        bookNetMap[key].rut += soTien;
      }
    });

    // ── 6. Lọc các sổ có tăng trưởng ròng dương ─────────────────────────────────────
    var positiveBooks = []; // Danh sách các sổ có net dương của từng cán bộ
    var positiveBookKeysSet = {}; // { SoSo: true }

    Object.keys(bookNetMap).forEach(function(k) {
      var item = bookNetMap[k];
      var net = item.gui - item.rut;
      if (net > 0) {
        positiveBooks.push({
          SoSo: item.SoSo,
          MaNV: item.MaNV,
          MaKH: item.MaKH,
          gui: item.gui,
          rut: item.rut,
          net: net
        });
        positiveBookKeysSet[item.SoSo] = true;
      }
    });

    // ── 7. Tính Số Dư Đầu Kỳ của các sổ cũ trước chiến dịch ─────────────────────────
    var preCampaignBookBalance = this._buildPreCampaignBookBalanceMap(allGD, cdStartDate, positiveBookKeysSet);

    // ── 8. Tính Số Dư của Khách Hàng Cũ tại đầu năm và cuối chiến dịch ─────────────
    var customerBalanceStart = {}; // { MaKH: balance }
    var customerBalanceEnd = {};   // { MaKH: balance }

    allGD.forEach(function(gd) {
      if (gd.TrangThai !== 'ACTIVE') return;
      var maKH = ValidatorService.normalizeId(gd.MaKH);
      if (!maKH || !oldKHSet[maKH]) return;

      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (!gdDate) return;

      var soTien = parseFloat(gd.SoTien || 0);
      var change = 0;
      if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
        change = soTien;
      } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
        change = -soTien;
      }

      // Giao dịch diễn ra trước đầu năm (01/01 của năm diễn ra chiến dịch)
      if (gdDate < yearStart) {
        customerBalanceStart[maKH] = (customerBalanceStart[maKH] || 0) + change;
      }

      // Giao dịch diễn ra trước hoặc trong chiến dịch (<= cdEndDate)
      if (gdDate <= cdEndDate) {
        customerBalanceEnd[maKH] = (customerBalanceEnd[maKH] || 0) + change;
      }
    });

    var customerYearlyGrowth = {};
    Object.keys(oldKHSet).forEach(function(maKH) {
      var startBal = customerBalanceStart[maKH] || 0;
      var endBal = customerBalanceEnd[maKH] || 0;
      customerYearlyGrowth[maKH] = Math.max(0, endBal - startBal);
    });

    // ── 9. Lấy dữ liệu hỗ trợ: Chỉ Tiêu, Nhân Sự, Khách Hàng ─────────────────────────
    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    var chiTieuMap = {}; // { MaNV: soChiTieu }
    allChiTieu.forEach(function(ct) {
      if (ValidatorService.normalizeId(ct.MaCD) !== maCD) return;
      var nvKey = ValidatorService.normalizeId(ct.MaNV);
      if (!nvKey) return;
      chiTieuMap[nvKey] = (chiTieuMap[nvKey] || 0) + parseFloat(ct.ChiTieu || 0);
      tellersSet[nvKey] = true; // Đảm bảo cán bộ được giao chỉ tiêu cũng có mặt
    });

    var nsMap = {};
    NhanSuService.getAll().forEach(function(ns) {
      if (ns.MaNV) nsMap[ValidatorService.normalizeId(ns.MaNV)] = ns;
    });

    var khMap = {};
    KhachHangService.getAll().forEach(function(kh) {
      if (kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh;
    });

    // ── 10. Tính toán tăng trưởng cấp Sổ và gom nhóm theo Nhân viên (Unique Khách hàng) ─
    var employeeGrowthMap = {}; // { MaNV: { TangTruongKHMoi: 0, TangTruongKHCu: 0, KHMoiSet: {}, KHCuSet: {} } }
    Object.keys(tellersSet).forEach(function(maNV) {
      employeeGrowthMap[maNV] = { TangTruongKHMoi: 0, TangTruongKHCu: 0, KHMoiSet: {}, KHCuSet: {} };
    });

    var chiTietKHMoi = [];
    var chiTietKHCuTang = [];

    // Tách và xử lý riêng biệt cho KH Mới và KH Cũ
    var oldBooksByKH = {}; // { MaKH: [book1, book2, ...] }

    positiveBooks.forEach(function(book) {
      var maKH = book.MaKH;
      var isNew = !!newKHSet[maKH];

      if (isNew) {
        // Xử lý trực tiếp cho KH Mới (không áp dụng giới hạn năm theo Phương án A)
        var maNV = book.MaNV;
        var net = book.net;
        var kh = khMap[maKH] || {};
        var tenKH = kh.HoTen || maKH;

        if (!employeeGrowthMap[maNV]) {
          employeeGrowthMap[maNV] = { TangTruongKHMoi: 0, TangTruongKHCu: 0, KHMoiSet: {}, KHCuSet: {} };
        }

        employeeGrowthMap[maNV].TangTruongKHMoi += net;
        employeeGrowthMap[maNV].KHMoiSet[maKH] = true; // Ghi nhận khách hàng mới unique per cán bộ

        chiTietKHMoi.push({
          MaNV: maNV,
          MaKH: maKH,
          TenKH: tenKH,
          SoSo: book.SoSo,
          SoTienGui: book.gui,
          SoTienRut: book.rut,
          NetTrongKy: net,
          TinhVaoTangTruong: net
        });
      } else {
        // Gom nhóm KH Cũ để tính giới hạn và phân bổ sau
        if (!oldBooksByKH[maKH]) {
          oldBooksByKH[maKH] = [];
        }
        oldBooksByKH[maKH].push(book);
      }
    });

    // Xử lý giới hạn tăng trưởng năm và phân bổ cho KH Cũ
    Object.keys(oldBooksByKH).forEach(function(maKH) {
      var books = oldBooksByKH[maKH];
      var maxGrowth = customerYearlyGrowth[maKH] !== undefined ? customerYearlyGrowth[maKH] : 0;

      // Tính tổng net dương của các sổ của KH này trong kỳ chiến dịch
      var sumPositiveNets = books.reduce(function(acc, b) { return acc + b.net; }, 0);

      var kh = khMap[maKH] || {};
      var tenKH = kh.HoTen || maKH;

      books.forEach(function(book) {
        var maNV = book.MaNV;
        var soSo = book.SoSo;
        var net = book.net;

        // Tính phần tăng được ghi nhận (có thể bị scale down nếu tổng vượt quá maxGrowth)
        var creditedGrowth = net;
        if (sumPositiveNets > maxGrowth) {
          creditedGrowth = net * (maxGrowth / sumPositiveNets);
        }

        // Làm tròn số tiền cho đẹp
        creditedGrowth = Math.round(creditedGrowth * 100) / 100;

        if (!employeeGrowthMap[maNV]) {
          employeeGrowthMap[maNV] = { TangTruongKHMoi: 0, TangTruongKHCu: 0, KHMoiSet: {}, KHCuSet: {} };
        }

        if (creditedGrowth > 0) {
          employeeGrowthMap[maNV].TangTruongKHCu += creditedGrowth;
          employeeGrowthMap[maNV].KHCuSet[maKH] = true; // Ghi nhận khách hàng cũ tăng unique per cán bộ
        }

        var soDuDauKy = preCampaignBookBalance[soSo] || 0;
        var soDuCuoiKy = soDuDauKy + net;

        chiTietKHCuTang.push({
          MaNV: maNV,
          MaKH: maKH,
          TenKH: tenKH,
          SoSo: soSo,
          SoDuDauKy: soDuDauKy,
          NetTrongKy: net,
          SoDuCuoiKy: soDuCuoiKy,
          TangThem: creditedGrowth
        });
      });
    });

    // Gom nhóm kết quả cuối cùng theo từng Cán Bộ để làm Summary
    var summary = [];
    Object.keys(tellersSet).forEach(function(maNV) {
      var empStats = employeeGrowthMap[maNV] || { TangTruongKHMoi: 0, TangTruongKHCu: 0, KHMoiSet: {}, KHCuSet: {} };
      var chiTieu = chiTieuMap[maNV] || 0;
      var ns = nsMap[maNV] || {};

      var soKHMoi = Object.keys(empStats.KHMoiSet || {}).length;
      var soKHCuTang = Object.keys(empStats.KHCuSet || {}).length;

      // Chỉ hiển thị cán bộ có chỉ tiêu hoặc có hoạt động giao dịch
      var hasActivity = empStats.TangTruongKHMoi > 0 || empStats.TangTruongKHCu > 0 || soKHMoi > 0 || soKHCuTang > 0;
      if (chiTieu <= 0 && !hasActivity) return;

      var tongTangTruong = empStats.TangTruongKHMoi + empStats.TangTruongKHCu;

      summary.push({
        MaNV: maNV,
        TenNV: ns.HoTen || maNV,
        ChiTieu: chiTieu,
        SoKHMoi: soKHMoi, // Số lượng KH mới nguyên người (Unique MaKH per cán bộ)
        SoKHCuTang: soKHCuTang, // Số lượng KH cũ tăng nguyên người (Unique MaKH per cán bộ)
        TangTruongKHMoi: empStats.TangTruongKHMoi,
        TangTruongKHCu:  empStats.TangTruongKHCu,
        TongTangTruong:  tongTangTruong,
        TyLeHoanThanh:   chiTieu > 0 ? (tongTangTruong / chiTieu) * 100 : 0
      });
    });

    // Hậu lọc theo Cán Bộ (Post-filtering) để số liệu khớp đúng toàn cục
    if (maNVFilter) {
      summary = summary.filter(function(r) { return ValidatorService.normalizeId(r.MaNV) === maNVFilter; });
      chiTietKHMoi = chiTietKHMoi.filter(function(r) { return ValidatorService.normalizeId(r.MaNV) === maNVFilter; });
      chiTietKHCuTang = chiTietKHCuTang.filter(function(r) { return ValidatorService.normalizeId(r.MaNV) === maNVFilter; });
    }

    // Sắp xếp theo TongTangTruong giảm dần
    summary.sort(function(a, b) { return b.TongTangTruong - a.TongTangTruong; });

    return {
      cdInfo: cdInfo,
      summary: summary,
      chiTietKHMoi: chiTietKHMoi,
      chiTietKHCuTang: chiTietKHCuTang
    };
  },

  _getReconciledAccounts: function(maCD, maNV) {
     var reconciled = [];
     if (!maCD) return reconciled;

     var allKH = Repository.getAll(CONFIG.SHEETS.KHACHHANG);
     var khMap = {};
     allKH.forEach(function(kh) {
       if (kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh.HoTen || kh.MaKH;
     });

     var allNS = Repository.getAll(CONFIG.SHEETS.NHANSU);
     var nsMap = {};
     allNS.forEach(function(ns) {
       if (ns.MaNV) nsMap[ValidatorService.normalizeId(ns.MaNV)] = ns.HoTen || ns.MaNV;
     });

     var allSTK = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
     var stkOpenDateMap = {};
     allSTK.forEach(function(stk) {
       if (stk.SoSo) {
         stkOpenDateMap[ValidatorService.normalizeId(stk.SoSo)] = stk.NgayPhatHanh;
       }
     });

     var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
     var normMaCD = ValidatorService.normalizeId(maCD);
     var normMaNV = maNV ? ValidatorService.normalizeId(maNV) : null;

     var filteredReconcileGD = allGD.filter(function(gd) {
       if (gd.TrangThai !== "ACTIVE") return false;
       if (gd.LoaiGD !== "RUT") return false;
       if (ValidatorService.normalizeId(gd.MaCD) !== normMaCD) return false;
       if (normMaNV && ValidatorService.normalizeId(gd.MaNV) !== normMaNV) return false;
       
       var duyetBoi = String(gd.DuyetBoi || "");
       return duyetBoi.indexOf("SYS_RECONCILE") === 0;
     });

     filteredReconcileGD.forEach(function(gd) {
       var normSoSo = ValidatorService.normalizeId(gd.SoSo);
       var openDate = stkOpenDateMap[normSoSo] || gd.NgayGD;
       
       reconciled.push({
         SoSo: gd.SoSo || "---",
         TenKH: khMap[ValidatorService.normalizeId(gd.MaKH)] || gd.MaKH || "---",
         NgayMo: openDate,
         TenNV: nsMap[ValidatorService.normalizeId(gd.MaNV)] || gd.MaNV || "---"
       });
     });

     reconciled.sort(function(a, b) {
       return String(a.SoSo).localeCompare(String(b.SoSo));
     });

     return reconciled;
   }
};
