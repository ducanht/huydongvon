# PowerShell Script Đẩy Mã Nguồn Google Apps Script & Deploy Live
# Dự án: HuyDongVon - QTDND Yên Thọ

param (
    [string]$ScriptId = "",
    [string]$DeploymentId = "AKfycbz20Oi5KUwMgTq0BlLn5IIYP2t03oYcO9xDcXusp3QGzVIj2N0I5JXNlCj2aYRC7L5n"
)

Write-Host "=== [1/3] Build Dự Án HuyDongVon ===" -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Lỗi Build! Dừng tiến trình." -ForegroundColor Red
    exit 1
}

# Kiểm tra Script ID
if (-not $ScriptId) {
    if (Test-Path ".clasp.json") {
        $claspJson = Get-Content ".clasp.json" | ConvertFrom-Json
        $ScriptId = $claspJson.scriptId
    }
}

if (-not $ScriptId) {
    Write-Host "`n⚠️ CHƯA CÓ SCRIPT ID CHO GOOGLE APPS SCRIPT!" -ForegroundColor Yellow
    Write-Host "Vui lòng chạy kèm tham số ScriptId, ví dụ:" -ForegroundColor Yellow
    Write-Host ".\gas_sync.ps1 -ScriptId <MA_SCRIPT_ID_CUA_BAN>" -ForegroundColor White
    exit 1
}

Write-Host "=== [2/3] Thiết lập cấu hình Clasp cho dist/ ($ScriptId) ===" -ForegroundColor Cyan
Set-Content -Path ".clasp.json" -Value "{`"scriptId`": `"$ScriptId`", `"rootDir`": `"dist`"}" -Encoding UTF8

Write-Host "=== [3/3] Push mã nguồn lên Google Apps Script ===" -ForegroundColor Cyan
npx @google/clasp push -f

if ($DeploymentId) {
    Write-Host "=== [4/4] Redeploy phiên bản Web App mới ===" -ForegroundColor Green
    npx @google/clasp deploy -i $DeploymentId -d "Auto-Deploy HuyDongVon Phase 1-3"
}

Write-Host "`n✅ HOÀN TẤT ĐỒNG BỘ VÀ DEPLOY GOOGLE APPS SCRIPT!" -ForegroundColor Green
