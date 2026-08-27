// ==========================================
// KPRI_SERVICE.GS - Quản lý KPI & Summary
// ==========================================

var KPIService = {
  
  /**
   * Cập nhật Summary cho Nhân Viên trong 1 Chiến dịch cụ thể
   */
  updateSummary: function(maNV, maCD) {
    if (!maNV || !maCD) return;
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      // Load thông tin chiến dịch để lấy ngày bắt đầu/kết thúc
      var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH, false);
      var cdInfo = allCD.filter(function(cd) {
        return ValidatorService.normalizeId(cd.MaCD) === ValidatorService.normalizeId(maCD);
      })[0];
      
      var cdStart = cdInfo && cdInfo.NgayBatDau ? ValidatorService.parseDate(cdInfo.NgayBatDau) : null;
      var cdEnd = cdInfo && cdInfo.NgayKetThuc ? ValidatorService.parseDate(cdInfo.NgayKetThuc) : null;
      if (cdStart) cdStart.setHours(0, 0, 0, 0);
      if (cdEnd) cdEnd.setHours(23, 59, 59, 999);

      // 1. Lấy toàn bộ giao dịch của NV trong CD này (đọc mới nhất không qua cache)
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH, false);
      var filterGD = allGD.filter(function(gd) {
        // CHỈ tính giao dịch đã ACTIVE vào KPI, bỏ PENDING/REJECTED/CANCELLED
        var gMaNV = ValidatorService.normalizeId(gd.MaNV);
        var gMaCD = ValidatorService.normalizeId(gd.MaCD);
        if (gMaNV !== ValidatorService.normalizeId(maNV) || gMaCD !== ValidatorService.normalizeId(maCD) || gd.TrangThai !== "ACTIVE") return false;

        // Lọc theo ngày của chiến dịch
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (cdStart && gdDate < cdStart) return false;
        if (cdEnd && gdDate > cdEnd) return false;

        return true;
      });
      
      // 2. Tính TONG_GUI, TONG_RUT, NET
      var tongGui = 0;
      var tongRut = 0;
      
      filterGD.forEach(function(gd) {
        if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
          tongGui += parseFloat(gd.SoTien || 0);
        } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
          tongRut += parseFloat(gd.SoTien || 0);
        }
      });
      
      var net = tongGui - tongRut;
      
      // 3. Tìm dòng trong DB_SUMMARY (MaNV + MaCD) (đọc mới nhất không qua cache)
      var allSummary = Repository.getAll(CONFIG.SHEETS.SUMMARY, false);
      var summaryRow = allSummary.filter(function(sm) {
        return ValidatorService.normalizeId(sm.MaNV) === ValidatorService.normalizeId(maNV) && ValidatorService.normalizeId(sm.MaCD) === ValidatorService.normalizeId(maCD);
      })[0];
      
      var now = new Date();
      
      if (summaryRow) {
        // Update
        Repository.updateBatch(CONFIG.SHEETS.SUMMARY, [{
          rowIndex: summaryRow._rowIndex,
          data: {
            TongGui: tongGui,
            TongRut: tongRut,
            Net: net,
            LastUpdate: now
          }
        }]);
      } else {
        // Insert
        Repository.insert(CONFIG.SHEETS.SUMMARY, {
          MaNV: maNV,
          MaCD: maCD,
          TongGui: tongGui,
          TongRut: tongRut,
          Net: net,
          ChiTieu: 0, // Sẽ được Admin thiết lập sau
          LastUpdate: now
        });
      }
    } catch (e) {
      throw new Error("Lỗi cập nhật dữ liệu bảng tổng hợp KPI: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },
  
  /**
   * Lấy kết quả Summary hiển thị lên Dashboard dựa vào User Role và Filters
   */
  getSummary: function(user, filters) {
    filters = filters || {};
    var maCD = ValidatorService.normalizeId(filters.maCD);
    var maNV = ValidatorService.normalizeId(filters.maNV);
    var tuNgay = filters.tuNgay ? ValidatorService.parseDate(filters.tuNgay) : null;
    if (tuNgay) tuNgay.setHours(0, 0, 0, 0);
    var denNgay = filters.denNgay ? ValidatorService.parseDate(filters.denNgay) : null;
    
    if (denNgay) denNgay.setHours(23, 59, 59, 999);
    
    var result = {
      TongGui: 0,
      TongRut: 0,
      TongRut_TrongChienDich: 0,
      TongRut_SauChienDich: 0,
      Net: 0,
      Net_ThiDua: 0,
      Net_HienTai: 0,
      HoanThanh: 0,
      ChiTieu: 0,
      TongGuiThanhVien: 0,
      TongGuiKhongThanhVien: 0,
      isCampaignEnded: false,
      Timeline: [],
      KyHanMap: {}
    };

    // 1. Tính Chỉ Tiêu từ DB_CHITIEU
    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    var filteredChiTieu = allChiTieu.filter(function(ct) {
       // Filter by Campaign if maCD is provided
       if (maCD && ValidatorService.normalizeId(ct.MaCD) !== maCD) return false;
       return true;
    });
    
    // Calculate total ChiTieu for the visible scope (Staff or Admin)
    filteredChiTieu.forEach(function(ct) {
      if (user.Role !== CONFIG.ROLES.ADMIN && ValidatorService.normalizeId(ct.MaNV) !== ValidatorService.normalizeId(user.MaNV)) return; 
      if (maNV && ValidatorService.normalizeId(ct.MaNV) !== maNV && user.Role === CONFIG.ROLES.ADMIN) return;
      result.ChiTieu += parseFloat(ct.ChiTieu || 0);
    });

    var kpiMode = filters.kpiMode || 'THI_DUA'; // Mặc định là THI_DUA để bảo toàn thành tích thi đua gốc
    var nowTime = new Date().getTime();
    
    // Load thông tin chiến dịch để lấy ngày bắt đầu/kết thúc
    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var cdDateMap = {};
    allCD.forEach(function(cd) {
      if (cd.MaCD) {
        var start = cd.NgayBatDau ? ValidatorService.parseDate(cd.NgayBatDau) : null;
        var end = cd.NgayKetThuc ? ValidatorService.parseDate(cd.NgayKetThuc) : null;
        if (start) start.setHours(0, 0, 0, 0);
        if (end) end.setHours(23, 59, 59, 999);
        var normId = ValidatorService.normalizeId(cd.MaCD);
        cdDateMap[normId] = { start: start, end: end, isEnded: end ? (nowTime > end.getTime()) : false };
        if (maCD && normId === maCD) {
          result.isCampaignEnded = cdDateMap[normId].isEnded;
        }
      }
    });

    // 2. Tính TONG_GUI, TONG_RUT, NET từ GIAODICH 
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var filteredGD = allGD.filter(function(gd) {
      if (gd.TrangThai === "CANCELLED" || gd.TrangThai === "PENDING" || gd.TrangThai === "REJECTED" || gd.TrangThai === "REVERTED") return false;
      if (user.Role !== CONFIG.ROLES.ADMIN && ValidatorService.normalizeId(gd.MaNV) !== ValidatorService.normalizeId(user.MaNV)) return false;
      if (maCD && ValidatorService.normalizeId(gd.MaCD) !== maCD) return false;
      if (maNV && ValidatorService.normalizeId(gd.MaNV) !== maNV && user.Role === CONFIG.ROLES.ADMIN) return false;
      
      var gdDate = ValidatorService.parseDate(gd.NgayGD);
      if (tuNgay && gdDate < tuNgay) return false;
      if (denNgay && gdDate > denNgay) return false;
      
      // Phân loại GD trong đợt vs sau đợt
      var normMaCD = ValidatorService.normalizeId(gd.MaCD);
      if (cdDateMap[normMaCD]) {
        var limits = cdDateMap[normMaCD];
        if (limits.start && gdDate < limits.start) return false;
        
        // Nếu ở chế độ Thi Đua thuần túy, bỏ các GD phát sinh sau khi chiến dịch kết thúc
        if (kpiMode === 'THI_DUA') {
          if (limits.end && gdDate > limits.end) return false;
        }
      }
      
      return true;
    });

    var timelineMap = {};
    
    var stkMap = {};
    var allSTK = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
    allSTK.forEach(function(s) { 
      if(s.SoSo) {
        var normSoSo = s.SoSo.toString().trim().toUpperCase();
        stkMap[normSoSo] = s.KyHan;
      }
    });

    // Lookup for KhachHang to determine Member status
    var khMap = {};
    var allKH = Repository.getAll(CONFIG.SHEETS.KHACHHANG);
    allKH.forEach(function(kh) {
      if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = !!kh.SoTheTV;
    });

    filteredGD.forEach(function(gd) {
      if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI || gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (!gdDate) return; 
        
        var yyyy = gdDate.getFullYear();
        var mm = ("0" + (gdDate.getMonth() + 1)).slice(-2);
        var dd = ("0" + gdDate.getDate()).slice(-2);
        var dateStr = yyyy + "-" + mm + "-" + dd;

        if (!timelineMap[dateStr]) timelineMap[dateStr] = { Net: 0, SoMoi: 0 };
        var soTienGD = parseFloat(gd.SoTien || 0);

        // Robust KyHan detection logic
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

        var displayKyHan = kyHan === "KKH" ? "Không Kỳ Hạn" : kyHan;
        if (!result.KyHanMap[displayKyHan]) result.KyHanMap[displayKyHan] = 0;

        var normMaCD = ValidatorService.normalizeId(gd.MaCD);
        var isAfterCampaign = false;
        if (cdDateMap[normMaCD] && cdDateMap[normMaCD].end && gdDate > cdDateMap[normMaCD].end) {
          isAfterCampaign = true;
        }

        if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
           result.TongGui += soTienGD;
           timelineMap[dateStr].Net += soTienGD;
           timelineMap[dateStr].SoMoi += 1;
           result.KyHanMap[displayKyHan] += soTienGD;
           
           if (gd.MaKH && khMap[ValidatorService.normalizeId(gd.MaKH)]) {
               result.TongGuiThanhVien += soTienGD;
           } else {
               result.TongGuiKhongThanhVien += soTienGD;
           }
        } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
           result.TongRut += soTienGD;
           timelineMap[dateStr].Net -= soTienGD;
           if (isAfterCampaign) {
             result.TongRut_SauChienDich += soTienGD;
           } else {
             result.TongRut_TrongChienDich += soTienGD;
           }
        }
      }
    });

    var timeline = Object.keys(timelineMap).sort().map(function(k) {
        return { Date: k, Net: timelineMap[k].Net, SoMoi: timelineMap[k].SoMoi };
    });
    result.Timeline = timeline;

    result.Net = result.TongGui - result.TongRut;
    result.Net_ThiDua = result.TongGui - result.TongRut_TrongChienDich;
    result.Net_HienTai = result.TongGui - result.TongRut;
    
    // Override Net và HoanThanh trong chế độ THI_DUA có chọn chiến dịch
    if (kpiMode === 'THI_DUA' && maCD) {
      try {
        var tangTruongData = ReportService.getBaoCaoTangTruong(user, { maCD: maCD, maNV: maNV, kpiMode: 'THI_DUA' }, true);
        var summaryList = tangTruongData.summary || [];
        var totalTangTruong = 0;
        summaryList.forEach(function(r) {
          totalTangTruong += r.TongTangTruong;
        });
        result.Net = totalTangTruong;
        result.Net_ThiDua = totalTangTruong;
      } catch (e) {
        // Fallback về raw net nếu có lỗi
      }
    }
    
    if (result.ChiTieu > 0) {
      result.HoanThanh = (result.Net / result.ChiTieu) * 100;
    }
    
    return result;
  },
  
  /**
   * Lấy danh sách giao chỉ tiêu của tất cả Cán bộ trong 1 Chiến dịch (Dùng cho Admin Setup)
   */
  getChiTieuNhanVien: function(maCD) {
    if (!maCD) throw new Error("Vui lòng chọn chiến dịch.");
    
    // 1. Lấy danh sách toàn bộ cán bộ ACTIVE
    var activeNS = NhanSuService.getActiveNhanSu();
    
    // 2. Lấy dữ liệu KPI hiện tại trên DB_CHITIEU (Lọc theo MaCD)
    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    var targetChiTieu = allChiTieu.filter(function(ct) { 
      return ValidatorService.normalizeId(ct.MaCD) === ValidatorService.normalizeId(maCD); 
    });
    
    var ctMap = {};
    targetChiTieu.forEach(function(ct) { 
        var rawVal = ct.ChiTieu;
        var val = 0;
        if (rawVal !== undefined && rawVal !== null && rawVal !== "") {
            if (typeof rawVal === 'number') {
                val = rawVal;
            } else {
                // Xử lý chuỗi số có dấu phẩy hoặc ký tự lạ
                val = parseFloat(String(rawVal).replace(/,/g, '').replace(/[^\d.-]/g, '').trim()) || 0;
            }
        }
        ctMap[ValidatorService.normalizeId(ct.MaNV)] = val; 
    });
    
    // 3. Kết hợp (Map) để hiển thị danh sách cán bộ và KPI hiện tại của họ trong CD này
    var result = activeNS.map(function(ns) {
      var maNVKey = ValidatorService.normalizeId(ns.MaNV);
      return {
        MaNV: ns.MaNV,
        HoTen: ns.HoTen,
        Role: ns.Role,
        ChiTieu: ctMap[maNVKey] !== undefined ? ctMap[maNVKey] : 0
      };
    });
    
    // Sắp xếp: Tên nhân viên hoặc Role (ADMIN lên trước hoặc tùy admin)
    result.sort(function(a, b) {
      if (a.Role !== b.Role) return a.Role === 'ADMIN' ? -1 : 1;
      return a.HoTen.localeCompare(b.HoTen);
    });
    
    return result;
  },
  
  /**
   * Cập nhật Chỉ tiêu (KPI) hàng loạt cho 1 đợt Chiến dịch
   * Mảng Data: { MaCD: "...", ListNhanVien: [ {MaNV, ChiTieu} ] }
   */
  saveChiTieu: function(user, payload) {
    if (!payload.MaCD || !payload.ListNhanVien || !payload.ListNhanVien.length) {
       throw new Error("Dữ liệu không hợp lệ.");
    }
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var maCD = payload.MaCD;
      var list = payload.ListNhanVien;
      
      // Đọc mới nhất không dùng cache
      var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU, false);
      var allSummary = Repository.getAll(CONFIG.SHEETS.SUMMARY, false);
      
      var updatesChiTieu = [];
      var insertsChiTieu = [];
      
      var updatesSummary = [];
      var insertsSummary = [];
      
      var now = new Date();
      
      // Lặp qua danh sách Cán bộ từ Giao diện truyền xuống
      list.forEach(function(item) {
         // Chỉ update nếu ChiTieu >= 0
         var mucTieu = parseFloat(item.ChiTieu || 0);
         
         // Cập nhật vào DB_CHITIEU
         var ctRow = allChiTieu.filter(function(ct) {
            return ValidatorService.normalizeId(ct.MaNV) === ValidatorService.normalizeId(item.MaNV) && ValidatorService.normalizeId(ct.MaCD) === ValidatorService.normalizeId(maCD);
         })[0];
         
         if (ctRow) {
           updatesChiTieu.push({
              rowIndex: ctRow._rowIndex,
              data: { ChiTieu: mucTieu, NgayPhanBo: now, NguoiPhanBo: user.MaNV }
           });
         } else {
           insertsChiTieu.push({
              MaCD: maCD,
              MaNV: item.MaNV,
              ChiTieu: mucTieu,
              NgayPhanBo: now,
              NguoiPhanBo: user.MaNV
           });
         }
         
         // Sắp xếp cập nhật DB_SUMMARY cho đồng bộ dữ liệu nếu có
         var smRow = allSummary.filter(function(sm) {
            return ValidatorService.normalizeId(sm.MaNV) === ValidatorService.normalizeId(item.MaNV) && ValidatorService.normalizeId(sm.MaCD) === ValidatorService.normalizeId(maCD);
         })[0];
         
         if (smRow) {
           updatesSummary.push({
              rowIndex: smRow._rowIndex,
              data: { ChiTieu: mucTieu }
           });
         } else if (mucTieu > 0) {
           insertsSummary.push({
              MaNV: item.MaNV,
              MaCD: maCD,
              TongGui: 0,
              TongRut: 0,
              Net: 0,
              ChiTieu: mucTieu,
              LastUpdate: now
           });
         }
      }); // end Loop
      
      // Thực hiện Batch Insert nếu có
      if (insertsChiTieu.length > 0) {
        Repository.insertBatch(CONFIG.SHEETS.CHITIEU, insertsChiTieu);
      }
      if (insertsSummary.length > 0) {
        Repository.insertBatch(CONFIG.SHEETS.SUMMARY, insertsSummary);
      }
      
      // Thực hiện Batch Update nếu có
      if (updatesChiTieu.length > 0) {
         Repository.updateBatch(CONFIG.SHEETS.CHITIEU, updatesChiTieu);
      }
      if (updatesSummary.length > 0) {
         Repository.updateBatch(CONFIG.SHEETS.SUMMARY, updatesSummary);
      }
      
      return "Đã giao Chỉ tiêu Khen thưởng thành công cho " + list.length + " Cán bộ!";
    } catch (e) {
      throw new Error(e.message);
    } finally {
      lock.releaseLock();
    }
  },
  
  /**
   * Tính toán lại và đồng bộ toàn bộ bảng DB_SUMMARY từ các giao dịch ACTIVE và chỉ tiêu thực tế
   */
  recalculateAllSummary: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Chỉ ADMIN mới có quyền đồng bộ lại dữ liệu KPI hệ thống.");
    }
    
    // 1. Xác thực Master Password
    SystemAdminService.verifyMasterPassword(payload.masterHash);
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      // Xóa cache của SUMMARY trước khi thao tác
      Repository.clearCache(CONFIG.SHEETS.SUMMARY);
      
      // 2. Đọc dữ liệu mới nhất không cache từ Sheet
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH, false);
      var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU, false);
      
      // 3. Tính toán tổng hợp
      var summaryMap = {};
      var now = new Date();
      
      // Load thông tin chiến dịch để lấy ngày bắt đầu/kết thúc
      var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH, false);
      var cdDateMap = {};
      allCD.forEach(function(cd) {
        if (cd.MaCD) {
          var start = cd.NgayBatDau ? ValidatorService.parseDate(cd.NgayBatDau) : null;
          var end = cd.NgayKetThuc ? ValidatorService.parseDate(cd.NgayKetThuc) : null;
          if (start) start.setHours(0, 0, 0, 0);
          if (end) end.setHours(23, 59, 59, 999);
          cdDateMap[ValidatorService.normalizeId(cd.MaCD)] = { start: start, end: end };
        }
      });
      
      // 3.1. Tính từ Giao dịch ACTIVE
      allGD.forEach(function(gd) {
        if (gd.TrangThai !== "ACTIVE") return; // Bỏ qua PENDING, REVERTED, CANCELLED, REJECTED
        
        var maNV = gd.MaNV;
        var maCD = gd.MaCD;
        if (!maNV || !maCD) return;
        
        // Lọc theo ngày của chiến dịch
        var normMaCD = ValidatorService.normalizeId(maCD);
        var gdDate = ValidatorService.parseDate(gd.NgayGD);
        if (!gdDate) return; // [FIX] Bỏ qua GD không có ngày hợp lệ
        if (cdDateMap[normMaCD]) {
          var limits = cdDateMap[normMaCD];
          if (limits.start && gdDate < limits.start) return;
          if (limits.end && gdDate > limits.end) return;
        }
        
        var key = ValidatorService.normalizeId(maNV) + "_" + ValidatorService.normalizeId(maCD); // [FIX] Dùng normalizeId nhất quán
        
        if (!summaryMap[key]) {
          summaryMap[key] = {
            MaNV: maNV,
            MaCD: maCD,
            TongGui: 0,
            TongRut: 0,
            Net: 0,
            ChiTieu: 0,
            LastUpdate: now
          };
        }
        
        var soTien = parseFloat(gd.SoTien || 0);
        if (gd.LoaiGD === CONFIG.GIAO_DICH.GUI) {
          summaryMap[key].TongGui += soTien;
        } else if (gd.LoaiGD === CONFIG.GIAO_DICH.RUT) {
          summaryMap[key].TongRut += soTien;
        }
        summaryMap[key].Net = summaryMap[key].TongGui - summaryMap[key].TongRut;
      });
      
      // 3.2. Cập nhật Chỉ tiêu từ DB_CHITIEU
      allChiTieu.forEach(function(ct) {
        var maNV = ct.MaNV;
        var maCD = ct.MaCD;
        if (!maNV || !maCD) return;
        
        var key = ValidatorService.normalizeId(maNV) + "_" + ValidatorService.normalizeId(maCD); // [FIX] Dùng normalizeId nhất quán
        var chiTieuVal = parseFloat(ct.ChiTieu || 0);
        
        if (!summaryMap[key]) {
          summaryMap[key] = {
            MaNV: maNV,
            MaCD: maCD,
            TongGui: 0,
            TongRut: 0,
            Net: 0,
            ChiTieu: chiTieuVal,
            LastUpdate: now
          };
        } else {
          summaryMap[key].ChiTieu = chiTieuVal;
        }
      });
      
      // Chuyển map thành danh sách
      var records = [];
      for (var k in summaryMap) {
        records.push(summaryMap[k]);
      }
      
      // 4. Chuẩn bị mảng dữ liệu trước khi xóa bảng (Zero Data Loss Pattern)
      var ss = getDbSpreadsheet();
      var sheetSummary = ss.getSheetByName(CONFIG.SHEETS.SUMMARY);
      if (!sheetSummary) throw new Error("Không tìm thấy bảng SUMMARY.");
      
      var lastRow = sheetSummary.getLastRow();
      var lastCol = sheetSummary.getLastColumn();
      var headers = sheetSummary.getRange(1, 1, 1, lastCol).getValues()[0]
                                .map(function(h) { return String(h).trim(); });
      
      var dataToInsert = records.map(function(record) {
        return headers.map(function(header) {
          if (header === "LastUpdate" && record[header] instanceof Date) {
            return record[header].toISOString();
          }
          return record[header] !== undefined ? record[header] : "";
        });
      });

      // Lưu bản sao dự phòng trong RAM trước khi clear
      var backupData = (lastRow > 1) ? sheetSummary.getRange(2, 1, lastRow - 1, headers.length).getValues() : null;
      
      try {
        if (lastRow > 1) {
          sheetSummary.getRange(2, 1, lastRow - 1, headers.length).clearContent();
        }
        if (dataToInsert.length > 0) {
          sheetSummary.getRange(2, 1, dataToInsert.length, headers.length).setValues(dataToInsert);
        }
      } catch (writeErr) {
        // Rollback phục hồi dữ liệu cũ nếu ghi thất bại
        if (backupData && backupData.length > 0) {
          sheetSummary.getRange(2, 1, backupData.length, headers.length).setValues(backupData);
        }
        throw new Error("Lỗi ghi dữ liệu mới vào DB_SUMMARY (Đã phục hồi dữ liệu gốc): " + writeErr.message);
      }
      
      SpreadsheetApp.flush();
      Repository.clearCache(CONFIG.SHEETS.SUMMARY);
      
      return "Đã tính toán và đồng bộ lại toàn bộ dữ liệu KPI thành công cho " + records.length + " bản ghi!";
    } catch (e) {
      throw new Error("Lỗi khi đồng bộ dữ liệu KPI: " + e.message);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Sao chép toàn bộ mức phân bổ chỉ tiêu từ 1 Chiến dịch nguồn sang Chiến dịch đích
   * @param {Object} user - Cán bộ thực hiện (Admin)
   * @param {Object} payload - { sourceMaCD: "CD_...", targetMaCD: "CD_..." }
   */
  copyChiTieuFromCampaign: function(user, payload) {
    if (!payload || !payload.sourceMaCD || !payload.targetMaCD) {
      throw new Error("Vui lòng chọn Chiến dịch nguồn và Chiến dịch đích.");
    }
    if (ValidatorService.normalizeId(payload.sourceMaCD) === ValidatorService.normalizeId(payload.targetMaCD)) {
      throw new Error("Chiến dịch nguồn và Chiến dịch đích không được trùng nhau.");
    }

    var allCD = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
    var sourceCD = allCD.filter(function(cd) {
      return ValidatorService.normalizeId(cd.MaCD) === ValidatorService.normalizeId(payload.sourceMaCD);
    })[0];
    var targetCD = allCD.filter(function(cd) {
      return ValidatorService.normalizeId(cd.MaCD) === ValidatorService.normalizeId(payload.targetMaCD);
    })[0];

    if (!sourceCD) throw new Error("Không tìm thấy Chiến dịch nguồn.");
    if (!targetCD) throw new Error("Không tìm thấy Chiến dịch đích.");

    // Lấy danh sách chỉ tiêu của chiến dịch nguồn
    var allChiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU);
    var sourceChiTieu = allChiTieu.filter(function(ct) {
      return ValidatorService.normalizeId(ct.MaCD) === ValidatorService.normalizeId(payload.sourceMaCD);
    });

    if (!sourceChiTieu.length) {
      throw new Error("Chiến dịch nguồn '" + sourceCD.TenCD + "' chưa có dữ liệu chỉ tiêu để sao chép.");
    }

    // Chuẩn bị danh sách cán bộ sao chép
    var listNhanVien = sourceChiTieu.map(function(ct) {
      var val = typeof ct.ChiTieu === 'number' ? ct.ChiTieu : parseFloat(String(ct.ChiTieu || 0).replace(/,/g, '')) || 0;
      return {
        MaNV: ct.MaNV,
        ChiTieu: val
      };
    });

    // Lưu vào chiến dịch đích
    this.saveChiTieu(user, {
      MaCD: payload.targetMaCD,
      ListNhanVien: listNhanVien
    });

    return "Đã sao chép thành công chỉ tiêu cho " + listNhanVien.length + " cán bộ từ '" + sourceCD.TenCD + "' sang '" + targetCD.TenCD + "'!";
  }
};
