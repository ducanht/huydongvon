/**
 * Script này dùng để tạo dữ liệu giả lập quy mô lớn (Stress Test)
 * Chỉ chạy khi cần kiểm thử hiệu năng.
 */
function dev_generateStressTestData() {
  var NUM_CUSTOMERS = 100;
  var NUM_TRANSACTIONS = 500;
  
  console.log("--- BẮT ĐẦU TẠO DỮ LIỆU GIẢ LẬP ---");
  
  // 1. Tạo Khách hàng
  var customers = [];
  for (var i = 1; i <= NUM_CUSTOMERS; i++) {
    var cccd = "034" + String(100000000 + i).substring(1);
    customers.push({
      MaKH: "KH_STRESS_" + i,
      HoTen: "Khách Hàng Stress Test " + i,
      CCCD: cccd,
      DiaChi: "Yên Thọ, Đông Triều, Quảng Ninh",
      Sdt: "090" + String(10000000 + i).substring(1),
      NgayTao: new Date()
    });
  }
  
  // Ghi batch vào DB_KHACHHANG
  // Lưu ý: Repository.insert hiện tại không hỗ trợ batch insert, ta sẽ dùng trực tiếp sheet để nhanh
  var ss = getDbSpreadsheet();
  var sheetKH = ss.getSheetByName(CONFIG.SHEETS.KHACHHANG);
  var khHeaders = sheetKH.getRange(1, 1, 1, sheetKH.getLastColumn()).getValues()[0];
  var khData = customers.map(function(c) {
    return khHeaders.map(function(h) { return c[h] || ""; });
  });
  sheetKH.getRange(sheetKH.getLastColumn() + 1, 1, khData.length, khHeaders.length).setValues(khData);
  Repository.clearCache(CONFIG.SHEETS.KHACHHANG);
  console.log("Đã tạo " + NUM_CUSTOMERS + " khách hàng.");

  // 2. Tạo Giao dịch & Sổ tiết kiệm (Dạng ACTIVE luôn để test Dashboard)
  var transactions = [];
  var passbooks = [];
  var staffList = Repository.getAll(CONFIG.SHEETS.NHANSU);
  var campaigns = Repository.getAll(CONFIG.SHEETS.CHIENDICH);
  
  if (staffList.length === 0 || campaigns.length === 0) {
    throw new Error("Cần có dữ liệu Nhân sự và Chiến dịch trước khi chạy stress test.");
  }

  for (var j = 1; j <= NUM_TRANSACTIONS; j++) {
    var staff = staffList[j % staffList.length];
    var camp = campaigns[j % campaigns.length];
    var cust = customers[j % customers.length];
    var amount = 10000000 + (Math.random() * 50000000); // 10tr - 60tr
    amount = Math.floor(amount / 1000) * 1000;
    
    var maGD = "GD_STRESS_" + j;
    var soSo = "SO_STRESS_" + j;
    var now = new Date();
    
    // Giao dịch
    transactions.push({
      MaGD: maGD,
      MaNV: staff.MaNV,
      MaKH: cust.MaKH,
      MaCD: camp.MaCD,
      SoSo: soSo,
      LoaiGD: "GUI",
      SoTien: amount,
      NgayGD: now,
      TrangThai: "ACTIVE",
      DuyetBoi: "ADMIN",
      NgayDuyet: now,
      GhiChu: "Stress Test Data"
    });
    
    // Sổ tiết kiệm
    passbooks.push({
      SoSo: soSo,
      MaKH: cust.MaKH,
      MaNV: staff.MaNV,
      MaCD: camp.MaCD,
      NgayPhatHanh: now,
      SoDuBanDau: amount,
      SoDuHienTai: amount,
      KyHan: "12TH",
      LoaiSanh: "BT",
      TrangThai: "ACTIVE",
      LaiSuat: 6.5,
      LoaiLai: "Standard"
    });
  }

  // Ghi Giao dịch
  var sheetGD = ss.getSheetByName(CONFIG.SHEETS.GIAODICH);
  var gdHeaders = sheetGD.getRange(1, 1, 1, sheetGD.getLastColumn()).getValues()[0];
  var gdRows = transactions.map(function(t) {
    return gdHeaders.map(function(h) { return t[h] || ""; });
  });
  sheetGD.getRange(sheetGD.getLastRow() + 1, 1, gdRows.length, gdHeaders.length).setValues(gdRows);
  Repository.clearCache(CONFIG.SHEETS.GIAODICH);

  // Ghi Sổ tiết kiệm
  var sheetSTK = ss.getSheetByName(CONFIG.SHEETS.SOTIETKIEM);
  var stkHeaders = sheetSTK.getRange(1, 1, 1, sheetSTK.getLastColumn()).getValues()[0];
  var stkRows = passbooks.map(function(p) {
    return stkHeaders.map(function(h) { return p[h] || ""; });
  });
  sheetSTK.getRange(sheetSTK.getLastRow() + 1, 1, stkRows.length, stkHeaders.length).setValues(stkRows);
  Repository.clearCache(CONFIG.SHEETS.SOTIETKIEM);

  console.log("Đã tạo " + NUM_TRANSACTIONS + " giao dịch và sổ tiết kiệm.");
  
  // 3. Cập nhật KPI Summary cho toàn bộ nhân sự
  console.log("Đang recalculate KPI Summary cho toàn bộ nhân sự...");
  staffList.forEach(function(s) {
    campaigns.forEach(function(c) {
      KPIService.updateSummary(s.MaNV, c.MaCD);
    });
  });
  
  console.log("--- HOÀN TẤT STRESS TEST DATA ---");
}
