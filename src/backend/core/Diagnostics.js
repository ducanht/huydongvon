// ==========================================
// DIAGNOSTICS.GS - Chẩn Đoán & Rà Soát Dữ Liệu
// ==========================================

function diagnoseSheetStructure() {
  const SCHEMAS = {
    "DB_NHANSU": ["MaNV", "HoTen", "Email", "Sdt", "Role", "TrangThai", "MatKhau"],
    "DB_KHACHHANG": ["MaKH", "HoTen", "CCCD", "DiaChi", "Sdt", "SoTheTV", "NgayTao", "TrangThai"],
    "DB_CHIENDICH": ["MaCD", "TenCD", "LoaiCD", "NgayBatDau", "NgayKetThuc", "TrangThai"],
    "DB_CHITIEU": ["MaCD", "MaNV", "ChiTieu", "NgayPhanBo", "NguoiPhanBo"],
    "DB_SOTIETKIEM": ["SoSo", "MaKH", "MaNV", "MaCD", "NgayPhatHanh", "NgayDaoHan", "SoDuBanDau", "SoDuHienTai", "KyHan", "TrangThai"],
    "DB_GIAODICH": ["MaGD", "MaNV", "MaKH", "MaCD", "SoSo", "LoaiGD", "SoTien", "NgayGD", "TrangThai", "GhiChu", "DuyetBoi", "NgayDuyet"],
    "DB_SUMMARY": ["MaNV", "MaCD", "TongGui", "TongRut", "Net", "ChiTieu", "LastUpdate"]
  };

  const ss = getDbSpreadsheet();
  if (!ss) {
    return { status: "error", message: "Không tìm thấy Spreadsheet CSDL." };
  }

  const result = {};
  for (const sheetName in SCHEMAS) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      result[sheetName] = { status: "MISSING", message: "Sheet chưa được tạo" };
      continue;
    }
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      result[sheetName] = { status: "EMPTY", message: "Sheet rỗng không có header" };
      continue;
    }
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const expected = SCHEMAS[sheetName];
    const missing = expected.filter(col => !headers.includes(col));
    const extra = headers.filter(col => !expected.includes(col));
    
    result[sheetName] = {
      status: missing.length === 0 ? "OK" : "INCOMPLETE",
      missing: missing,
      extra: extra,
      actualHeaders: headers,
      totalRows: Math.max(0, sheet.getLastRow() - 1)
    };
  }

  return result;
}

/**
 * Rà Soát Toàn Diện Tính Toàn Vẹn & Khớp Số Liệu Cơ Sở Dữ Liệu
 */
function auditDatabaseIntegrity() {
  const ss = getDbSpreadsheet();
  if (!ss) throw new Error("Không thể kết nối Spreadsheet Database.");

  const structure = diagnoseSheetStructure();
  
  // 1. Nạp toàn bộ dữ liệu sạch
  const nhanSu = Repository.getAll(CONFIG.SHEETS.NHANSU, false);
  const chienDich = Repository.getAll(CONFIG.SHEETS.CHIENDICH, false);
  const chiTieu = Repository.getAll(CONFIG.SHEETS.CHITIEU, false);
  const khachHang = Repository.getAll(CONFIG.SHEETS.KHACHHANG, false);
  const soTietKiem = Repository.getAll(CONFIG.SHEETS.SOTIETKIEM, false);
  const giaoDich = Repository.getAll(CONFIG.SHEETS.GIAODICH, false);
  const summary = Repository.getAll(CONFIG.SHEETS.SUMMARY, false);

  const issues = [];
  const warnings = [];
  const stats = {
    nhanSuCount: nhanSu.length,
    chienDichCount: chienDich.length,
    chiTieuCount: chiTieu.length,
    khachHangCount: khachHang.length,
    soTietKiemCount: soTietKiem.length,
    giaoDichCount: giaoDich.length,
    summaryCount: summary.length
  };

  // Map khóa chính
  const nsMap = {};
  nhanSu.forEach(ns => {
    const ma = ValidatorService.normalizeId(ns.MaNV);
    if (!ma) issues.push(`[DB_NHANSU dòng ${ns._rowIndex}] MaNV bị rỗng.`);
    else if (nsMap[ma]) issues.push(`[DB_NHANSU dòng ${ns._rowIndex}] Trùng MaNV: ${ma}`);
    else nsMap[ma] = ns;
  });

  const cdMap = {};
  chienDich.forEach(cd => {
    const ma = ValidatorService.normalizeId(cd.MaCD);
    if (!ma) issues.push(`[DB_CHIENDICH dòng ${cd._rowIndex}] MaCD bị rỗng.`);
    else if (cdMap[ma]) issues.push(`[DB_CHIENDICH dòng ${cd._rowIndex}] Trùng MaCD: ${ma}`);
    else cdMap[ma] = cd;
  });

  const khMap = {};
  khachHang.forEach(kh => {
    const ma = ValidatorService.normalizeId(kh.MaKH);
    if (!ma) issues.push(`[DB_KHACHHANG dòng ${kh._rowIndex}] MaKH bị rỗng.`);
    else if (khMap[ma]) issues.push(`[DB_KHACHHANG dòng ${kh._rowIndex}] Trùng MaKH: ${ma}`);
    else khMap[ma] = kh;
  });

  const stkMap = {};
  soTietKiem.forEach(stk => {
    const so = String(stk.SoSo || '').trim();
    if (!so) issues.push(`[DB_SOTIETKIEM dòng ${stk._rowIndex}] SoSo bị rỗng.`);
    else if (stkMap[so]) issues.push(`[DB_SOTIETKIEM dòng ${stk._rowIndex}] Trùng Số Sổ: ${so}`);
    else stkMap[so] = stk;
  });

  // Rà soát Chi Tiêu
  chiTieu.forEach(ct => {
    const maCD = ValidatorService.normalizeId(ct.MaCD);
    const maNV = ValidatorService.normalizeId(ct.MaNV);
    if (maCD && !cdMap[maCD]) warnings.push(`[DB_CHITIEU dòng ${ct._rowIndex}] MaCD "${maCD}" không tồn tại trong DB_CHIENDICH.`);
    if (maNV && !nsMap[maNV]) warnings.push(`[DB_CHITIEU dòng ${ct._rowIndex}] MaNV "${maNV}" không tồn tại trong DB_NHANSU.`);
  });

  // Rà soát Giao Dịch & Nhóm để đối soát
  const bookTxMap = {}; // SoSo -> { gui: 0, rut: 0, count: 0 }
  const campaignTellerTxMap = {}; // "MaCD_MaNV" -> { tongGui: 0, tongRut: 0, net: 0 }

  giaoDich.forEach(gd => {
    const maGD = ValidatorService.normalizeId(gd.MaGD);
    const soSo = String(gd.SoSo || '').trim();
    const maKH = ValidatorService.normalizeId(gd.MaKH);
    const maNV = ValidatorService.normalizeId(gd.MaNV);
    const maCD = ValidatorService.normalizeId(gd.MaCD);
    const soTien = parseFloat(gd.SoTien || 0);
    const trangThai = String(gd.TrangThai || '').toUpperCase().trim();
    const loaiGD = String(gd.LoaiGD || '').toUpperCase().trim();

    if (!soSo) issues.push(`[DB_GIAODICH dòng ${gd._rowIndex}] GD ${maGD} thiếu Số sổ.`);
    if (soTien <= 0) issues.push(`[DB_GIAODICH dòng ${gd._rowIndex}] GD ${maGD} Số tiền <= 0: ${gd.SoTien}`);
    if (maKH && !khMap[maKH]) warnings.push(`[DB_GIAODICH dòng ${gd._rowIndex}] MaKH "${maKH}" không tồn tại trong DB_KHACHHANG.`);
    if (maNV && !nsMap[maNV]) warnings.push(`[DB_GIAODICH dòng ${gd._rowIndex}] MaNV "${maNV}" không tồn tại trong DB_NHANSU.`);

    if (trangThai === 'ACTIVE') {
      if (!bookTxMap[soSo]) bookTxMap[soSo] = { gui: 0, rut: 0, count: 0 };
      bookTxMap[soSo].count++;
      if (loaiGD === 'GỬI' || loaiGD === 'GUI') {
        bookTxMap[soSo].gui += soTien;
      } else if (loaiGD === 'RÚT' || loaiGD === 'RUT') {
        bookTxMap[soSo].rut += soTien;
      }

      if (maCD && maNV) {
        const key = maCD + "_" + maNV;
        if (!campaignTellerTxMap[key]) {
          campaignTellerTxMap[key] = { tongGui: 0, tongRut: 0, net: 0 };
        }
        if (loaiGD === 'GỬI' || loaiGD === 'GUI') {
          campaignTellerTxMap[key].tongGui += soTien;
          campaignTellerTxMap[key].net += soTien;
        } else if (loaiGD === 'RÚT' || loaiGD === 'RUT') {
          campaignTellerTxMap[key].tongRut += soTien;
          campaignTellerTxMap[key].net -= soTien;
        }
      }
    }
  });

  // 1. ĐỐI SOÁT SỐ DƯ SỔ TIẾT KIỆM
  let balanceMismatchCount = 0;
  soTietKiem.forEach(stk => {
    const soSo = String(stk.SoSo || '').trim();
    const soDuSheet = parseFloat(stk.SoDuHienTai || 0);
    const tx = bookTxMap[soSo] || { gui: 0, rut: 0 };
    const soDuTinh = tx.gui - tx.rut;

    if (Math.abs(soDuSheet - soDuTinh) > 1) {
      balanceMismatchCount++;
      issues.push(`[LỆCH SỐ DƯ SỔ ${soSo}] Trên Sheet: ${soDuSheet.toLocaleString('vi-VN')} đ | Lịch sử GD: ${soDuTinh.toLocaleString('vi-VN')} đ (Gửi: ${tx.gui.toLocaleString('vi-VN')} - Rút: ${tx.rut.toLocaleString('vi-VN')})`);
    }
  });

  // 2. ĐỐI SOÁT DB_SUMMARY
  let summaryMismatchCount = 0;
  summary.forEach(sm => {
    const maCD = ValidatorService.normalizeId(sm.MaCD);
    const maNV = ValidatorService.normalizeId(sm.MaNV);
    const key = maCD + "_" + maNV;
    const sheetNet = parseFloat(sm.Net || 0);
    const actual = campaignTellerTxMap[key] || { tongGui: 0, tongRut: 0, net: 0 };

    if (Math.abs(sheetNet - actual.net) > 1) {
      summaryMismatchCount++;
      warnings.push(`[LỆCH SUMMARY CD ${maCD} - NV ${maNV}] Trên Sheet Net: ${sheetNet.toLocaleString('vi-VN')} đ | Lịch sử GD Net: ${actual.net.toLocaleString('vi-VN')} đ`);
    }
  });

  return {
    status: issues.length === 0 ? "PASSED" : "FAILED",
    structure: structure,
    stats: stats,
    balanceMismatchCount: balanceMismatchCount,
    summaryMismatchCount: summaryMismatchCount,
    issues: issues,
    warnings: warnings,
    summaryText: issues.length === 0 
      ? `✅ Toàn bộ CSDL hoàn toàn chính xác! 100% ${soTietKiem.length} sổ tiết kiệm khớp số dư với lịch sử giao dịch.`
      : `⚠️ Phát hiện ${issues.length} vấn đề cần lưu ý xử lý.`
  };
}
