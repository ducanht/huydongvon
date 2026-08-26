// ==========================================
// CHIENDICHSERVICE.GS - Quản lý Chiến Dịch
// ==========================================

var ChienDichService = {
  
  /**
   * [HELPER] Chuẩn hóa tên Chiến Dịch (Xử lý dứt điểm trường hợp chuỗi Date ISO, rỗng hoặc Date object)
   */
  _sanitizeChienDich: function(cd) {
    if (!cd) return cd;
    var rawTen = cd.TenCD;
    var cleanTenCD = "";
    
    if (rawTen instanceof Date) {
      cleanTenCD = "Chiến Dịch Tháng " + (rawTen.getMonth() + 1) + "/" + rawTen.getFullYear();
    } else if (typeof rawTen === 'string') {
      rawTen = rawTen.trim();
      // Nhận diện chuỗi ngày ISO như "2026-09-01T00:00:00.000+07:00" hoặc "2026-09-01"
      if (rawTen.indexOf('T00:00:00') !== -1 || /^\d{4}-\d{2}-\d{2}/.test(rawTen)) {
        var dt = ValidatorService.parseDate(rawTen);
        if (dt) {
          cleanTenCD = "Chiến Dịch Tháng " + (dt.getMonth() + 1) + "/" + dt.getFullYear();
        } else {
          cleanTenCD = rawTen;
        }
      } else {
        cleanTenCD = rawTen;
      }
    } else if (rawTen) {
      cleanTenCD = String(rawTen);
    }
    
    // Nếu tên chiến dịch rỗng hoặc vô nghĩa, suy luận từ ngày bắt đầu
    if (!cleanTenCD || cleanTenCD.trim() === "" || cleanTenCD === "undefined" || cleanTenCD === "null") {
      if (cd.NgayBatDau) {
        var dtStart = ValidatorService.parseDate(cd.NgayBatDau);
        cleanTenCD = dtStart ? ("Chiến Dịch Tháng " + (dtStart.getMonth() + 1) + "/" + dtStart.getFullYear()) : ("Chiến Dịch " + (cd.MaCD || ""));
      } else {
        cleanTenCD = "Chiến Dịch " + (cd.MaCD || "");
      }
    }
    
    cd.TenCD = cleanTenCD;
    return cd;
  },

  /**
   * Lấy danh sách chiến dịch (Tất cả để Admin giao KPI linh hoạt)
   */
  getActive: function() {
    var self = this;
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var todayStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
    
    // Chỉ lấy chiến dịch đang ACTIVE và trong thời hạn chạy (Đang diễn ra)
    var activeCD = allCD.filter(function(cd) {
      if (cd.TrangThai !== 'ACTIVE') return false;
      
      // Kiểm tra ngày bắt đầu (nếu có)
      if (cd.NgayBatDau) {
        var startStr = cd.NgayBatDau.indexOf('T') !== -1 ? cd.NgayBatDau.split('T')[0] : cd.NgayBatDau;
        if (startStr > todayStr) return false; // Chưa bắt đầu
      }
      
      // Kiểm tra ngày kết thúc (nếu có)
      if (cd.NgayKetThuc) {
        var endStr = cd.NgayKetThuc.indexOf('T') !== -1 ? cd.NgayKetThuc.split('T')[0] : cd.NgayKetThuc;
        if (endStr < todayStr) return false; // Đã hết hạn
      }
      
      return true;
    });
    
    activeCD.sort(function(a, b) {
      var getTimeSafe = function(d) {
        if (!d) return 0;
        var dt = new Date(d);
        return (!isNaN(dt.getTime())) ? dt.getTime() : 0;
      };
      var timeA = getTimeSafe(a.NgayBatDau);
      var timeB = getTimeSafe(b.NgayBatDau);
      return timeB - timeA;
    });
    
    return activeCD.map(function(cd) { return self._sanitizeChienDich(cd); });
  },
  
  getAll: function() {
    var self = this;
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    return allCD.map(function(cd) { return self._sanitizeChienDich(cd); });
  },
  
  /**
   * Thêm hoặc Cập nhật Chiến dịch
   */
  saveChienDich: function(payload) {
    ValidatorService.requireFields(payload, ["TenCD", "LoaiCD", "NgayBatDau"]);
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      // Đọc dữ liệu mới nhất không dùng cache
      var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH, false);
      
      var dateBatDau = ValidatorService.parseDate(payload.NgayBatDau);
      if (!dateBatDau) throw new Error("Ngày bắt đầu không hợp lệ.");
      
      var dateKetThuc = null;
      if (payload.NgayKetThuc) {
        dateKetThuc = ValidatorService.parseDate(payload.NgayKetThuc);
        if (!dateKetThuc) throw new Error("Ngày kết thúc không hợp lệ.");
        if (dateKetThuc.getTime() < dateBatDau.getTime()) {
          throw new Error("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");
        }
      }
      
      if (payload.MaCD) {
        // CẬP NHẬT
        var existCD = allCD.filter(function(cd) { return cd.MaCD === payload.MaCD; })[0];
        if (!existCD) throw new Error("Không tìm thấy Chiến dịch để sửa!");
        
        Repository.updateBatch(CONFIG.SHEETS.CHIENDICH, [{
          rowIndex: existCD._rowIndex,
          data: {
            TenCD: payload.TenCD,
            LoaiCD: payload.LoaiCD,
            NgayBatDau: dateBatDau,
            NgayKetThuc: dateKetThuc || "", // Rỗng tức là Vô thời hạn
            TrangThai: payload.TrangThai || "ACTIVE"
          }
        }]);
        return "Cập nhật thành công chiến dịch: " + payload.TenCD;
      } else {
        // THÊM MỚI
        var newID = Repository.generateId("CD_");
        Repository.insert(CONFIG.SHEETS.CHIENDICH, {
          MaCD: newID,
          TenCD: payload.TenCD,
          LoaiCD: payload.LoaiCD,
          NgayBatDau: dateBatDau,
          NgayKetThuc: dateKetThuc || "",
          TrangThai: payload.TrangThai || "ACTIVE"
        });
        return "Đã tạo mới chiến dịch: " + payload.TenCD;
      }
    } catch (e) {
      throw new Error(e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Lấy Thống Kê Tổng Quan Vĩ Mô Toàn Bộ Chiến Dịch
   */
  getChienDichOverviewStats: function() {
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    var allSummary = Repository.getAll(CONFIG.SHEETS.SUMMARY);
    var todayStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd");

    var runningCount = 0;
    var upcomingCount = 0;
    var endedCount = 0;
    var inactiveCount = 0;

    allCD.forEach(function(cd) {
      if (cd.TrangThai !== 'ACTIVE') {
        inactiveCount++;
        return;
      }
      var startStr = cd.NgayBatDau ? (cd.NgayBatDau.indexOf('T') !== -1 ? cd.NgayBatDau.split('T')[0] : cd.NgayBatDau) : "";
      var endStr = cd.NgayKetThuc ? (cd.NgayKetThuc.indexOf('T') !== -1 ? cd.NgayKetThuc.split('T')[0] : cd.NgayKetThuc) : "";

      if (startStr && startStr > todayStr) {
        upcomingCount++;
      } else if (endStr && endStr < todayStr) {
        endedCount++;
      } else {
        runningCount++;
      }
    });

    var totalKpi = 0;
    var tellersCount = 0;
    allChiTieu.forEach(function(ct) {
      var val = parseFloat(ct.ChiTieu || 0);
      if (val > 0) {
        totalKpi += val;
        tellersCount++;
      }
    });

    var totalNet = 0;
    allSummary.forEach(function(sm) {
      totalNet += parseFloat(sm.Net || 0);
    });

    var avgRate = totalKpi > 0 ? (totalNet / totalKpi) * 100 : 0;

    return {
      totalCampaigns: allCD.length,
      runningCampaigns: runningCount,
      upcomingCampaigns: upcomingCount,
      endedCampaigns: endedCount,
      inactiveCampaigns: inactiveCount,
      totalKpiAssigned: totalKpi,
      totalTellersAssigned: tellersCount,
      totalMobilizedNet: totalNet,
      averageCompletionRate: Math.round(avgRate * 10) / 10
    };
  },

  /**
   * Lấy danh sách chiến dịch phân nhóm chi tiết & thống kê từng chiến dịch
   */
  getChienDichGroupedList: function() {
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    var allSummary = Repository.getAll(CONFIG.SHEETS.SUMMARY);
    var now = new Date();
    var todayStr = Utilities.formatDate(now, "Asia/Ho_Chi_Minh", "yyyy-MM-dd");

    // Tạo map chỉ tiêu và net theo từng MaCD
    var kpiByCd = {};
    var tellersByCd = {};
    allChiTieu.forEach(function(ct) {
      var mcd = ValidatorService.normalizeId(ct.MaCD);
      if (!mcd) return;
      var val = parseFloat(ct.ChiTieu || 0);
      kpiByCd[mcd] = (kpiByCd[mcd] || 0) + val;
      if (val > 0) tellersByCd[mcd] = (tellersByCd[mcd] || 0) + 1;
    });

    var netByCd = {};
    allSummary.forEach(function(sm) {
      var mcd = ValidatorService.normalizeId(sm.MaCD);
      if (!mcd) return;
      netByCd[mcd] = (netByCd[mcd] || 0) + parseFloat(sm.Net || 0);
    });

    return allCD.map(function(cd) {
      var mcdNorm = ValidatorService.normalizeId(cd.MaCD);
      var startStr = cd.NgayBatDau ? (cd.NgayBatDau.indexOf('T') !== -1 ? cd.NgayBatDau.split('T')[0] : cd.NgayBatDau) : "";
      var endStr = cd.NgayKetThuc ? (cd.NgayKetThuc.indexOf('T') !== -1 ? cd.NgayKetThuc.split('T')[0] : cd.NgayKetThuc) : "";

      var statusGroup = "RUNNING";
      var statusBadge = "Đang Diễn Ra";
      var statusClass = "success";

      if (cd.TrangThai !== 'ACTIVE') {
        statusGroup = "INACTIVE";
        statusBadge = "Đã Tạm Dừng";
        statusClass = "secondary";
      } else if (startStr && startStr > todayStr) {
        statusGroup = "UPCOMING";
        statusBadge = "Sắp Diễn Ra";
        statusClass = "warning";
      } else if (endStr && endStr < todayStr) {
        statusGroup = "ENDED";
        statusBadge = "Đã Kết Thúc";
        statusClass = "dark";
      }

      // Tính % thời gian trôi qua
      var elapsedPercent = 0;
      if (cd.NgayBatDau && cd.NgayKetThuc) {
        var dtStart = ValidatorService.parseDate(cd.NgayBatDau);
        var dtEnd = ValidatorService.parseDate(cd.NgayKetThuc);
        if (dtStart && dtEnd && dtEnd.getTime() > dtStart.getTime()) {
          var totalDuration = dtEnd.getTime() - dtStart.getTime();
          var elapsedDuration = now.getTime() - dtStart.getTime();
          if (elapsedDuration <= 0) {
            elapsedPercent = 0;
          } else if (elapsedDuration >= totalDuration) {
            elapsedPercent = 100;
          } else {
            elapsedPercent = Math.round((elapsedDuration / totalDuration) * 100);
          }
        }
      }

      var cdKpi = kpiByCd[mcdNorm] || 0;
      var cdNet = netByCd[mcdNorm] || 0;
      var completionRate = cdKpi > 0 ? Math.round((cdNet / cdKpi) * 1000) / 10 : 0;

      // Chuẩn hóa tên chiến dịch nếu là ISO date string
      var cleanTenCD = cd.TenCD || "";
      if (typeof cleanTenCD === 'string' && (cleanTenCD.indexOf('T00:00:00') !== -1 || /^\d{4}-\d{2}-\d{2}/.test(cleanTenCD))) {
        var dt = ValidatorService.parseDate(cleanTenCD);
        if (dt) {
          cleanTenCD = "Chiến Dịch Tháng " + (dt.getMonth() + 1) + "/" + dt.getFullYear();
        }
      }

      return {
        MaCD: cd.MaCD,
        TenCD: cleanTenCD,
        LoaiCD: cd.LoaiCD,
        NgayBatDau: cd.NgayBatDau,
        NgayKetThuc: cd.NgayKetThuc,
        TrangThai: cd.TrangThai,
        statusGroup: statusGroup,
        statusBadge: statusBadge,
        statusClass: statusClass,
        totalKpi: cdKpi,
        tellersCount: tellersByCd[mcdNorm] || 0,
        totalNet: cdNet,
        completionRate: completionRate,
        elapsedPercent: elapsedPercent
      };
    });
  }
};
