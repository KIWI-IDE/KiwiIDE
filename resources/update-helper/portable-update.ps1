param(
    [Parameter(Mandatory = $true)][string]$StagedPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][long]$ExpectedBytes,
    [Parameter(Mandatory = $true)][string]$RelaunchArgsBase64,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$backupPath = "$TargetPath.kiwi-backup"
$deadline = [DateTime]::UtcNow.AddSeconds(120)

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

    # Start-Process joins ArgumentList values with spaces before passing them
    # to CreateProcess. Quote each value according to CommandLineToArgvW so
    # paths with spaces, embedded quotes and trailing backslashes survive.
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

function Start-KiwiProcess([string]$ExecutablePath, [object[]]$Arguments) {
    $parameters = @{
        FilePath = $ExecutablePath
        WorkingDirectory = [IO.Path]::GetDirectoryName($ExecutablePath)
    }
    if ($Arguments.Count -gt 0) { $parameters.ArgumentList = Join-KiwiCommandLine $Arguments }
    Start-Process @parameters
}

function Assert-KiwiFile([string]$PathValue) {
    if (-not [IO.File]::Exists($PathValue)) { throw "Datei fehlt: $PathValue" }
    $file = [IO.FileInfo]::new($PathValue)
    if ($file.Length -ne $ExpectedBytes) { throw "Dateigröße stimmt nicht: $($file.Length) statt $ExpectedBytes." }
    $hash = Get-KiwiSha256 $PathValue
    if ($hash -ne $ExpectedSha256.ToLowerInvariant()) { throw "SHA-256-Prüfsumme stimmt nicht." }
}

function Move-KiwiReplacement {
    [IO.File]::Move($TargetPath, $backupPath)
    try {
        [IO.File]::Move($StagedPath, $TargetPath)
    } catch {
        if (-not [IO.File]::Exists($TargetPath) -and [IO.File]::Exists($backupPath)) {
            [IO.File]::Move($backupPath, $TargetPath)
        }
        throw
    }
}

function Restore-KiwiBackup {
    param(
        [Parameter(Mandatory = $true)][string]$ReplacementPath,
        [Parameter(Mandatory = $true)][string]$SavedPath,
        [switch]$ForceMove
    )

    if (-not [IO.File]::Exists($SavedPath)) { throw "Rollback-Datei fehlt: $SavedPath" }
    if (-not [IO.File]::Exists($ReplacementPath)) {
        [IO.File]::Move($SavedPath, $ReplacementPath)
        return
    }

    if (-not $ForceMove) {
        try {
            [IO.File]::Replace($SavedPath, $ReplacementPath, $null, $true)
            return
        } catch [System.NotSupportedException] {
            # FAT/exFAT and some network filesystems do not support Replace.
        } catch [IO.IOException] {
            # The same limitation is surfaced as ERROR_NOT_SUPPORTED on a
            # number of Windows filesystem drivers. Fall back to two moves.
        }
    }

    $failedReplacement = "$ReplacementPath.kiwi-failed-$([Guid]::NewGuid().ToString('N'))"
    [IO.File]::Move($ReplacementPath, $failedReplacement)
    try {
        [IO.File]::Move($SavedPath, $ReplacementPath)
    } catch {
        if (-not [IO.File]::Exists($ReplacementPath) -and [IO.File]::Exists($failedReplacement)) {
            [IO.File]::Move($failedReplacement, $ReplacementPath)
        }
        throw
    }
    try { [IO.File]::Delete($failedReplacement) } catch { }
}

function Start-KiwiAfterFailure {
    if ($NoLaunch -or -not [IO.File]::Exists($TargetPath)) { return }
    try {
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RelaunchArgsBase64))
        $arguments = @((ConvertFrom-Json -InputObject $decoded) | Where-Object { $_ -ne '--updated' })
        $arguments = @('--update-failed') + $arguments
        Start-KiwiProcess $TargetPath $arguments
        Write-KiwiUpdateLog "Die bisherige portable Kiwi-Version wurde automatisch wieder geöffnet."
    } catch {
        Write-KiwiUpdateLog "Kiwi konnte nach dem Updatefehler nicht automatisch wieder geöffnet werden: $($_.Exception.Message)"
    }
}

try {
    Write-KiwiUpdateLog "Portable Update wird vorbereitet."
    Assert-KiwiFile $StagedPath
    if (-not [IO.File]::Exists($TargetPath)) { throw "Die bisherige portable Kiwi-EXE fehlt." }
    if ([IO.File]::Exists($backupPath)) { [IO.File]::Delete($backupPath) }

    $replaced = $false
    while (-not $replaced) {
        try {
            # File.Replace is atomic and preserves the previous launcher as a
            # rollback file. It succeeds only after the outer portable NSIS
            # launcher has released its executable handle.
            [IO.File]::Replace($StagedPath, $TargetPath, $backupPath, $true)
            $replaced = $true
        } catch [System.NotSupportedException] {
            # Rare filesystems without Replace support still get rollback
            # semantics. Both moves stay on the same volume.
            Move-KiwiReplacement
            $replaced = $true
        } catch [IO.IOException] {
            $nativeCode = $_.Exception.HResult -band 0xFFFF
            if ($nativeCode -in @(5, 32, 33)) {
                if ([DateTime]::UtcNow -ge $deadline) { throw }
                Start-Sleep -Milliseconds 250
            } else {
                # FAT/exFAT commonly reports ERROR_NOT_SUPPORTED as an
                # IOException rather than NotSupportedException.
                Move-KiwiReplacement
                $replaced = $true
            }
        }
    }

    try {
        Assert-KiwiFile $TargetPath
    } catch {
        Write-KiwiUpdateLog "Verifikation fehlgeschlagen; Rollback wird ausgeführt: $($_.Exception.Message)"
        if ([IO.File]::Exists($backupPath)) {
            Restore-KiwiBackup -ReplacementPath $TargetPath -SavedPath $backupPath
        }
        throw
    }

    if (-not $NoLaunch) {
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RelaunchArgsBase64))
        $arguments = @((ConvertFrom-Json -InputObject $decoded))
        Start-KiwiProcess $TargetPath $arguments
    }
    if ([IO.File]::Exists($backupPath)) { [IO.File]::Delete($backupPath) }
    Write-KiwiUpdateLog "Portable Update erfolgreich installiert."
    exit 0
} catch {
    Write-KiwiUpdateLog "Portable Update fehlgeschlagen: $($_.Exception.Message)"
    if ([IO.File]::Exists($backupPath)) {
        try {
            Restore-KiwiBackup -ReplacementPath $TargetPath -SavedPath $backupPath
            Write-KiwiUpdateLog "Die bisherige portable Kiwi-Version wurde wiederhergestellt."
        } catch {
            Write-KiwiUpdateLog "Rollback fehlgeschlagen: $($_.Exception.Message)"
        }
    }
    Start-KiwiAfterFailure
    exit 1
}
