param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$FallbackExecutablePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][long]$ExpectedBytes,
    [Parameter(Mandatory = $true)][string]$InstallerArgsBase64,
    [Parameter(Mandatory = $true)][string]$SuccessArgsBase64,
    [Parameter(Mandatory = $true)][string]$FailureArgsBase64,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

function Write-KiwiUpdateLog([string]$Message) {
    try {
        $directory = [IO.Path]::GetDirectoryName($LogPath)
        if ($directory) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
        [IO.File]::AppendAllText($LogPath, "$(Get-Date -Format o) $Message`r`n", [Text.Encoding]::UTF8)
    } catch { }
}

function Get-KiwiSha256([string]$PathValue) {
    $stream = [IO.FileStream]::new($PathValue, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        } finally {
            $algorithm.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function ConvertTo-KiwiCommandLineArgument {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) { $Value = '' }
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }

    $quoted = [Text.StringBuilder]::new()
    [void]$quoted.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            [void]$quoted.Append(('\' * (($backslashes * 2) + 1)))
            [void]$quoted.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$quoted.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$quoted.Append($character)
    }
    if ($backslashes -gt 0) { [void]$quoted.Append(('\' * ($backslashes * 2))) }
    [void]$quoted.Append('"')
    return $quoted.ToString()
}

function Join-KiwiCommandLine([object[]]$Arguments) {
    $quoted = @($Arguments | ForEach-Object { ConvertTo-KiwiCommandLineArgument ([string]$_) })
    return [string]::Join(' ', $quoted)
}

function Start-KiwiProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [object[]]$Arguments,
        [switch]$Wait
    )

    $parameters = @{
        FilePath = $ExecutablePath
        WorkingDirectory = [IO.Path]::GetDirectoryName($ExecutablePath)
        PassThru = $true
    }
    if ($Arguments.Count -gt 0) { $parameters.ArgumentList = Join-KiwiCommandLine $Arguments }
    if ($Wait) { $parameters.Wait = $true }
    return Start-Process @parameters
}

function Read-KiwiArguments([string]$Encoded) {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Encoded))
    return @((ConvertFrom-Json -InputObject $json))
}

function Assert-KiwiInstaller {
    if (-not [IO.File]::Exists($InstallerPath)) { throw "Der verifizierte Setup-Installer fehlt." }
    $file = [IO.FileInfo]::new($InstallerPath)
    if ($file.Length -ne $ExpectedBytes) { throw "Die Größe des Setup-Installers stimmt nicht." }
    $hash = Get-KiwiSha256 $InstallerPath
    if ($hash -ne $ExpectedSha256.ToLowerInvariant()) { throw "Die SHA-256-Prüfsumme des Setup-Installers stimmt nicht." }
}

function Start-KiwiFallback([string[]]$Arguments, [string]$Reason) {
    if ($NoLaunch) { return }
    if (-not [IO.File]::Exists($FallbackExecutablePath)) {
        throw "Kiwi konnte nicht automatisch wieder geöffnet werden: EXE fehlt."
    }
    [void](Start-KiwiProcess -ExecutablePath $FallbackExecutablePath -Arguments $Arguments)
    Write-KiwiUpdateLog $Reason
}

try {
    Assert-KiwiInstaller
    if (-not [IO.File]::Exists($FallbackExecutablePath)) { throw "Die bisherige Kiwi-EXE fehlt." }
    $installerArguments = Read-KiwiArguments $InstallerArgsBase64
    $successArguments = Read-KiwiArguments $SuccessArgsBase64
    Write-KiwiUpdateLog "Setup-Update wird gestartet."
    $installer = Start-KiwiProcess -ExecutablePath $InstallerPath -Arguments $installerArguments -Wait
    if ($installer.ExitCode -ne 0) { throw "Der Setup-Installer wurde mit Code $($installer.ExitCode) beendet." }

    # NSIS receives --force-run as well. Starting once more is intentional:
    # Kiwi's single-instance lock turns this into a harmless focus request if
    # NSIS already relaunched it, and guarantees a relaunch if NSIS did not.
    Start-KiwiFallback $successArguments "Setup-Update erfolgreich installiert; Kiwi wurde automatisch wieder geöffnet."
    exit 0
} catch {
    Write-KiwiUpdateLog "Setup-Update fehlgeschlagen: $($_.Exception.Message)"
    try {
        $failureArguments = Read-KiwiArguments $FailureArgsBase64
        Start-KiwiFallback $failureArguments "Die bisherige Kiwi-Version wurde nach dem Updatefehler automatisch wieder geöffnet."
    } catch {
        Write-KiwiUpdateLog "Fallback-Start fehlgeschlagen: $($_.Exception.Message)"
    }
    exit 1
}
