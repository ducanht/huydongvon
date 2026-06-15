// ==========================================
// DUMMYDATASERVICE.GS - Khởi tạo dữ liệu giả lập (Bulk)
// ==========================================

// Hàm chạy trực tiếp từ giao diện Google Apps Script
function RUN_KHOI_TAO_DU_LIEU() {
  DummyDataService.initDummyData();
}

function RUN_KHOI_TAO_CHI_TIEU() {
  DummyDataService.initChiTieuData();
}

function RUN_KHOI_TAO_HISTORY_VA_CHITIEU() {
  DummyDataService.initHistoryAndChiTieuData();
}

/**
 * Xoá sạch dữ liệu cũ và sinh dữ liệu test THỰC TẾ theo yêu cầu
 * (Tỉ lệ 98% Gửi, 2% Rút | 5% Chờ duyệt | Phân bổ ngẫu nhiên theo ngày CD)
 */
function RUN_CLEAN_AND_GENERATE_REALISTIC_DATA() {
  DummyDataService.cleanAndGenerateRealisticData();
}

/**
 * Xoá sạch các dữ liệu nghiệp vụ (Giao dịch, Sổ, KPI...) 
 * để chuẩn bị chạy thật. Giữ lời hứa: BẢO TOÀN Khách hàng và Nhân sự.
 */
function RUN_XOA_DU_LIEU_TEST() {
  DummyDataService.clearTestData();
}

/**
 * Rà soát và dọn dẹp cấu trúc Dữ liệu: Xoá Sheet thừa, Xoá Cột thừa
 */
function RUN_VALIDATE_AND_CLEAN_SCHEMA() {
  DummyDataService.validateAndCleanSchema();
}

/**
 * Hàm hỗ trợ: Tạo mật khẩu gốc (123456) cho TẤT CẢ các nhân viên hiện tại 
 * đang có trong sheet DB_NHANSU chưa có mật khẩu
 */
function RUN_TAO_MAT_KHAU_MAC_DINH() {
  DummyDataService.generateDefaultPasswords();
}

var DummyDataService = {
  
  generateDefaultPasswords: function() {
    var ss = getDbSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.NHANSU);
    if (!sheet) throw new Error("Không tìm thấy sheet " + CONFIG.SHEETS.NHANSU);
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    
    var headers = data[0];
    var colMatKhau = headers.indexOf("MatKhau");
    if (colMatKhau === -1) {
       throw new Error("Không tìm thấy cột 'MatKhau' ở dòng 1. Vui lòng chạy Setup.gs trước.");
    }
    
    var defaultHash = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"; // 123456
    var count = 0;
    
    // Cập nhật từng dòng (Bắt đầu từ row 2) với Batch Operations (RAM)
    var passRange = sheet.getRange(2, colMatKhau + 1, data.length - 1, 1);
    var passValues = passRange.getValues();
    for (var i = 1; i < data.length; i++) {
        var currentPw = (passValues[i-1][0] || "").toString().trim();
        if (currentPw === "") {
            passValues[i-1][0] = defaultHash;
            count++;
        }
    }
    if (count > 0) {
        passRange.setValues(passValues);
    }
    
    Logger.log("Đã tạo mật khẩu mặc định (123456) thành công cho " + count + " tài khoản.");
  },
  
  initDummyData: function() {
    var ss = getDbSpreadsheet();
    
    // 1. CLEAR DỮ LIỆU CŨ TỪ DÒNG 2 (Giữ Headers)
    this.clearSheet(ss, CONFIG.SHEETS.NHANSU);
    this.clearSheet(ss, CONFIG.SHEETS.CHIENDICH);
    this.clearSheet(ss, CONFIG.SHEETS.SOTIETKIEM);
    this.clearSheet(ss, CONFIG.SHEETS.GIAODICH);
    this.clearSheet(ss, CONFIG.SHEETS.SUMMARY);
    // Lưu ý: Yêu cầu của user là ĐỌC từ KHACHHANG có sẵn, nên KHÔNG clear KHACHHANG
    
    // Đọc danh sách Khách hàng hiện có
    var sheetKH = ss.getSheetByName(CONFIG.SHEETS.KHACHHANG);
    var khData = sheetKH.getDataRange().getValues();
    var listMaKH = [];
    if (khData.length > 1) {
      var colMaKH = khData[0].indexOf("MaKH");
      for (var k = 1; k < khData.length; k++) {
        if (khData[k][colMaKH]) {
           listMaKH.push(khData[k][colMaKH]);
        }
      }
    }
    
    if (listMaKH.length === 0) {
      throw new Error("Bảng DB_KHACHHANG đang trống. Hãy tạo một vài dòng khách hàng trước khi chạy sinh dữ liệu!");
    }

    // 2. TẠO NHÂN SỰ VỚI MẬT KHẨU MẶC ĐỊNH LÀ 123456
    // SHA-256 của '123456' = 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
    var defaultHash = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";
    var myEmail = Session.getActiveUser().getEmail();
    var nhanSuArr = [
      ["NV01", "Quản Trị Hệ Thống", myEmail, "0900000000", "ADMIN", "ACTIVE", defaultHash] // 1 Admin
    ];
    // Tạo thêm Users
    for (var i = 2; i <= 12; i++) {
        var id = i < 10 ? "0" + i : i.toString();
        nhanSuArr.push(["NV" + id, "Cán Bộ " + i, "canbo" + i + "@qtdnd.com", "090123" + id, "USER", "ACTIVE", defaultHash]);
    }
    var sheetNS = ss.getSheetByName(CONFIG.SHEETS.NHANSU);
    if (nhanSuArr.length > 0) {
        sheetNS.getRange(sheetNS.getLastRow() + 1, 1, nhanSuArr.length, nhanSuArr[0].length).setValues(nhanSuArr);
    }
    
    // 3. TẠO 2 CHIẾN DỊCH
    var today = new Date();
    var m1ago = new Date(today); m1ago.setMonth(today.getMonth() - 1);
    var m1next = new Date(today); m1next.setMonth(today.getMonth() + 1);
    
    var cdArr = [
      ["CD_01", "Chiến dịch Mùa Xuân 2026", "Huy động vốn", m1ago, m1next, "ACTIVE"],
      ["CD_02", "Chiến dịch Tri Ân Khách Hàng", "Huy động vốn", today, m1next, "ACTIVE"]
    ];
    var sheetCD = ss.getSheetByName(CONFIG.SHEETS.CHIENDICH);
    if (cdArr.length > 0) {
        sheetCD.getRange(sheetCD.getLastRow() + 1, 1, cdArr.length, cdArr[0].length).setValues(cdArr);
    }
    
    // 4. SINH GIAO DỊCH VÀ SỔ TIẾT KIỆM CHO MỖI NHÂN VIÊN Ở MỖI CHIẾN DỊCH
    var dsSoTietKiem = []; // Bulk arr
    var dsGiaoDich = [];   // Bulk arr
    var dsSummary = [];    // Bulk arr
    
    var countGD = 1; // Id counter
    var countSo = 1; 

    nhanSuArr.forEach(function(ns) {
      var isUser = ns[4] === "USER"; // Chỉ user (hoặc kể cả admin nếu muốn) đều có thể có KPI. Ta sinh luôn cho tất cả trừ khi muốn loại admin.
      
      cdArr.forEach(function(cd) {
         // Random số giao dịch từ 12 đến 20
         var soGD = Math.floor(Math.random() * (20 - 12 + 1)) + 12; 
         var sumGui = 0;
         var sumRut = 0;
         
         for (var j = 0; j < soGD; j++) {
            // Lấy ngẫu nhiên 1 Khách hàng
            var randomKH = listMaKH[Math.floor(Math.random() * listMaKH.length)];
            
            // Random loại giao dịch: 95% là GUI (0->94), 5% là RUT (95->99)
            var randType = Math.floor(Math.random() * 100);
            var loaiGD = (randType < 95) ? "GUI" : "RUT";
            
            // Sổ Tiết Kiệm
            var soSo = "STK_TEST_" + countSo;
            countSo++;
            
            // Random số tiền 10tr -> 500tr
            var tienGD = Math.floor(Math.random() * 490 + 10) * 1000000; 
            
            // Random Trạng thái: 80% ACTIVE, 20% PENDING (để test duyệt)
            var isPending = Math.random() < 0.2;
            var trangThai = isPending ? "PENDING" : "ACTIVE";
            var ghiChu = "";
            var kyHan = [1, 3, 6, 12][Math.floor(Math.random()*4)];
            var loaiSanh = Math.random() < 0.5 ? "BT" : "VIP";

            // Nếu là GỬI, ta xử lý theo trạng thái
            if (loaiGD === "GUI") {
                if (trangThai === "ACTIVE") {
                    sumGui += tienGD;
                    dsSoTietKiem.push([
                       soSo, randomKH, ns[0], cd[0],
                       today, "", tienGD, tienGD, kyHan + "TH", loaiSanh, "ACTIVE",
                       0, "Standard", 0 // Default LaiSuat, LoaiLai, TienLai
                    ]);
                    ghiChu = "Lệnh sinh tự động: Giao dịch Gửi tiền (Kỳ hạn " + kyHan + "T, " + loaiSanh + ") | ĐƯỢC DUYỆT TỰ ĐỘNG LÚC " + today.toLocaleString('vi-VN');
                } else {
                    // Trạng thái PENDING: Chèn GhiChu theo chuẩn Maker-Checker
                    ghiChu = "Lệnh chờ duyệt: Gửi tiền (Kỳ hạn " + kyHan + "T, " + loaiSanh + ") | SYS_DATA: " + JSON.stringify({ KyHan: kyHan + "TH", LoaiSanh: loaiSanh });
                }
            } else {
                // Nếu là RÚT, cộng sumRut (giả lập Rút) nếu ACTIVE
                if (trangThai === "ACTIVE") {
                    sumRut += Math.floor(tienGD / 2); // Rút 1 nửa cho logic
                    ghiChu = "Lệnh sinh tự động: Rút Tất toán | ĐƯỢC DUYỆT TỰ ĐỘNG LÚC " + today.toLocaleString('vi-VN');
                } else {
                    ghiChu = "Lệnh chờ duyệt: Cán bộ yêu cầu Rút Tất toán.";
                }
                tienGD = Math.floor(tienGD / 2);
            }
            
            // Tạo Giao Dịch
            var maGD = "GD_TEST_" + countGD++;
            dsGiaoDich.push([
               maGD, ns[0], randomKH, cd[0], soSo, loaiGD, tienGD, today, trangThai, ghiChu, "ADMIN", today
            ]);
         }
         
         // Ghi KPI Summary Dummy
         dsSummary.push([
           ns[0], cd[0], 
           sumGui, sumRut, (sumGui - sumRut), 
           10000000000, // 10 Tỷ chỉ tiêu
           today
         ]);
      });
    });
    
    // GHI HÀNG LOẠT VÀO SHEETS
    if(dsSoTietKiem.length > 0) this.writeDataToSheet(ss, CONFIG.SHEETS.SOTIETKIEM, dsSoTietKiem);
    if(dsGiaoDich.length > 0) this.writeDataToSheet(ss, CONFIG.SHEETS.GIAODICH, dsGiaoDich);
    if(dsSummary.length > 0) this.writeDataToSheet(ss, CONFIG.SHEETS.SUMMARY, dsSummary);
    
    // Clear Cache
    var cache = CacheService.getScriptCache();
    Object.keys(CONFIG.SHEETS).forEach(function(key) {
       cache.remove("CACHE_SHEET_" + CONFIG.SHEETS[key]);
    });
  },
  
  initChiTieuData: function() {
    var ss = getDbSpreadsheet();
    
    // 1. Đọc danh sách Nhân sự
    var sheetNS = ss.getSheetByName(CONFIG.SHEETS.NHANSU);
    var nsData = sheetNS.getDataRange().getValues();
    var listNV = [];
    if (nsData.length > 1) {
      var colMaNV = nsData[0].indexOf("MaNV");
      var colRole = nsData[0].indexOf("Role");
      var colTrangThai = nsData[0].indexOf("TrangThai");
      for (var i = 1; i < nsData.length; i++) {
        if (nsData[i][colMaNV] && nsData[i][colTrangThai] === "ACTIVE") { // && nsData[i][colRole] === "USER"
           listNV.push(nsData[i][colMaNV]);
        }
      }
    }
    
    // 2. Đọc danh sách Chiến dịch
    var sheetCD = ss.getSheetByName(CONFIG.SHEETS.CHIENDICH);
    var cdData = sheetCD.getDataRange().getValues();
    var listCD = [];
    if (cdData.length > 1) {
      var colMaCD = cdData[0].indexOf("MaCD");
      for (var k = 1; k < cdData.length; k++) {
        if (cdData[k][colMaCD]) {
           listCD.push(cdData[k][colMaCD]);
        }
      }
    }
    
    if (listNV.length === 0 || listCD.length === 0) {
      throw new Error("Không có đủ Nhân sự hoặc Chiến dịch để phân bổ chỉ tiêu.");
    }
    
    // 3. Đọc DB_SUMMARY hiện tại để Update hoặc Insert
    var allSummary = Repository.getAll(CONFIG.SHEETS.SUMMARY);
    var updates = [];
    var newInserts = [];
    var now = new Date();
    
    listCD.forEach(function(maCD) {
      listNV.forEach(function(maNV) {
         // Sinh chỉ tiêu ngẫu nhiên từ 2 Tỷ đến 10 Tỷ
         var randomTarget = Math.floor(Math.random() * 8 + 2) * 1000000000;
         
         var existRow = allSummary.filter(function(sm) {
            return sm.MaNV === maNV && sm.MaCD === maCD;
         })[0];
         
         if (existRow) {
            updates.push({
               rowIndex: existRow._rowIndex,
               data: { ChiTieu: randomTarget, LastUpdate: now }
            });
         } else {
            newInserts.push([
               maNV, maCD, 0, 0, 0, randomTarget, now
            ]);
         }
      });
    });
    
    // Thực thi Ghi
    if (updates.length > 0) {
       Repository.updateBatch(CONFIG.SHEETS.SUMMARY, updates);
    }
    if (newInserts.length > 0) {
       this.writeDataToSheet(ss, CONFIG.SHEETS.SUMMARY, newInserts);
    }
    
    CacheService.getScriptCache().remove("CACHE_SHEET_" + CONFIG.SHEETS.SUMMARY);
  },
  
  initHistoryAndChiTieuData: function() {
    var ss = getDbSpreadsheet();
    var now = new Date();
    
    // ==========================================
    // 1. Sinh dữ liệu cho DB_KH_HISTORY
    // ==========================================
    this.clearSheet(ss, CONFIG.SHEETS.KH_HISTORY);
    
    var sheetKH = ss.getSheetByName(CONFIG.SHEETS.KHACHHANG);
    var khData = sheetKH.getDataRange().getValues();
    var dsHistory = [];
    var historyCount = 1;
    
    if (khData.length > 1) {
      var colMaKH = khData[0].indexOf("MaKH");
      for (var i = 1; i < khData.length; i++) {
        if (khData[i][colMaKH]) {
           var maKH = khData[i][colMaKH];
           // Mỗi khách hàng tạo 1-2 dòng lịch sử
           dsHistory.push([
             "HIS_" + now.getTime() + "_" + historyCount++, 
             maKH, 
             "CREATE", 
             now, 
             "Tạo mới hồ sơ khách hàng",
             "ADMIN",
             "127.0.0.1"
           ]);
           
           if (Math.random() > 0.5) {
             dsHistory.push([
               "HIS_" + now.getTime() + "_" + historyCount++, 
               maKH, 
               "UPDATE", 
               now, 
               "Cập nhật thông tin KYC",
               "ADMIN",
               "127.0.0.1"
             ]);
           }
        }
      }
    }
    
    // ==========================================
    // 2. Sinh dữ liệu cho DB_CHITIEU (Lịch sử giao chỉ tiêu)
    // ==========================================
    this.clearSheet(ss, CONFIG.SHEETS.CHITIEU);
    
    var sheetSummary = ss.getSheetByName(CONFIG.SHEETS.SUMMARY);
    var summaryData = sheetSummary.getDataRange().getValues();
    var dsChiTieu = [];
    
    if (summaryData.length > 1) {
      var colMaNV = summaryData[0].indexOf("MaNV");
      var colMaCD = summaryData[0].indexOf("MaCD");
      var colChiTieu = summaryData[0].indexOf("ChiTieu");
      
      var nguoiGiao = Session.getActiveUser().getEmail() || "admin@qtdndyentho.com";
      
      for (var j = 1; j < summaryData.length; j++) {
        var maNV = summaryData[j][colMaNV];
        var maCD = summaryData[j][colMaCD];
        var chiTieu = summaryData[j][colChiTieu];
        
        if (maNV && maCD && chiTieu > 0) {
           dsChiTieu.push([
             maCD,
             maNV,
             chiTieu,
             now,
             nguoiGiao
           ]);
        }
      }
    }
    
    // Thực thi Ghi
    if (dsHistory.length > 0) {
       this.writeDataToSheet(ss, CONFIG.SHEETS.KH_HISTORY, dsHistory);
    }
    if (dsChiTieu.length > 0) {
       this.writeDataToSheet(ss, CONFIG.SHEETS.CHITIEU, dsChiTieu);
    }
    
    // Clear Cache
    var cache = CacheService.getScriptCache();
    cache.remove("CACHE_SHEET_" + CONFIG.SHEETS.KH_HISTORY);
    cache.remove("CACHE_SHEET_" + CONFIG.SHEETS.CHITIEU);
  },
  
  clearSheet: function(ss, sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      // Use clearContent instead of deleteRows to avoid "cannot delete all non-frozen rows" error
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }
  },
  
  writeDataToSheet: function(ss, sheetName, dataArray) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || dataArray.length === 0) return;
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, dataArray.length, dataArray[0].length).setValues(dataArray);
  },

  /**
   * Quy trình: Xoá sạch (GD, STK, Summary, ChiTieu) -> Sinh mới dựa trên dữ liệu thật (NS, CD, KH)
   * KPI: 400-500tr/chiến dịch cho mỗi USER.
   * Giao dịch: 15-20 lệnh/NV/CD (95% Gửi, 5% Rút | 99% Active, 1% Pending)
   */
  cleanAndGenerateRealisticData: function() {
    var ss = getDbSpreadsheet();
    var now = new Date();
    
    Logger.log("--- BẮT ĐẦU SINH DỮ LIỆU DỰA TRÊN NGUỒN THẬT ---");

    // 1. DỌN DẸP DỮ LIỆU CŨ (Chỉ xoá các sheet nghiệp vụ & log)
    var sheetsToClear = [
      CONFIG.SHEETS.GIAODICH, 
      CONFIG.SHEETS.SOTIETKIEM, 
      CONFIG.SHEETS.SUMMARY, 
      CONFIG.SHEETS.CHITIEU,
      CONFIG.SHEETS.LOG, 
      CONFIG.SHEETS.KH_HISTORY
    ];
    
    sheetsToClear.forEach(function(sName) {
      Logger.log(">> Đang xoá dữ liệu bảng: " + sName);
      var sh = ss.getSheetByName(sName);
      if (sh && sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      }
    });

    // 2. LẤY DỮ LIỆU NGUỒN THẬT
    var listNV = NhanSuService.getActiveNhanSu().filter(function(nv) { return nv.Role === CONFIG.ROLES.USER; });
    var listCD = ChienDichService.getAll(); // Lấy tất cả chiến dịch để sinh data rộng
    var listKH = KhachHangService.getAll();
    
    if (listNV.length === 0 || listCD.length === 0 || listKH.length === 0) {
      throw new Error("Cần có ít nhất 1 Nhân sự (USER), 1 Chiến dịch và 1 Khách hàng thực tế trong Database.");
    }

    var dsGiaoDich = [];
    var dsSoTietKiem = [];
    var dsChiTieu = [];
    var dsSummary = [];
    
    var countGD = 1;
    var countSTK = 1;

    // 3. SINH DỮ LIỆU CHO TỪNG CHIẾN DỊCH
    listCD.forEach(function(cd) {
      var cdStart = cd.NgayBatDau ? (new Date(cd.NgayBatDau)).getTime() : (now.getTime() - 30*24*60*60*1000);
      var cdEnd = cd.NgayKetThuc ? (new Date(cd.NgayKetThuc)).getTime() : now.getTime();
      if (cdEnd > now.getTime()) cdEnd = now.getTime(); // Không sinh data tương lai quá nhiều

      listNV.forEach(function(nv) {
        // A. GÁN KPI (400tr - 500tr)
        var kpiValue = (Math.floor(Math.random() * 101) + 400) * 1000000; // 400 - 500tr
        dsChiTieu.push([cd.MaCD, nv.MaNV, kpiValue, now, "SYSTEM_GEN"]);
        
        // B. SINH GIAO DỊCH (15 - 20 lệnh)
        var soGD = Math.floor(Math.random() * 6) + 15;
        var nvPassbooks = []; // Lưu danh sách sổ để làm lệnh rút

        for (var i = 0; i < soGD; i++) {
          var randomKH = listKH[Math.floor(Math.random() * listKH.length)];
          
          // Tỷ lệ: 95% Gửi, 5% Rút
          var loaiGD = (Math.random() < 0.95) ? "GUI" : "RUT";
          // Tỷ lệ: 99% Active, 1% Pending
          var trangThai = (Math.random() < 0.99) ? "ACTIVE" : "PENDING";
          
          // Phân bổ thời gian ngẫu nhiên trong đợt CD
          var gdDate = new Date(Math.floor(Math.random() * (cdEnd - cdStart)) + cdStart);
          
          var maGD = "GD_REAL_" + Date.now().toString().slice(-6) + "_" + countGD++;
          var soSo = "";
          // Tiền gửi ngẫu nhiên (20tr - 80tr)
          var soTien = (Math.floor(Math.random() * 61) + 20) * 1000000;
          var ghiChu = "Giao dịch giả lập dựa trên nguồn thực tế.";

          if (loaiGD === "GUI") {
            soSo = "STK_" + gdDate.getTime().toString().slice(-4) + "_" + countSTK++;
            var kyHanArr = ["1TH", "3TH", "6TH", "12TH"];
            var kyHan = kyHanArr[Math.floor(Math.random() * kyHanArr.length)];
            
            if (trangThai === "ACTIVE") {
              var dDate = new Date(gdDate.getTime());
              dDate.setMonth(dDate.getMonth() + parseInt(kyHan));
              
              // Cập nhật Schema mới (11 cột: SoSo, MaKH, MaNV, MaCD, NgayPH, NgayDH, SoDuBD, SoDuHT, KyHan, LoaiSanh, TrangThai)
              dsSoTietKiem.push([
                soSo, randomKH.MaKH, nv.MaNV, cd.MaCD,
                gdDate, dDate, soTien, soTien, kyHan, "BT", "ACTIVE"
              ]);
              nvPassbooks.push({ soSo: soSo, soDu: soTien });
              ghiChu += " | Đã duyệt.";
            } else {
              ghiChu = "[Maker-Checker] Chờ duyệt lệnh Gửi Tiền | SYS_DATA: " + JSON.stringify({ KyHan: kyHan, LoaiSanh: "BT" });
            }
          } else {
            // RÚT
            if (nvPassbooks.length > 0) {
              var idx = Math.floor(Math.random() * nvPassbooks.length);
              var pick = nvPassbooks[idx];
              soSo = pick.soSo;
              soTien = pick.soDu; // Rút toàn bộ
              ghiChu = "Rút tất toán giả lập.";
              if (trangThai === "PENDING") ghiChu = "[Maker-Checker] Chờ duyệt rút tiền.";
            } else {
              // Nếu chưa có sổ nào để rút -> Chuyển sang GỬI
              loaiGD = "GUI";
              soSo = "STK_AUTO_" + countSTK++;
              dsSoTietKiem.push([
                soSo, randomKH.MaKH, nv.MaNV, cd.MaCD, gdDate, gdDate, soTien, soTien, "KKH", "BT", "ACTIVE"
              ]);
              ghiChu = "Gửi tiền tự động (Fallback).";
            }
          }

          dsGiaoDich.push([
            maGD, nv.MaNV, randomKH.MaKH, cd.MaCD, soSo, loaiGD, soTien, gdDate, trangThai, ghiChu, "ADMIN", trangThai === "ACTIVE" ? gdDate : ""
          ]);
        }
      });
    });

    // 4. GHI DỮ LIỆU
    Logger.log(">> Đang ghi " + dsGiaoDich.length + " giao dịch vào Database...");
    if (dsChiTieu.length > 0) this.writeDataToSheet(ss, CONFIG.SHEETS.CHITIEU, dsChiTieu);
    if (dsGiaoDich.length > 0) this.writeDataToSheet(ss, CONFIG.SHEETS.GIAODICH, dsGiaoDich);
    if (dsSoTietKiem.length > 0) this.writeDataToSheet(ss, CONFIG.SHEETS.SOTIETKIEM, dsSoTietKiem);
    
    Logger.log(">> Đang tính toán dữ liệu Tổng hợp (Summary)...");
    // Khởi tạo Summary rows
    listCD.forEach(function(cd) {
      listNV.forEach(function(nv) {
        KPIService.updateSummary(nv.MaNV, cd.MaCD);
      });
    });

    CacheServiceWrapper.remove("CACHE_SHEET_" + CONFIG.SHEETS.GIAODICH);
    CacheServiceWrapper.remove("CACHE_SHEET_" + CONFIG.SHEETS.SOTIETKIEM);
    CacheServiceWrapper.remove("CACHE_SHEET_" + CONFIG.SHEETS.SUMMARY);
    CacheServiceWrapper.remove("CACHE_SHEET_" + CONFIG.SHEETS.CHITIEU);

    Logger.log("--- HOÀN TẤT SINH DỮ LIỆU ---");
    return "Đã sinh mới " + dsGiaoDich.length + " giao dịch cho " + listNV.length + " nhân sự.";
  },

  /**
   * KIỂM TRA VÀ DỌN DẸP CẤU TRÚC (Strict Schema Enforcement)
   */
  validateAndCleanSchema: function() {
    var ss = getDbSpreadsheet();
    var sheets = ss.getSheets();
    
    // Tạo danh sách các Sheet Name hợp lệ từ CONFIG
    var validSheetNames = [];
    for (var key in CONFIG.SHEETS) {
      validSheetNames.push(CONFIG.SHEETS[key]);
    }

    Logger.log("--- BẮT ĐẦU KIỂM TRA & DỌN DẸP SCHEMA (STRICT MODE) ---");

    // 1. KIỂM TRA SHEET THỪA
    sheets.forEach(function(sh) {
       var name = sh.getName();
       if (validSheetNames.indexOf(name) === -1) {
         Logger.log("⚠️ PHÁT HIỆN SHEET THỪA: [" + name + "] -> Đang xoá...");
         try {
           ss.deleteSheet(sh);
         } catch(e) {
           Logger.log("❌ Lỗi khi xoá sheet: " + e.message);
         }
       }
    });

    // 2. KIỂM TRA & ĐỒNG BỘ CỘT TIÊU CHUẨN TRONG TỪNG SHEET
    for (var dbKey in DB_SCHEMAS) {
      var sheetName = CONFIG.SHEETS[dbKey.replace("DB_", "")];
      if (!sheetName) continue;
      
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        Logger.log("ℹ️ Sheet [" + sheetName + "] chưa tồn tại. Sẽ tạo mới...");
        continue;
      }

      var targetHeaders = DB_SCHEMAS[dbKey];
      var lastCol = sheet.getLastColumn();
      
      // Xoá các cột thừa (Cột không nằm trong Schema)
      if (lastCol > 0) {
        var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        for (var colIdx = currentHeaders.length - 1; colIdx >= 0; colIdx--) {
          var hName = String(currentHeaders[colIdx]).trim();
          if (hName !== "" && targetHeaders.indexOf(hName) === -1) {
            Logger.log("⚠️ PHÁT HIỆN CỘT THỪA tại [" + sheetName + "]: [" + hName + "] -> Đang xoá...");
            sheet.deleteColumn(colIdx + 1);
          }
        }
      }

      // [CRITICAL] Ghi đè lại Header row để đảm bảo THỨ TỰ chuẩn
      // Điều này giải quyết vấn đề cột bị nhảy vị trí dẫn đến dữ liệu ghi sai cột
      sheet.getRange(1, 1, 1, targetHeaders.length).setValues([targetHeaders])
           .setFontWeight("bold")
           .setBackground("#f3f3f3")
           .setBorder(true, true, true, true, true, true);
      
      // Xoá các cột trắng thừa ở phía sau (nếu có)
      var newLastCol = sheet.getLastColumn();
      if (newLastCol > targetHeaders.length) {
         Logger.log("⚠️ Dọn dẹp cột trắng thừa ở cuối sheet [" + sheetName + "]");
         sheet.getRange(1, targetHeaders.length + 1, 1, newLastCol - targetHeaders.length).clear();
      }
      
      sheet.setFrozenRows(1);
    }

    // 3. ĐỒNG BỘ LẠI LẦN CUỐI (Tạo sheet thiếu nếu có)
    runSetupDatabase(); 

    Logger.log("--- HOÀN TẤT DỌN DẸP SCHEMA ---");
    return "Đã dọn dẹp và chuẩn hoá cấu trúc dữ liệu thành công.";
  },

  /**
   * DỌN DẸP DỮ LIỆU TEST (SAFETY FIRST)
   * Giữ lại: KHACHHANG, NHANSU, CAUHINH
   */
  clearTestData: function() {
    var ss = getDbSpreadsheet();
    Logger.log("--- BẮT ĐẦU DỌN DẸP DỮ LIỆU THỬ NGHIỆM ---");

    var sheetsToClear = [
      CONFIG.SHEETS.GIAODICH, 
      CONFIG.SHEETS.SOTIETKIEM, 
      CONFIG.SHEETS.SUMMARY, 
      CONFIG.SHEETS.CHIENDICH,
      CONFIG.SHEETS.CHITIEU,
      CONFIG.SHEETS.KH_HISTORY,
      CONFIG.SHEETS.LOG,
      CONFIG.SHEETS.GIAODICH_ARCHIVE
    ];

    var count = 0;
    sheetsToClear.forEach(function(sName) {
      if (!sName) return;
      var sh = ss.getSheetByName(sName);
      if (sh) {
        var lastRow = sh.getLastRow();
        if (lastRow > 1) {
          sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
          Logger.log(">> Đã xoá dữ liệu bảng: " + sName);
          count++;
        }
      }
    });

    // Clear toàn bộ Cache
    var cache = CacheService.getScriptCache();
    Object.keys(CONFIG.SHEETS).forEach(function(key) {
       cache.remove("CACHE_SHEET_" + CONFIG.SHEETS[key]);
    });

    Logger.log("--- HOÀN TẤT DỌN DẸP " + count + " BẢNG ---");
    return "Hệ thống đã dọn dẹp sạch sẽ dữ liệu thử nghiệm tại " + count + " bảng bảng nghiệp vụ. Dữ liệu Khách hàng và Nhân sự vẫn được bảo toàn.";
  }
};
