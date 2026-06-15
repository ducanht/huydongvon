function diagnoseSheetStructure() {
  const SCHEMAS = {
    "DB_NHANSU": ["MaNV", "HoTen", "Email", "Sdt", "Role", "TrangThai", "MatKhau"],
    "DB_KHACHHANG": ["MaKH", "HoTen", "CCCD", "DiaChi", "Sdt", "SoTheTV", "NgayTao", "TrangThai"],
    "DB_CHIENDICH": ["MaCD", "TenCD", "LoaiCD", "NgayBatDau", "NgayKetThuc", "TrangThai"],
    "DB_CHITIEU": ["MaCD", "MaNV", "ChiTieu", "NgayPhanBo", "NguoiPhanBo"],
    "DB_SOTIETKIEM": ["SoSo", "MaKH", "MaNV", "MaCD", "NgayPhatHanh", "NgayDaoHan", "SoDuBanDau", "SoDuHienTai", "KyHan", "LoaiSanh", "TrangThai"],
    "DB_GIAODICH": ["MaGD", "MaNV", "MaKH", "MaCD", "SoSo", "LoaiGD", "SoTien", "NgayGD", "TrangThai", "GhiChu", "DuyetBoi", "NgayDuyet"],
    "DB_SUMMARY": ["MaNV", "MaCD", "TongGui", "TongRut", "Net", "ChiTieu", "LastUpdate"]
  };

  const ss = getDbSpreadsheet();
  if (!ss) {
    Logger.log("ERROR: Spreadsheet not found.");
    return;
  }

  const result = {};
  for (const sheetName in SCHEMAS) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      result[sheetName] = "MISSING";
      continue;
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const expected = SCHEMAS[sheetName];
    const missing = expected.filter(col => !headers.includes(col));
    const extra = headers.filter(col => !expected.includes(col));
    
    result[sheetName] = {
      status: missing.length === 0 ? "OK" : "INCOMPLETE",
      missing: missing,
      extra: extra,
      actualHeaders: headers
    };
  }

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
