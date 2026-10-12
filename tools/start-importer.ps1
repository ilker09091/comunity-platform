param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = (Get-Command python -ErrorAction Stop).Source
$env:PYTHONPATH = Join-Path $taskRoot '.tools\tiktok'
$taskPort = if ($env:IMPORTER_PORT) { $env:IMPORTER_PORT } else { '4317' }
$taskUrl = "http://localhost:$taskPort"
$taskScript = Join-Path $PSScriptRoot 'tiktok_importer.py'
$taskKeyFile = if($env:IMPORTER_SECRET_FILE){$env:IMPORTER_SECRET_FILE}else{Join-Path $taskRoot 'server\storage\importer-control\key'}

function Test-Importer {
    # Connect directly over IPv4; Windows PowerShell may wait on localhost IPv6.
    $taskCheck = @'
import json,sys,urllib.request,hashlib
from pathlib import Path
try:
    port=sys.argv[1]
    headers={'Host':'localhost:'+port,'X-Social-Client':'web'}
    keyfile=Path(sys.argv[3])
    if keyfile.is_file():headers['X-Importer-Key']=keyfile.read_text(encoding='utf-8').strip();headers['Host']='127.0.0.1:'+port
    req=urllib.request.Request('http://127.0.0.1:'+port+'/api/backend/importer/health',headers=headers)
    with urllib.request.urlopen(req,timeout=2) as response:
        data=json.load(response)
        expected=hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest()
        sys.exit(0 if data.get('ok') is True and 'admin-relay' in data.get('features',[]) and data.get('workerVersion')==expected else 1)
except Exception:
    sys.exit(1)
'@
    & $taskPython -c $taskCheck $taskPort $taskScript $taskKeyFile
    return $LASTEXITCODE -eq 0
}

if (-not (Test-Importer)) {
    # Upgrade an older instance of this exact tool; do not touch Circle or other Python apps.
    $taskScript = Join-Path $PSScriptRoot 'tiktok_importer.py'
    $taskOldProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'python.exe' -and $_.CommandLine -and $_.CommandLine.Contains($taskScript) -and
        $_.CommandLine -notmatch '--(explore|personal-collect|tiktok-login)'
    }
    foreach ($taskOldProcess in $taskOldProcesses) { Stop-Process -Id $taskOldProcess.ProcessId -Force }
    & $taskPython -c "import importlib.util, sys; sys.exit(0 if all(importlib.util.find_spec(name) for name in ['yt_dlp','curl_cffi','playwright']) else 1)"
    if ($LASTEXITCODE -ne 0) {
        & $taskPython -m pip install --target (Join-Path $taskRoot '.tools\tiktok') 'yt-dlp==2026.8.19' 'curl-cffi==0.16.3' 'playwright==1.63.0'
        if ($LASTEXITCODE -ne 0) { throw 'Video downloader dependencies could not be installed.' }
    }
    $taskScript = Join-Path $PSScriptRoot 'tiktok_importer.py'
    Start-Process -FilePath $taskPython -ArgumentList ('"' + $taskScript + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
        if (Test-Importer) { $taskReady = $true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $taskReady) { throw 'Fiktok worker could not start. Port 4317 may belong to a different project copy. Check the port owner and run tools/start-importer.ps1 from the current Circle project.' }
}
if (-not $NoBrowser) { Start-Process $taskUrl }
