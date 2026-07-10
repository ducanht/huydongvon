// ==========================================
// GIAODICHSERVICE.GS - Xử lý Nghiệp Vụ Giao Dịch
// ==========================================

var GiaoDichService = {
  
  /**
   * Xử lý Nghiệp vụ Gửi Tiền Mới
   * payload: { CCCD, HoTen, Sdt, DiaChi, SoSo, SoTien, KyHan, LoaiSanh, MaCD }
   */
  themGiaoDichGui: function(user, payload) {
    // 1. Log và Validate
    ValidatorService.requireFields(payload, ["CCCD", "HoTen", "SoSo", "SoTien", "MaCD"]);
    if (!ValidatorService.isPositiveAmount(payload.SoTien)) {
      throw new Error("Số tiền không hợp lệ.");
    }
    // [H7] Validate CCCD: phải là 9 hoặc 12 chữ số
    if (!ValidatorService.isValidCCCD(payload.CCCD)) {
      throw new Error("Số CCCD/CMND không hợp lệ (phải là 9 hoặc 12 chữ số).");
    }
    // Validate số tiền tối thiểu
    if (parseFloat(payload.SoTien) < 100000) {
      throw new Error("Số tiền gửi tối thiểu là 100.000 VNĐ.");
    }
    
    // 2. Tìm hoặc Tạo Khách Hàng
    var maKH = KhachHangService.addIfNotExists({
      CCCD: payload.CCCD,
      HoTen: payload.HoTen,
      Sdt: payload.Sdt,
      DiaChi: payload.DiaChi
    });
    
    // 3. (BỎ) Không Tạo Sổ Tiết Kiệm ngay lập tức. Sẽ tạo khi Admin Duyệt
    
    // 4. Tạo Giao Dịch Type = GUI với trạng thái PENDING
    var maGD = Repository.generateId("GD_");
    var now = new Date();
    
    // [H8] Type Safety: Đảm bảo SoTien luôn là số trước khi vào DB
    var soTienNum = Number(String(payload.SoTien).replace(/[^0-9.]/g, ''));
    if (isNaN(soTienNum) || soTienNum <= 0) throw new Error("Số tiền không hợp lệ.");

    var maNV_Final = user.MaNV;
    if (user.Role === CONFIG.ROLES.ADMIN && payload.MaNV_Assigned) {
      maNV_Final = payload.MaNV_Assigned;
    }
    
    var finalNgayGD = ValidatorService.parseDate(payload.NgayGD || now);
    if (finalNgayGD) {
      // Gán giờ phút giây thực tế lúc nhấn Lưu vào ngày do User chọn
      finalNgayGD.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    }
    var hinhThuc = payload.SoSo ? 'Gửi thêm' : 'Mở mới';
    
    var gdData = {
      MaGD: maGD,
      MaNV: maNV_Final,
      MaKH: maKH,
      MaCD: payload.MaCD,
      SoSo: payload.SoSo,
      LoaiGD: CONFIG.GIAO_DICH.GUI,
      SoTien: soTienNum,
      NgayGD: finalNgayGD || now,
      TrangThai: "PENDING",
      GhiChu: "Giao dịch gửi mới. [Kỳ Hạn: " + payload.KyHan + " | Sảnh: " + payload.LoaiSanh + " | " + hinhThuc + "]"
    };
    
    Repository.insert(CONFIG.SHEETS.GIAODICH, gdData);
    
    // 5. (BỎ) Không cập nhật KPI bây giờ, chờ Admin duyệt.
    
    return maGD;
  },
  
  /**
   * ADMIN Tính năng: Duyệt giao dịch gửi tiền
   */
  duyetGiaoDichGui: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được duyệt lệnh.");
    ValidatorService.requireFields(payload, ["MaGD", "Action"]); // Action = APPROVE / REJECT
    
    // Prevent Race Condition: Khóa 15 giây để chống Multi-click hoặc 2 Teller thao tác cùng lúc
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); 
    } catch (e) {
      throw new Error("Hệ thống đang xử lý duyệt một lệnh khác. Quý khách vui lòng thử lại sau vài giây.");
    }
    
    try {
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH, false); // Tắt cache khi duyệt để đảm bảo dữ liệu mới nhất
      var gdData = allGD.filter(function(g) { return g.MaGD === payload.MaGD; })[0];
      
      if (!gdData) throw new Error("Không tìm thấy giao dịch.");
      if (gdData.TrangThai !== "PENDING") throw new Error("Giao dịch này không ở trạng thái chờ duyệt (Có thể người khác đã duyệt).");
      
      var now = new Date();
      
      if (payload.Action === "REJECT") {
         var customReason = payload.LyDo ? "Lý do: " + payload.LyDo : "Không có lý do";
         Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
           rowIndex: gdData._rowIndex,
           data: { 
             TrangThai: "REJECTED",
             GhiChu: gdData.GhiChu + " | ĐÃ BỊ TỪ CHỐI BỞI ADMIN LÚC " + now.toLocaleString('vi-VN') + " (" + user.MaNV + ") | " + customReason,
             DuyetBoi: user.MaNV,
             NgayDuyet: now
           }
         }]);
         return "Đã TỪ CHỐI giao dịch " + payload.MaGD;
      } 
      
      if (payload.Action === "APPROVE") {
         var cleanGhiChu = gdData.GhiChu.split(" | SYS_DATA:")[0];
         
         // 1. Transaction Start - Mark as Active 
         // [H8] Type Safety & Override từ Admin
         var finalSoSo = payload.SoSoMoi ? payload.SoSoMoi.trim().toUpperCase() : gdData.SoSo;
         // Validate định dạng số sổ cho lệnh Gửi: 2 chữ hoa + 7 số
         if (gdData.LoaiGD === CONFIG.GIAO_DICH.GUI) {
           var sosoPattern = /^[A-Z]{2}[0-9]{7}$/;
           if (!finalSoSo || !sosoPattern.test(finalSoSo)) {
             throw new Error("Số sổ '" + finalSoSo + "' không hợp lệ. Yêu cầu: 2 chữ hoa + 7 số (VD: TK0001234).");
           }
         }
         var finalSoTien = gdData.SoTien;
         if (payload.SoTienMoi) {
             finalSoTien = Number(String(payload.SoTienMoi).replace(/[^0-9.]/g, ''));
             if (isNaN(finalSoTien)) throw new Error("Số tiền điều chỉnh không hợp lệ.");
         }
         var finalNgayGD = payload.NgayGDMoi ? ValidatorService.parseDate(payload.NgayGDMoi) : ValidatorService.parseDate(gdData.NgayGD || now);
         var finalKyHan = payload.KyHanMoi ? payload.KyHanMoi : null;
         var finalMaCD = payload.MaCDMoi ? payload.MaCDMoi : gdData.MaCD;

         var adminEditsStr = "";
         if (payload.SoSoMoi || payload.SoTienMoi || payload.NgayGDMoi || payload.KyHanMoi || payload.MaCDMoi) {
             adminEditsStr = " [ADMIN ĐÃ CHỈNH SỬA THÔNG TIN KHỚP SỔ] ";
         }
         
         Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
           rowIndex: gdData._rowIndex,
           data: { 
             TrangThai: "ACTIVE",
             SoSo: finalSoSo,
             SoTien: finalSoTien,
             NgayGD: finalNgayGD,
             MaCD: finalMaCD,
             GhiChu: cleanGhiChu + adminEditsStr + " | DUYỆT BỞI: " + user.MaNV + " | LOG SỬA KHI DUYỆT: " + (gdData.SoTien !== finalSoTien ? ("S/Tiền mới: " + finalSoTien.toLocaleString('vi-VN') + "đ ") : "Giữ nguyên tiền ") + (finalKyHan ? ("| Kỳ hạn mới: " + finalKyHan) : "") + (payload.LaiSuat ? (" | Lãi: " + payload.LaiSuat) : "") + (payload.MaCDMoi ? (" | Chiến dịch mới: " + finalMaCD) : ""),
             DuyetBoi: user.MaNV,
             NgayDuyet: now
           }
         }]);
         
         try {
           if (gdData.LoaiGD === CONFIG.GIAO_DICH.GUI) {
               // 2a. Sinh sổ tiết kiệm mới - parse SYS_DATA từ GhiChu
               var sysData = {};
               try {
                 // Trích xuất metadata từ chuỗi văn bản tự nhiên: "[Kỳ Hạn: 1TH | Sảnh: BT | Mở mới]"
                 var sysDataMatch = gdData.GhiChu.match(/\[Kỳ Hạn:\s*(.*?)\s*\|\s*Sảnh:\s*(.*?)\s*\|/);
                 if (sysDataMatch) {
                     sysData = { KyHan: sysDataMatch[1].trim(), LoaiSanh: sysDataMatch[2].trim() };
                 }
               } catch(e) { sysData = {}; }
               
               var resolvedKyHan = finalKyHan || sysData.KyHan || "KKH"; // Mặc định KKH thay vì 1TH nếu thiếu
               var resolvedLoaiSanh = sysData.LoaiSanh || "BT";
               
               var resultSTK = SoTietKiemService.taoMoi(
                    gdData.MaKH, gdData.MaNV, finalSoSo, finalSoTien, 
                    resolvedKyHan, resolvedLoaiSanh, finalMaCD, finalNgayGD,
                    payload.LaiSuat, payload.LoaiLai
                );
           } else if (gdData.LoaiGD === CONFIG.GIAO_DICH.RUT) {
               // 2b. Xử lý Rút Tiền từ sổ hiện tại
               var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
               var soTietKiem = allSo.filter(function(so) { return so.SoSo === gdData.SoSo; })[0];
               if (!soTietKiem) throw new Error("Không tìm thấy Sổ Tiết Kiệm đính kèm lệnh Rút này.");
               
               var soTienRut = parseFloat(finalSoTien);
               var soTienHienTai = parseFloat(soTietKiem.SoDuHienTai);
               if (soTienRut > soTienHienTai) {
                   throw new Error("Số dư hiện tại trên sổ không đủ để thực hiện lệnh rút này.");
               }
               
               var soDuMoi = soTienHienTai - soTienRut;
               var trangThaiSo = soDuMoi === 0 ? "CLOSED" : "ACTIVE";
               
               Repository.updateBatch(CONFIG.SHEETS.SOTIETKIEM, [{
                 rowIndex: soTietKiem._rowIndex,
                 data: {
                   SoDuHienTai: soDuMoi,
                   TrangThai: trangThaiSo
                 }
               }]);
           }
           
           // 3. Tính lại KPI cho Cán Bộ
           KPIService.updateSummary(gdData.MaNV, finalMaCD);
           if (gdData.MaCD && ValidatorService.normalizeId(gdData.MaCD) !== ValidatorService.normalizeId(finalMaCD)) {
               KPIService.updateSummary(gdData.MaNV, gdData.MaCD);
           }
           return {
                message: "Đã DUYỆT thành công giao dịch " + payload.MaGD,
                PasswordPhanQuyen: payload._matKhauTraCuu,
                SoSoMoi: finalSoSo
            };
           
         } catch (insertError) {
           // --- TRANSACTION ROLLBACK ---
           // Nếu lỗi ở khâu tạo STK hoặc KPI, trả Giao dịch về Trạng thái Cũ.
           LoggerService.log("ROLLBACK", "duyetGiaoDichGui", "ROLLBACK_APPLIED", { error: insertError.message, maGD: payload.MaGD });
           Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
             rowIndex: gdData._rowIndex,
             data: { 
               TrangThai: "PENDING", // Rollback state
               MaCD: gdData.MaCD, // Rollback campaign code
               GhiChu: gdData.GhiChu, // Rollback Ghi chú cũ có kèm SYS_DATA
               DuyetBoi: "", // Rollback
               NgayDuyet: "" // Rollback
             }
           }]);
           throw new Error("Lỗi khi sinh Sổ tiết kiệm. Đã Rollback giao dịch về trạng thái chờ duyệt. Chi tiết lỗi: " + insertError.message);
         }
      }
    } finally {
      // Dù lỗi hay thành công cũng phải nhả Lock
      lock.releaseLock();
    }
  },
  
  /**
   * Xử lý Nghiệp vụ Rút Tiền / Tất toán
   * payload: { SoSo, SoTienRut }
   */
  themGiaoDichRut: function(user, payload) {
    ValidatorService.requireFields(payload, ["SoSo", "SoTienRut"]);
    
    // Prevent Race Condition on Rut Tien (Just simple validation reading)
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); 
    } catch (e) {
      throw new Error("Hệ thống đang xử lý một giao dịch Rút tiền khác. Vui lòng thử lại sau vài giây.");
    }
    
    try {
      // 1. Kiểm tra Sổ tồn tại và thuộc quyền quản lý (hoặc Admin)
      var allSo = SoTietKiemService.getActiveByUser(user);
      var soTietKiem = allSo.filter(function(so) { return so.SoSo === payload.SoSo; })[0];
      
      if (!soTietKiem) {
        throw new Error("Không tìm thấy Sổ Tiết Kiệm hoặc số dư đã tất toán hợp lệ. Liên hệ Admin.");
      }
      
      // [H8] Type Safety
      var soTienRut = Number(String(payload.SoTienRut).replace(/[^0-9.]/g, ''));
      var soTienHienTai = Number(soTietKiem.SoDuHienTai);
      
      if (isNaN(soTienRut) || soTienRut < 1 || soTienRut > soTienHienTai) {
        throw new Error("Số tiền rút không hợp lệ (phải ≥ 1đ và ≤ số dư hiện tại: " + soTienHienTai.toLocaleString('vi-VN') + " VNĐ).");
      }
      
      var maGD = Repository.generateId("GD_");
      var now = new Date();
      
      var gdData = {
        MaGD: maGD,
        MaNV: user.MaNV,
        MaKH: soTietKiem.MaKH,
        MaCD: soTietKiem.MaCD,
        SoSo: payload.SoSo,
        LoaiGD: CONFIG.GIAO_DICH.RUT,
        SoTien: soTienRut,
        NgayGD: now,
        TrangThai: "PENDING",
        GhiChu: "Yêu cầu rút tiền từ sổ " + payload.SoSo
      };
      
      Repository.insert(CONFIG.SHEETS.GIAODICH, gdData);
      
      return maGD;
    } finally {
      lock.releaseLock();
    }
  },
  
  /**
   * Lấy lịch sử giao dịch (Hiển thị DataTable)
   */
  getLichSu: function(user) {
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var listKH = KhachHangService.getAll();
    var listNV = NhanSuService.getAll();

    var khMap = {};
    listKH.forEach(function(kh) { if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh.HoTen; });

    var nvMap = {};
    listNV.forEach(function(nv) { if(nv.MaNV) nvMap[ValidatorService.normalizeId(nv.MaNV)] = nv.HoTen; });

    var userMaNVNormalized = ValidatorService.normalizeId(user.MaNV);
    var userRoleNormalized = (user.Role || "").toString().trim().toUpperCase();

    var result = allGD.filter(function(gd) {
      if (userRoleNormalized === "ADMIN") return true;
      return ValidatorService.normalizeId(gd.MaNV) === userMaNVNormalized;
    });
    
    result = result.map(function(gd) {
       var normMaKH = ValidatorService.normalizeId(gd.MaKH);
       var normMaNV = ValidatorService.normalizeId(gd.MaNV);
       gd.TenKH = khMap[normMaKH] || gd.MaKH || "";
       gd.TenNV = nvMap[normMaNV] || gd.MaNV || "";
       return gd;
    });

    result.sort(function(a, b) {
      var dateA = ValidatorService.parseDate(a.NgayGD);
      var dateB = ValidatorService.parseDate(b.NgayGD);
      return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0);
    });
    
    return result;
  },

  /**
   * Lấy danh sách giao dịch PENDING (tối ưu cho frmChoDuyet)
   * Chỉ trả về PENDING, không lấy toàn bộ như getLichSu
   */
  getPendingGiaoDich: function(user) {
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var listKH = KhachHangService.getAll();
    var listNV = NhanSuService.getAll();

    var khMap = {};
    listKH.forEach(function(kh) { khMap[kh.MaKH] = kh.HoTen; });
    var nvMap = {};
    listNV.forEach(function(nv) { nvMap[nv.MaNV] = nv.HoTen; });

    var result = allGD.filter(function(gd) {
      if (gd.TrangThai !== 'PENDING') return false;
      // USER chỉ thấy lệnh của mình; ADMIN thấy tất cả
      if (user.Role !== CONFIG.ROLES.ADMIN && ValidatorService.normalizeId(gd.MaNV) !== ValidatorService.normalizeId(user.MaNV)) return false;
      return true;
    });

    result = result.map(function(gd) {
      gd.TenKH = khMap[gd.MaKH] || gd.MaKH;
      gd.TenNV = nvMap[gd.MaNV] || gd.MaNV;
      return gd;
    });

    result.sort(function(a, b) {
      var getTimeSafe = function(d) {
        if (!d) return 0;
        var dt = d instanceof Date ? d : new Date(d);
        return (!isNaN(dt.getTime())) ? dt.getTime() : 0;
      };
      return getTimeSafe(b.NgayGD) - getTimeSafe(a.NgayGD);
    });

    return result;
  },

  /**
   * Đếm số lượng giao dịch PENDING (tối ưu cho Badge count Admin)
   * Chỉ cho phép ADMIN mới được đếm
   */
  getPendingCount: function(user) {
    if (!user) return 0;
    
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var count = 0;
    var userMaNVNormalized = ValidatorService.normalizeId(user.MaNV);
    
    for (var i = 0; i < allGD.length; i++) {
        if (allGD[i].TrangThai === "PENDING") {
            // ADMIN thấy tất cả, USER (Teller) chỉ thấy của chính mình
            if (user.Role === CONFIG.ROLES.ADMIN) {
                count++;
            } else if (ValidatorService.normalizeId(allGD[i].MaNV) === userMaNVNormalized) {
                count++;
            }
        }
    }
    return count;
  },

  getLichSuDatatable: function(user, payload) {
    Logger.log("[Datatable] Fetching history for user: " + user.MaNV + " (Role: " + user.Role + ")");
    var allGD = this.getLichSu(user);
    
    // Áp dụng bộ lọc Custom từ Frontend Payload
    var filteredGD = allGD;

    if (payload.MaKH) {
        var fMaKH = ValidatorService.normalizeId(payload.MaKH);
        filteredGD = filteredGD.filter(function(r) { return ValidatorService.normalizeId(r.MaKH).indexOf(fMaKH) > -1; });
    }
    if (payload.MaCD) {
        var fMaCD = ValidatorService.normalizeId(payload.MaCD);
        filteredGD = filteredGD.filter(function(r) { return ValidatorService.normalizeId(r.MaCD) === fMaCD; });
    }
    if (payload.MaNV && (user.Role || "").toString().trim().toUpperCase() === "ADMIN") {
        var fMaNV = ValidatorService.normalizeId(payload.MaNV);
        filteredGD = filteredGD.filter(function(r) { return ValidatorService.normalizeId(r.MaNV) === fMaNV; });
    }
    // ... date filter ...
    var startDt = (payload.tuNgay && String(payload.tuNgay).trim() !== "" && String(payload.tuNgay) !== "null" && String(payload.tuNgay) !== "undefined") ? ValidatorService.parseDate(payload.tuNgay) : null;
    if (startDt) startDt.setHours(0, 0, 0, 0);
    var endDt = (payload.denNgay && String(payload.denNgay).trim() !== "" && String(payload.denNgay) !== "null" && String(payload.denNgay) !== "undefined") ? ValidatorService.parseDate(payload.denNgay) : null;
    if (endDt) endDt.setHours(23, 59, 59, 999);
    
    if (startDt || endDt) {
        filteredGD = filteredGD.filter(function(r) {
            var rDate = ValidatorService.parseDate(r.NgayGD);
            if (!rDate) return false;
            var rTime = rDate.getTime();
            
            if (startDt && rTime < startDt.getTime()) return false;
            if (endDt && rTime > endDt.getTime()) return false;
            return true;
        });
    }
    if (payload.TrangThai) {
        var fStatus = payload.TrangThai.toUpperCase();
        if (fStatus === 'REJECTED') {
            filteredGD = filteredGD.filter(function(r) { 
                var rs = (r.TrangThai || "").toUpperCase();
                return rs === 'REJECTED' || rs === 'CANCELLED'; 
            });
        } else {
            filteredGD = filteredGD.filter(function(r) { 
                return (r.TrangThai || "").toUpperCase() === fStatus; 
            });
        }
    }

    var recordsTotal = allGD.length;
    var recordsFiltered = filteredGD.length;
    
    // Default Datatables Global Search
    if (payload.search && payload.search.value) {
      var searchStr = String(payload.search.value).toLowerCase();
      filteredGD = filteredGD.filter(function(gd) {
        return (gd.MaGD && String(gd.MaGD).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.SoSo && String(gd.SoSo).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.TenKH && String(gd.TenKH).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.TenNV && String(gd.TenNV).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.MaKH && String(gd.MaKH).toLowerCase().indexOf(searchStr) > -1);
      });
    }

    // Default Datatables Sorting
    // Columns map in UI: 0:MaNV, 1:NgayGD, 2:SoSo, 3:MaKH, 4:LoaiGD, 5:SoTien ...
    var colMap = ["MaNV", "NgayGD", "SoSo", "MaKH", "LoaiGD", "SoTien"];
    if (payload.order && payload.order.length > 0) {
      var sortColIdx = payload.order[0].column;
      var sortDir = payload.order[0].dir;
      var sortField = colMap[sortColIdx];
      
      if (sortField) {
        filteredGD.sort(function(a, b) {
           var valA = a[sortField] || "";
           var valB = b[sortField] || "";
           
           if (sortField === "NgayGD") {
              var da = ValidatorService.parseDate(valA);
              var db = ValidatorService.parseDate(valB);
              valA = da ? da.getTime() : 0;
              valB = db ? db.getTime() : 0;
           } else if (sortField === "SoTien") {
              valA = parseFloat(valA) || 0;
              valB = parseFloat(valB) || 0;
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

    recordsFiltered = filteredGD.length;

    var start = parseInt(payload.start) || 0;
    var length = parseInt(payload.length) || 10;
    var dataSlice = (length === -1) ? filteredGD.slice(start) : filteredGD.slice(start, start + length);

    Logger.log("[Datatable] Returning " + dataSlice.length + " items (Filtered: " + recordsFiltered + " / Total: " + recordsTotal + ")");

    return {
       draw: parseInt(payload.draw || 1),
       recordsTotal: recordsTotal,
       recordsFiltered: recordsFiltered,
       data: dataSlice
    };
  },
  
  // Moved and consolidated getPendingCount above
  
  /**
   * Hủy Giao Dịch Khống (Rollback)
   * Chỉ cho phép Huỷ GD do chính User đó tạo và trong vòng 24 giờ.
   */
  huyGiaoDich: function(user, maGD) {
    if (!maGD) throw new Error("Mã giao dịch không hợp lệ.");
    
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var gdData = allGD.filter(function(g) { return g.MaGD === maGD; })[0];
    
    if (!gdData) throw new Error("Không tìm thấy giao dịch.");
    if (gdData.TrangThai !== "PENDING") throw new Error("Chỉ được tự động hủy giao dịch khi Lệnh đang chờ duyệt (PENDING). Lệnh đã duyệt vui lòng báo cáo lỗi.");
    if (ValidatorService.normalizeId(gdData.MaNV) !== ValidatorService.normalizeId(user.MaNV) && user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Bạn không có quyền hủy giao dịch của Cán bộ khác.");
    }
    
    // Kiểm tra giới hạn 24 tiếng
    var gdDate = ValidatorService.parseDate(gdData.NgayGD);
    var now = new Date();
    var diffHours = Math.abs(now - gdDate) / 36e5; // 36e5 = số milliseconds trong 1 giờ
    
    if (diffHours > 24 && user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Đã vượt quá giới hạn 24 giờ để Hủy giao dịch. Vui lòng liên hệ Admin.");
    }
    
    // ----------- BẮT ĐẦU ROLLBACK  ----------- //
    
    // Do từ giờ chỉ cho Hủy khi phiếu Tình trạng = PENDING (Tức là chưa sinh sổ tiết kiệm và chưa tính KPI)
    // Nên Rollback Rất Đơn Giản: Chỉ cần gạch chéo cái Phiếu đó thành CANCELLED là xong. Không cần đục thủng sổ tiết kiệm nữa.
    
    Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
       rowIndex: gdData._rowIndex,
       data: { 
         TrangThai: "CANCELLED",
         GhiChu: (gdData.GhiChu || "") + " | ĐÃ BỊ HỦY LÚC " + now.toLocaleString('vi-VN') + " TRƯỚC VÒNG DUYỆT."
       }
    }]);
    
    return true;
  },

  /**
   * Đảo ngược (Revert) Giao dịch đã duyệt thành công
   * Dành riêng cho ADMIN để sửa sai.
   */
  revertGiaoDichThanhCong: function(user, maGD) {
    if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Tính năng Đặc quyền: Chỉ Admin mới có quyền Đảo ngược lệnh.");
    if (!maGD) throw new Error("Mã giao dịch không hợp lệ.");
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
      var gdData = allGD.filter(function(g) { return g.MaGD === maGD; })[0];
      
      if (!gdData) throw new Error("Không tìm thấy giao dịch.");
      if (gdData.TrangThai !== "ACTIVE") throw new Error("Lệnh này chưa được Duyệt hoặc đã bị Huỷ từ trước.");
      
      // [FIX] Khóa 24h tính từ thời điểm Admin DUYỆT (NgayDuyet), không phải thời điểm Teller TẠO (NgayGD).
      var timeTarget = gdData.NgayDuyet ? gdData.NgayDuyet : gdData.NgayGD;
      var gdDate = ValidatorService.parseDate(timeTarget);
      var now = new Date();
      var diffHours = Math.abs(now - gdDate) / 36e5;
      
      if (diffHours > 24) {
          throw new Error("Đã vượt quá giới hạn 24 giờ kể từ lúc DUYỆT lệnh. Không thể Đảo ngược (Revert) thao tác này nữa.");
      }
      
      var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
      var soTietKiem = allSo.filter(function(so) { return so.SoSo === gdData.SoSo; })[0];
      
      if (!soTietKiem) throw new Error("Không tìm thấy Sổ Tiết Kiệm tương ứng với Giao dịch này. Rất có thể dữ liệu đã bị xoá.");
      
      var mucTien = parseFloat(gdData.SoTien) || 0;
      var soDuHienTai = parseFloat(soTietKiem.SoDuHienTai) || 0;
      var soDuMoi = soDuHienTai;
      
      if (gdData.LoaiGD === CONFIG.GIAO_DICH.GUI) {
          soDuMoi = soDuHienTai - mucTien;
      } else if (gdData.LoaiGD === CONFIG.GIAO_DICH.RUT) {
          soDuMoi = soDuHienTai + mucTien;
      }
      
      if (soDuMoi < 0) {
          throw new Error("Không thể hoàn tác thao tác GỬI vì số dư sổ tiết kiệm sẽ bị ÂM. Có thể sau đó người dùng đã RÚT tiền ra.");
      }
      
      // Update Trạng thái sổ
      var trangThaiSo = soDuMoi > 0 ? "ACTIVE" : "CLOSED";
      
      var now = new Date();
      
      // 1. Cập nhật Số dư sổ
      Repository.updateBatch(CONFIG.SHEETS.SOTIETKIEM, [{
         rowIndex: soTietKiem._rowIndex,
         data: {
           SoDuHienTai: soDuMoi,
           TrangThai: trangThaiSo
         }
      }]);
      
      // 2. Cập nhật Phiếu sang REVERTED
      Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
         rowIndex: gdData._rowIndex,
         data: {
           TrangThai: "REVERTED",
           GhiChu: (gdData.GhiChu || "") + " | ĐÃ REVERT LÚC " + now.toLocaleString('vi-VN') + " BỞI ADMIN " + user.MaNV
         }
      }]);
      
      // 3. Trừ ngược dòng KPI
      KPIService.updateSummary(gdData.MaNV, gdData.MaCD);
      
      // [FIX] Clear Cache để đảm bảo client load lại dữ liệu mới nhất ngay lập tức
      Repository.clearCache(CONFIG.SHEETS.GIAODICH);
      Repository.clearCache(CONFIG.SHEETS.SOTIETKIEM);
      
      LoggerService.log("REVERT_GD", user.MaNV, "SUCCESS", { maGD: maGD, oldState: "ACTIVE" }, { MaNV: user.MaNV, IP: user.IP || "0.0.0.0" });
      
      return "Đã Hoàn tác (Revert) Giao dịch thành công. Số dư và KPI đã được trừ ngược.";
      
    } catch(e) {
      throw e;
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Chuyển các giao dịch CANCELLED/REJECTED sang Sheet Archive để tối ưu
   */
  archiveTransactions: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ Admin mới có quyền Archive dữ liệu.");
    
    // Xác minh password
    if (!payload || !payload.masterHash) throw new Error("Mật khẩu Quản trị Hệ thống bị thiếu.");
    SystemAdminService.verifyMasterPassword(payload.masterHash);
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
      
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH, false); // Lấy data tươi dưới Lock
      var toArchive = allGD.filter(function(gd) {
         return gd.TrangThai === "CANCELLED" || gd.TrangThai === "REJECTED";
      });
      
      if (toArchive.length === 0) return "Không có giao dịch nào cần nén (Archive).";
      
      var ss = getDbSpreadsheet();
      var sheetDb = ss.getSheetByName(CONFIG.SHEETS.GIAODICH);
      var sheetArchive = ss.getSheetByName(CONFIG.SHEETS.GIAODICH_ARCHIVE);
      
      if (!sheetArchive) {
        // Create it if missing
        sheetArchive = ss.insertSheet(CONFIG.SHEETS.GIAODICH_ARCHIVE);
        var headers = sheetDb.getRange(1, 1, 1, sheetDb.getLastColumn()).getValues()[0];
        sheetArchive.appendRow(headers);
      }
      
      // Copy to archive (Batch)
      var headersArchive = sheetArchive.getRange(1, 1, 1, sheetArchive.getLastColumn()).getValues()[0];
      var archiveRows = [];
      toArchive.forEach(function(gd) {
         var rowToInsert = [];
         for (var i = 0; i < headersArchive.length; i++) {
            var key = headersArchive[i];
            rowToInsert.push(gd[key] !== undefined ? gd[key] : ""); 
         }
         archiveRows.push(rowToInsert);
      });
      if (archiveRows.length > 0) {
         sheetArchive.getRange(sheetArchive.getLastRow() + 1, 1, archiveRows.length, headersArchive.length).setValues(archiveRows);
      }
      
      // Delete from DB_GIAODICH in batches (Run-Length Deletion)
      // Must delete from bottom to top to avoid index shifting
      toArchive.sort(function(a, b) { return b._rowIndex - a._rowIndex; });
      var runStart = -1;
      var runLength = 0;
      toArchive.forEach(function(gd) {
         if (runStart === -1) {
             runStart = gd._rowIndex;
             runLength = 1;
         } else if (gd._rowIndex === runStart - runLength) {
             // Adjacent row going upwards
             runLength++;
         } else {
             // Gap found, execute delete for previously accumulated row block
             sheetDb.deleteRows(runStart - runLength + 1, runLength);
             runStart = gd._rowIndex;
             runLength = 1;
         }
      });
      // Ensure last run is deleted
      if (runStart !== -1) {
         sheetDb.deleteRows(runStart - runLength + 1, runLength);
      }
      
      SpreadsheetApp.flush();
      Repository.clearCache(CONFIG.SHEETS.GIAODICH);
      Repository.clearCache(CONFIG.SHEETS.GIAODICH_ARCHIVE);
      
      return "Đã dọn dẹp và nén " + toArchive.length + " giao dịch Bị Hủy/Từ Chối vào Lưu trữ (Archive) thành công.";
    } catch(e) {
      throw new Error("Lỗi nén giao dịch: " + e.message);
    } finally {
      lock.releaseLock();
    }
  }
};
