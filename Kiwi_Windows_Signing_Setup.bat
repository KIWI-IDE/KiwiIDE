@echo off
setlocal
chcp 65001 >nul
title Kiwi IDE - Windows Signing Setup

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo PowerShell wurde nicht gefunden.
    echo Diese Datei benoetigt Windows PowerShell.
    pause
    exit /b 1
)

set "KIWI_SETUP_FILE=%~f0"
set "KIWI_SIGN_TARGET=%~1"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$content = Get-Content -LiteralPath $env:KIWI_SETUP_FILE; $marker = [Array]::IndexOf($content, '# KIWI_POWERSHELL_START'); if ($marker -lt 0) { throw 'PowerShell-Teil wurde nicht gefunden.' }; $script = $content[($marker + 1)..($content.Length - 1)] -join [Environment]::NewLine; & ([ScriptBlock]::Create($script))"
set "KIWI_EXIT_CODE=%ERRORLEVEL%"

set "KIWI_SIGN_TARGET="
set "KIWI_SETUP_FILE="

echo.
if not "%KIWI_EXIT_CODE%"=="0" (
    echo Die Einrichtung wurde mit einem Fehler beendet.
)
pause
exit /b %KIWI_EXIT_CODE%

# KIWI_POWERSHELL_START
$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Read-PlainPassword([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

try {
    Write-Host "============================================" -ForegroundColor Green
    Write-Host " Kiwi IDE - Windows Signing Setup" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green

    Write-Step "Microsoft SignTool suchen"

    $signTool = $null

    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) {
        $signTool = $command.Source
    }

    if (-not $signTool) {
        $roots = @(
            "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
            "$env:ProgramFiles\Windows Kits\10\bin"
        ) | Where-Object { $_ -and (Test-Path $_) }

        $candidates = foreach ($root in $roots) {
            Get-ChildItem -Path "$root\*\x64\signtool.exe" -File -ErrorAction SilentlyContinue
        }

        $signTool = $candidates |
            Sort-Object {
                try { [version]$_.Directory.Parent.Name }
                catch { [version]'0.0.0.0' }
            } -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }

    if (-not $signTool -or -not (Test-Path $signTool)) {
        throw @"
SignTool wurde nicht gefunden.

Installiere im Visual Studio Installer:
  Einzelne Komponenten -> Windows 10 SDK oder Windows 11 SDK

Starte danach diese BAT-Datei erneut.
"@
    }

    Write-Host "Gefunden: $signTool" -ForegroundColor Green

    Write-Step "Zertifikatsordner vorbereiten"

    $signingDir = Join-Path $env:USERPROFILE 'KiwiSigning'
    $pfxPath = Join-Path $signingDir 'kiwi-code-signing.pfx'
    New-Item -ItemType Directory -Path $signingDir -Force | Out-Null

    $useExisting = $false

    if (Test-Path $pfxPath) {
        Write-Host "Vorhandenes Zertifikat gefunden:" -ForegroundColor Yellow
        Write-Host $pfxPath

        $answer = Read-Host "Vorhandenes Zertifikat verwenden? [J/n]"
        $useExisting = [string]::IsNullOrWhiteSpace($answer) -or $answer -match '^[JjYy]'
    }

    if ($useExisting) {
        Write-Step "Vorhandenes Zertifikat prüfen"

        while ($true) {
            $password = Read-PlainPassword "Passwort der vorhandenen PFX-Datei"
            try {
                $check = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
                    $pfxPath,
                    $password
                )
                if (-not $check.HasPrivateKey) {
                    throw "Die PFX-Datei enthält keinen privaten Schlüssel."
                }
                $check.Reset()
                break
            }
            catch {
                Write-Host "Passwort falsch oder PFX-Datei ungültig. Erneut versuchen." -ForegroundColor Red
            }
        }
    }
    else {
        Write-Step "Neues selbstsigniertes Kiwi-Zertifikat erstellen"

        do {
            $password = Read-PlainPassword "Neues Passwort für die PFX-Datei"
            $passwordConfirm = Read-PlainPassword "Passwort wiederholen"

            if ([string]::IsNullOrWhiteSpace($password)) {
                Write-Host "Das Passwort darf nicht leer sein." -ForegroundColor Red
                $match = $false
            }
            elseif ($password -ne $passwordConfirm) {
                Write-Host "Die Passwörter stimmen nicht überein." -ForegroundColor Red
                $match = $false
            }
            else {
                $match = $true
            }
        } until ($match)

        if (Test-Path $pfxPath) {
            $backup = Join-Path $signingDir (
                "kiwi-code-signing-backup-{0}.pfx" -f (Get-Date -Format 'yyyyMMdd-HHmmss')
            )
            Move-Item $pfxPath $backup -Force
            Write-Host "Alte PFX gesichert: $backup" -ForegroundColor Yellow
        }

        $cert = New-SelfSignedCertificate `
            -Type CodeSigningCert `
            -Subject 'CN=Kiwi IDE' `
            -FriendlyName 'Kiwi IDE Code Signing' `
            -CertStoreLocation 'Cert:\CurrentUser\My' `
            -KeyAlgorithm RSA `
            -KeyLength 3072 `
            -HashAlgorithm SHA256 `
            -KeyExportPolicy Exportable `
            -NotAfter (Get-Date).AddYears(3)

        $securePassword = ConvertTo-SecureString $password -AsPlainText -Force

        Export-PfxCertificate `
            -Cert $cert `
            -FilePath $pfxPath `
            -Password $securePassword `
            -Force | Out-Null

        Write-Host "Zertifikat erstellt: $pfxPath" -ForegroundColor Green
    }

    Write-Step "Kiwi-Umgebungsvariablen dauerhaft setzen"

    [Environment]::SetEnvironmentVariable(
        'KIWI_WINDOWS_CERT_PFX',
        $pfxPath,
        'User'
    )

    [Environment]::SetEnvironmentVariable(
        'KIWI_WINDOWS_CERT_PASSWORD',
        $password,
        'User'
    )

    [Environment]::SetEnvironmentVariable(
        'KIWI_SIGNTOOL_PATH',
        $signTool,
        'User'
    )

    $env:KIWI_WINDOWS_CERT_PFX = $pfxPath
    $env:KIWI_WINDOWS_CERT_PASSWORD = $password
    $env:KIWI_SIGNTOOL_PATH = $signTool

    Write-Host "KIWI_WINDOWS_CERT_PFX gesetzt." -ForegroundColor Green
    Write-Host "KIWI_WINDOWS_CERT_PASSWORD gesetzt." -ForegroundColor Green
    Write-Host "KIWI_SIGNTOOL_PATH gesetzt." -ForegroundColor Green

    Write-Host ""
    Write-Host "Hinweis: Das Passwort wird als Benutzer-Umgebungsvariable gespeichert." -ForegroundColor Yellow
    Write-Host "Teile die PFX-Datei und das Passwort niemals öffentlich." -ForegroundColor Yellow

    $target = $env:KIWI_SIGN_TARGET
    if ($target) {
        Write-Step "Übergebene Datei signieren"

        $target = $target.Trim('"')

        if (-not (Test-Path $target -PathType Leaf)) {
            throw "Die zu signierende Datei wurde nicht gefunden: $target"
        }

        & $signTool sign `
            /f $pfxPath `
            /p $password `
            /fd SHA256 `
            $target

        if ($LASTEXITCODE -ne 0) {
            throw "SignTool konnte die Datei nicht signieren."
        }

        & $signTool verify /pa /v $target

        if ($LASTEXITCODE -ne 0) {
            throw "Die Signaturprüfung ist fehlgeschlagen."
        }

        Write-Host "Datei erfolgreich signiert: $target" -ForegroundColor Green
    }
    else {
        Write-Host ""
        Write-Host "Tipp: Ziehe eine EXE-, DLL- oder MSI-Datei auf diese BAT-Datei," -ForegroundColor Cyan
        Write-Host "um sie nach dem Setup direkt zu signieren." -ForegroundColor Cyan
    }

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host " Einrichtung erfolgreich abgeschlossen" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Starte Kiwi IDE und geöffnete Terminals neu," -ForegroundColor White
    Write-Host "damit sie die neuen Variablen übernehmen." -ForegroundColor White

    exit 0
}
catch {
    Write-Host ""
    Write-Host "FEHLER:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
finally {
    if ($password) { $password = $null }
    if ($passwordConfirm) { $passwordConfirm = $null }
}
