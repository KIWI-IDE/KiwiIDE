# Shared by the setup and portable helpers. Loaded from their durable copy.
function Write-KiwiUpdateResult([string]$Phase, [string]$Message) {
    if (-not $KiwiResultPath) { return }
    try {
    $result = @{ requestId = $KiwiRequestId; phase = $Phase; message = $Message; timestamp = [DateTime]::UtcNow.ToString('o') }
    if ($ExpectedVersion) { $result.version = $ExpectedVersion }
    $temporary = "$KiwiResultPath.$KiwiRequestId.tmp"
    [IO.File]::WriteAllText($temporary, (ConvertTo-Json -Compress $result), [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($KiwiResultPath)) { [IO.File]::Replace($temporary, $KiwiResultPath, $null) }
    else { [IO.File]::Move($temporary, $KiwiResultPath) }
    } catch { Write-KiwiUpdateLog "Update-Ergebnis konnte nicht gespeichert werden: $($_.Exception.Message)" }
}

function Wait-KiwiParentExit {
    if ($KiwiParentProcessId -le 0) { return }
    $parentProcess = [Diagnostics.Process]::GetProcessById($KiwiParentProcessId)
    try {
        $ready = @{ requestId = $KiwiRequestId; phase = 'waiting-for-parent'; parentPid = $KiwiParentProcessId; helperPid = $PID }
        [IO.File]::WriteAllText($KiwiReadyPath, (ConvertTo-Json -Compress $ready), [Text.UTF8Encoding]::new($false))
        Write-KiwiUpdateLog 'Updatehelfer ist bereit und wartet auf das Ende der bisherigen Kiwi-Version.'
        $timeout = [DateTime]::UtcNow.AddSeconds(180)
        while (-not $parentProcess.WaitForExit(200)) {
            if ([IO.File]::Exists($KiwiCancelPath)) { throw 'Update wurde vor dem Beenden abgebrochen.' }
            if ([DateTime]::UtcNow -ge $timeout) { throw 'Kiwi wurde nicht rechtzeitig beendet; die Installation wurde nicht gestartet.' }
        }
        if ([IO.File]::Exists($KiwiCancelPath) -or -not [IO.File]::Exists($KiwiCommitPath)) { throw 'Die Update-Installation wurde nicht freigegeben.' }
        if ([IO.File]::ReadAllText($KiwiCommitPath) -ne $KiwiRequestId) { throw 'Die Update-Freigabe ist ungueltig.' }
    } finally { $parentProcess.Dispose() }
}
