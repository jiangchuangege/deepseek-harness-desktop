# 一键安装本客户端注册表里启用的插件/技能(GitHub 上的 DSH 插件走 dsh plugin add)
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1
param([string]$Profile = "web")

$reg = Get-Content -Raw -Encoding UTF8 "$PSScriptRoot\..\config\plugins.json" | ConvertFrom-Json

Write-Host "=== 安装启用的插件/技能(profile: $Profile) ===" -ForegroundColor Cyan
foreach ($bundle in @($reg.plugins, $reg.skills)) {
  foreach ($p in $bundle) {
    if ($p.enabled -and $p.source -match "^(github\.com|https?://|npm:)") {
      $pkg = $p.source -replace "^github\.com/", "github:" -replace "^(https?://)", ""
      Write-Host "  安装: $($p.name) -> $pkg"
      & dsh plugin --profile $Profile add $pkg
    }
  }
}
Write-Host ""
Write-Host "内置补丁(工具调用代理)与内置技能由客户端启动时提供, 无需安装。" -ForegroundColor Yellow
Write-Host "其它第三方 MCP/GitHub 插件: 在客户端窗口内点【安装插件】, 或手动 dsh plugin add <包>。" -ForegroundColor Yellow
