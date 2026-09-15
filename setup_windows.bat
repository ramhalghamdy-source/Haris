@echo off
cd /d "%~dp0"
echo Installing HARIS Python requirements...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Setup failed. Check Python and internet connection, then try again.
  pause
  exit /b 1
)
echo.
echo HARIS setup completed. You can now run start_haris.bat.
echo After this setup, the HARIS demo itself can run locally without internet.
pause
