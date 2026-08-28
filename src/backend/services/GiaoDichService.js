// ==========================================
// GIAODICHSERVICE.GS - Xử lý Nghiệp Vụ Giao Dịch
// ==========================================

var GiaoDichService = {
  
  /**
   * Xử lý Nghiệp vụ Gửi Tiền Mới
   * payload: { CCCD, HoTen, Sdt, DiaChi, SoSo, SoTien, KyHan, LoaiSanh, MaCD, HinhThuc, LaiSuat, LoaiLai }
   */
  themGiaoDichGui: function(user, payload) {
    // 1. Log và Validate
    ValidatorService.requireFields(payload, ["CCCD", "HoTen", "SoTien", "MaCD"]);
    if (!ValidatorService.isPositiveAmount(payload.SoTien)) {
      throw new Error("Số tiền không hợp lệ.");
    }
    // [H7] Validate CCCD: phải là 9 hoặc 12 chữ số
    if (!ValidatorService.isValidCCCD(payload.CCCD)) {
      throw new Error("Số CCCD/CMND không hợp lệ (phải là 9 hoặc 12 chữ số).");
    }
    // Validate số tiền tối thiểu
    var minDeposit = CONFIG.MIN_DEPOSIT_AMOUNT || 100000;
    if (parseFloat(payload.SoTien) < minDeposit) {
      throw new Error("Số tiền gửi tối thiểu là " + minDeposit.toLocaleString('vi-VN') + " VNĐ.");
    }
    
    // Mặc định luôn là 'Mở mới' trừ khi người dùng chọn rõ 'Gửi thêm'
    var hinhThuc = (payload.HinhThuc && String(payload.HinhThuc).trim() === 'Gửi thêm') ? 'Gửi thêm' : 'Mở mới';

    // 1.1. Validate theo Hình Thức Giao Dịch
    if (hinhThuc === 'Gửi thêm') {
      if (!payload.SoSo || String(payload.SoSo).trim() === '') {
        throw new Error("Vui lòng chọn hoặc nhập Số Sổ Tiết Kiệm cần gửi thêm.");
      }
      var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM);
      var targetSo = String(payload.SoSo).trim().toUpperCase();
      var existSo = allSo.filter(function(s) { return String(s.SoSo).trim().toUpperCase() === targetSo; })[0];
      if (!existSo) {
        throw new Error("Số sổ '" + payload.SoSo + "' không tồn tại trên hệ thống để thực hiện gửi thêm.");
      }
      if (existSo.TrangThai !== 'ACTIVE') {
        throw new Error("Sổ tiết kiệm '" + payload.SoSo + "' không ở trạng thái ACTIVE (Trạng thái: " + existSo.TrangThai + ").");
      }
      if (user.Role !== CONFIG.ROLES.ADMIN && ValidatorService.normalizeId(existSo.MaNV) !== ValidatorService.normalizeId(user.MaNV)) {
        throw new Error("Sổ tiết kiệm này thuộc quyền quản lý của Cán bộ khác. Bạn không thể tạo lệnh gửi thêm vào sổ này.");
      }
    } else {
      // Mở mới: Nếu đã nhập số sổ chính thức (đúng chuẩn 9 ký tự), kiểm tra trùng lặp
      if (payload.SoSo && String(payload.SoSo).trim() !== '') {
        var sosoPattern = /^[A-Z]{2}[0-9]{7}$/;
        var targetSo = String(payload.SoSo).trim().toUpperCase();
        if (sosoPattern.test(targetSo) && SoTietKiemService.isSoTietKiemExists(targetSo)) {
          throw new Error("Số sổ '" + targetSo + "' đã tồn tại trên hệ thống. Nếu muốn gửi thêm, vui lòng chọn hình thức 'Gửi thêm vào sổ cũ'.");
        }
      }
    }

    // 2. Tìm hoặc Tạo Khách Hàng
    var maKH = KhachHangService.addIfNotExists({
      CCCD: payload.CCCD,
      HoTen: payload.HoTen,
      Sdt: payload.Sdt,
      DiaChi: payload.DiaChi
    });
    
    // 3. Tạo Giao Dịch Type = GUI với trạng thái PENDING
    var maGD = Repository.generateId("GD_");
    var now = new Date();
    
    var soTienNum = Number(String(payload.SoTien).replace(/[^0-9.]/g, ''));
    if (isNaN(soTienNum) || soTienNum <= 0) throw new Error("Số tiền không hợp lệ.");

    var maNV_Final = user.MaNV;
    if (user.Role === CONFIG.ROLES.ADMIN && payload.MaNV_Assigned) {
      maNV_Final = payload.MaNV_Assigned;
    }
    
    var finalNgayGD = ValidatorService.parseDate(payload.NgayGD || now);
    if (finalNgayGD) {
      finalNgayGD.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    }
    
    var kyHan = payload.KyHan || "KKH";
    var loaiSanh = payload.LoaiSanh || "BT";
    var laiSuat = parseFloat(payload.LaiSuat || 0);
    var loaiLai = payload.LoaiLai || "Standard";
    
    var gdData = {
      MaGD: maGD,
      MaNV: maNV_Final,
      MaKH: maKH,
      MaCD: payload.MaCD,
      SoSo: payload.SoSo ? String(payload.SoSo).trim().toUpperCase() : "",
      LoaiGD: CONFIG.GIAO_DICH.GUI,
      HinhThuc: hinhThuc,
      SoTien: soTienNum,
      KyHan: kyHan,
      LoaiSanh: loaiSanh,
      LaiSuat: laiSuat,
      LoaiLai: loaiLai,
      NgayGD: finalNgayGD || now,
      TrangThai: "PENDING",
      GhiChu: "Giao dịch gửi (" + hinhThuc + "). [Kỳ Hạn: " + kyHan + " | Sảnh: " + loaiSanh + " | " + hinhThuc + "]"
    };
    
    Repository.insert(CONFIG.SHEETS.GIAODICH, gdData);
    return maGD;
  },
  
  /**
   * ADMIN Tính năng: Duyệt giao dịch gửi tiền
   */
  duyetGiaoDichGui: function(user, payload) {
    if (user.Role !== CONFIG.ROLES.ADMIN) throw new Error("Chỉ có ADMIN mới được duyệt lệnh.");
    ValidatorService.requireFields(payload, ["MaGD", "Action"]); // Action = APPROVE / REJECT
    
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); 
    } catch (e) {
      throw new Error("Hệ thống đang xử lý duyệt một lệnh khác. Quý khách vui lòng thử lại sau vài giây.");
    }
    
    try {
      var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH, false);
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
             GhiChu: gdData.GhiChu + " | BỊ TỪ CHỐI BỞI: " + user.MaNV + " (" + customReason + ")"
           }
         }]);
         return "Đã TỪ CHỐI giao dịch " + payload.MaGD;
      } 
      
      if (payload.Action === "APPROVE") {
         var cleanGhiChu = (gdData.GhiChu || "").split(" | SYS_DATA:")[0];
         
         var finalSoSo = payload.SoSoMoi ? payload.SoSoMoi.trim().toUpperCase() : (gdData.SoSo ? gdData.SoSo.trim().toUpperCase() : "");
         if (!ValidatorService.isValidSoSo(finalSoSo)) {
           throw new Error("Số sổ tiết kiệm '" + finalSoSo + "' không đúng định dạng chuẩn của Quỹ. Yêu cầu đúng 9 ký tự: bắt đầu bằng chữ A + 1 chữ cái in hoa (B, C, D...) + 7 chữ số (Ví dụ: AC7078613, AB0001234).");
         }
         
         var finalSoTien = gdData.SoTien;
         if (payload.SoTienMoi) {
             finalSoTien = Number(String(payload.SoTienMoi).replace(/[^0-9.]/g, ''));
             if (isNaN(finalSoTien)) throw new Error("Số tiền điều chỉnh không hợp lệ.");
         }
         var finalNgayGD = payload.NgayGDMoi ? ValidatorService.parseDate(payload.NgayGDMoi) : ValidatorService.parseDate(gdData.NgayGD || now);
         var finalKyHan = payload.KyHanMoi || gdData.KyHan || "KKH";
         var finalMaCD = payload.MaCDMoi || gdData.MaCD;
         var finalLoaiSanh = payload.LoaiSanhMoi || gdData.LoaiSanh || "BT";
         var finalLaiSuat = payload.LaiSuat !== undefined ? parseFloat(payload.LaiSuat) : (parseFloat(gdData.LaiSuat) || 0);
         var finalLoaiLai = payload.LoaiLai || gdData.LoaiLai || "Standard";
         
         // Xác định hình thức: ưu tiên payload Admin gửi -> nếu số sổ chưa có trên hệ thống thì tự động là 'Mở mới'
         var isExistSo = SoTietKiemService.isSoTietKiemExists(finalSoSo);
         var requestedHinhThuc = payload.HinhThucMoi || gdData.HinhThuc;
         var hinhThuc = (requestedHinhThuc === 'Gửi thêm' && isExistSo) ? 'Gửi thêm' : 'Mở mới';

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
             HinhThuc: hinhThuc,
             KyHan: finalKyHan,
             LoaiSanh: finalLoaiSanh,
             LaiSuat: finalLaiSuat,
             LoaiLai: finalLoaiLai,
             GhiChu: cleanGhiChu + adminEditsStr + " | DUYỆT BỞI: " + user.MaNV + " | LOG SỬA KHI DUYỆT: " + (gdData.SoTien !== finalSoTien ? ("S/Tiền mới: " + finalSoTien.toLocaleString('vi-VN') + "đ ") : "Giữ nguyên tiền ") + (finalKyHan ? ("| Kỳ hạn mới: " + finalKyHan) : "") + (finalLaiSuat ? (" | Lãi: " + finalLaiSuat + "%") : "") + (payload.MaCDMoi ? (" | Chiến dịch mới: " + finalMaCD) : ""),
             DuyetBoi: user.MaNV,
             NgayDuyet: now
           }
         }]);
         
         try {
           if (gdData.LoaiGD === CONFIG.GIAO_DICH.GUI) {
               if (hinhThuc === 'Gửi thêm') {
                   // 2a. GỬI THÊM VÀO SỔ HIỆN CÓ: Cộng dồn số dư
                   SoTietKiemService.congDonSoDu(finalSoSo, finalSoTien, {
                     LaiSuat: finalLaiSuat,
                     LoaiLai: finalLoaiLai,
                     KyHanMoi: finalKyHan
                   });
               } else {
                   // 2b. MỞ SỔ MỚI
                   SoTietKiemService.taoMoi(
                        gdData.MaKH, gdData.MaNV, finalSoSo, finalSoTien, 
                        finalKyHan, finalLoaiSanh, finalMaCD, finalNgayGD,
                        finalLaiSuat, finalLoaiLai
                    );
               }
           } else if (gdData.LoaiGD === CONFIG.GIAO_DICH.RUT) {
               // 2c. Xử lý Rút Tiền từ sổ hiện tại
               var allSo = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, false);
               var targetSo = String(finalSoSo || gdData.SoSo).trim().toUpperCase();
               var soTietKiem = allSo.filter(function(so) { return String(so.SoSo).trim().toUpperCase() === targetSo; })[0];
               if (!soTietKiem) throw new Error("Không tìm thấy Sổ Tiết Kiệm '" + targetSo + "' đính kèm lệnh Rút này.");
               
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
                message: "Đã DUYỆT thành công giao dịch " + payload.MaGD + " (" + hinhThuc + ")",
                PasswordPhanQuyen: payload._matKhauTraCuu,
                SoSoMoi: finalSoSo
            };
           
         } catch (insertError) {
           // --- TRANSACTION ROLLBACK ---
           LoggerService.log("ROLLBACK", "duyetGiaoDichGui", "ROLLBACK_APPLIED", { error: insertError.message, maGD: payload.MaGD });
           Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
             rowIndex: gdData._rowIndex,
             data: { 
               TrangThai: "PENDING",
               MaCD: gdData.MaCD,
               GhiChu: gdData.GhiChu,
               DuyetBoi: "",
               NgayDuyet: ""
             }
           }]);
           throw new Error("Lỗi khi cập nhật Sổ tiết kiệm. Đã Rollback giao dịch về trạng thái chờ duyệt. Chi tiết lỗi: " + insertError.message);
         }
       }
    } finally {
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
      var minWithdrawal = CONFIG.MIN_WITHDRAWAL_AMOUNT || 50000;
      
      if (isNaN(soTienRut) || soTienRut < minWithdrawal || soTienRut > soTienHienTai) {
        throw new Error("Số tiền rút không hợp lệ (phải ≥ " + minWithdrawal.toLocaleString('vi-VN') + "đ và ≤ số dư hiện tại: " + soTienHienTai.toLocaleString('vi-VN') + " VNĐ).");
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
        HinhThuc: "Rút tiền",
        SoTien: soTienRut,
        KyHan: soTietKiem.KyHan || "KKH",
        LoaiSanh: soTietKiem.LoaiSanh || "BT",
        LaiSuat: parseFloat(soTietKiem.LaiSuat || 0),
        LoaiLai: soTietKiem.LoaiLai || "Standard",
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
   */
  getPendingCount: function(user) {
    if (!user) return 0;
    
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var count = 0;
    var userMaNVNormalized = ValidatorService.normalizeId(user.MaNV);
    
    for (var i = 0; i < allGD.length; i++) {
        if (allGD[i].TrangThai === "PENDING") {
            if (user.Role === CONFIG.ROLES.ADMIN) {
                count++;
            } else if (ValidatorService.normalizeId(allGD[i].MaNV) === userMaNVNormalized) {
                count++;
            }
        }
    }
    return count;
  },

  /**
   * Lấy lịch sử Datatable phân trang Server-side siêu tối ưu
   */
  getLichSuDatatable: function(user, payload) {
    Logger.log("[Datatable] Fetching history for user: " + user.MaNV + " (Role: " + user.Role + ")");
    var allRawGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    
    var userMaNVNormalized = ValidatorService.normalizeId(user.MaNV);
    var userRoleNormalized = (user.Role || "").toString().trim().toUpperCase();

    // 1. Lọc theo Phân quyền User / Admin
    var filteredGD = allRawGD.filter(function(gd) {
      if (userRoleNormalized === "ADMIN") return true;
      return ValidatorService.normalizeId(gd.MaNV) === userMaNVNormalized;
    });

    var recordsTotal = filteredGD.length;

    // 2. Lọc theo các tiêu chí tìm kiếm từ Payload
    if (payload.MaKH) {
        var fMaKH = ValidatorService.normalizeId(payload.MaKH);
        filteredGD = filteredGD.filter(function(r) { return ValidatorService.normalizeId(r.MaKH).indexOf(fMaKH) > -1; });
    }
    if (payload.MaCD) {
        var fMaCD = ValidatorService.normalizeId(payload.MaCD);
        filteredGD = filteredGD.filter(function(r) { return ValidatorService.normalizeId(r.MaCD) === fMaCD; });
    }
    if (payload.MaNV && userRoleNormalized === "ADMIN") {
        var fMaNV = ValidatorService.normalizeId(payload.MaNV);
        filteredGD = filteredGD.filter(function(r) { return ValidatorService.normalizeId(r.MaNV) === fMaNV; });
    }
    
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

    // 3. Datatables Global Search
    if (payload.search && payload.search.value) {
      var searchStr = String(payload.search.value).toLowerCase();
      filteredGD = filteredGD.filter(function(gd) {
        return (gd.MaGD && String(gd.MaGD).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.SoSo && String(gd.SoSo).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.MaKH && String(gd.MaKH).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.MaNV && String(gd.MaNV).toLowerCase().indexOf(searchStr) > -1) ||
               (gd.GhiChu && String(gd.GhiChu).toLowerCase().indexOf(searchStr) > -1);
      });
    }

    // 4. Sắp xếp (Sorting)
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
    } else {
      // Mặc định sắp xếp theo NgayGD giảm dần
      filteredGD.sort(function(a, b) {
        var dateA = ValidatorService.parseDate(a.NgayGD);
        var dateB = ValidatorService.parseDate(b.NgayGD);
        return (dateB ? dateB.getTime() : 0) - (dateA ? dateA.getTime() : 0);
      });
    }

    var recordsFiltered = filteredGD.length;

    // 5. Cắt đúng trang dữ liệu (Pagination Slice)
    var start = parseInt(payload.start) || 0;
    var length = parseInt(payload.length) || 10;
    var rawSlice = (length === -1) ? filteredGD.slice(start) : filteredGD.slice(start, start + length);

    // 6. CHỈ Map Foreign Names (Tên KH, Tên NV) trên đúng số bản ghi của trang hiện tại -> Tối ưu hiệu năng 80%
    var listKH = KhachHangService.getAll();
    var listNV = NhanSuService.getAll();
    var khMap = {};
    listKH.forEach(function(kh) { if(kh.MaKH) khMap[ValidatorService.normalizeId(kh.MaKH)] = kh.HoTen; });
    var nvMap = {};
    listNV.forEach(function(nv) { if(nv.MaNV) nvMap[ValidatorService.normalizeId(nv.MaNV)] = nv.HoTen; });

    var dataSlice = rawSlice.map(function(gd) {
      var item = Repository.deepClone(gd);
      var normMaKH = ValidatorService.normalizeId(item.MaKH);
      var normMaNV = ValidatorService.normalizeId(item.MaNV);
      item.TenKH = khMap[normMaKH] || item.MaKH || "";
      item.TenNV = nvMap[normMaNV] || item.MaNV || "";
      return item;
    });

    Logger.log("[Datatable] Returning " + dataSlice.length + " items (Filtered: " + recordsFiltered + " / Total: " + recordsTotal + ")");

    return {
       draw: parseInt(payload.draw || 1),
       recordsTotal: recordsTotal,
       recordsFiltered: recordsFiltered,
       data: dataSlice
    };
  },
  
  /**
   * Hủy Giao Dịch Khống (Rollback)
   * Cho phép Hủy khi lệnh ở trạng thái PENDING do chính User tạo (hoặc Admin).
   */
  huyGiaoDich: function(user, maGD) {
    if (!maGD) throw new Error("Mã giao dịch không hợp lệ.");
    
    var allGD = Repository.getAll(CONFIG.SHEETS.GIAODICH);
    var gdData = allGD.filter(function(g) { return g.MaGD === maGD; })[0];
    
    if (!gdData) throw new Error("Không tìm thấy giao dịch.");
    if (gdData.TrangThai !== "PENDING") {
      throw new Error("Chỉ được tự động hủy giao dịch khi Lệnh đang chờ duyệt (PENDING). Lệnh đã duyệt vui lòng liên hệ Quản trị viên để Revert.");
    }
    if (ValidatorService.normalizeId(gdData.MaNV) !== ValidatorService.normalizeId(user.MaNV) && user.Role !== CONFIG.ROLES.ADMIN) {
      throw new Error("Bạn không có quyền hủy giao dịch của Cán bộ khác.");
    }
    
    var now = new Date();
    
    // Đối với lệnh PENDING chưa sinh sổ và chưa tính KPI -> Cập nhật sang CANCELLED
    Repository.updateBatch(CONFIG.SHEETS.GIAODICH, [{
       rowIndex: gdData._rowIndex,
       data: { 
         TrangThai: "CANCELLED",
         GhiChu: (gdData.GhiChu || "") + " | ĐÃ BỊ HỦY BỞI " + user.MaNV + " LÚC " + now.toLocaleString('vi-VN') + " TRƯỚC VÒNG DUYỆT."
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
