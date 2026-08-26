@echo off
chcp 65001 >nul
title DeepSeek Harness 桌面客户端
cd /d "%~dp0"

REM 检查 node
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未检测到 Node.js。请先安装 Node.js 18+。
  pause
  exit /b 1
)

REM 首次运行自动安装依赖
if not exist "node_modules" (
  echo [提示] 首次运行, 正在安装依赖(需要网络, 请稍候)...
  call npm install
  if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败。请检查网络或手动执行 npm install。
    pause
    exit /b 1
  )
)

echo [提示] 启动桌面客户端(DASH Web 界面 + 工具调用补丁)...
call npm start
pause
