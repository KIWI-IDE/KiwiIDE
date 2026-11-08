<#
.SYNOPSIS
    Richtet den Kiwi Update Server auf diesem Windows-Rechner ein.

.DESCRIPTION
    Kopiert das JAR an seinen Zielort, erzeugt beim ersten Mal eine
    Konfiguration mit frischem Publishing-Token und meldet den Server auf
    Wunsch als Autostart-Aufgabe an.

    Ohne -RegisterService wird nichts an der Maschine geaendert, das ein
    Neustart ueberlebt: dann ist das Ergebnis ein Verzeichnis, das per
    "java -jar kiwi-update-server.jar" startet.

.EXAMPLE
    .\install.ps1 -InstallDir C:\KiwiUpdateServer

.EXAMPLE
    .\install.ps1 -InstallDir D:\Kiwi -RegisterService -OpenFirewallPort 443
#>
[CmdletBinding()]
param(
    [string] $InstallDir = "C:\KiwiUpdateServer",
    [string] $JarPath = (Join-Path $PSScriptRoot "kiwi-update-server.jar"),
    [switch] $RegisterService,
    [int] $OpenFirewallPort = 0
)

$ErrorActionPreference = "Stop"

function Find-Java {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME "bin\java.exe"
        if (Test-Path $candidate) { return $candidate }
    }
    $onPath = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    throw "Java wurde nicht gefunden. Installiere ein JDK 21 oder neuer und setze JAVA_HOME."
}

$java = Find-Java
# Die Versionszeile geht nach stderr, deshalb der Umweg ueber cmd.
$versionText = & cmd /c "`"$java`" -version 2>&1"
$major = 0
if ($versionText -match 'version "(\d+)') { $major = [int]$Matches[1] }
if ($major -lt 21) {
    throw "Der Update-Server benoetigt Java 21 oder neuer, gefunden wurde: $versionText"
}
Write-Host "Java: $java (Version $major)"

if (-not (Test-Path $JarPath)) {
    throw "kiwi-update-server.jar wurde nicht gefunden: $JarPath"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path $JarPath -Destination (Join-Path $InstallDir "kiwi-update-server.jar") -Force
Write-Host "JAR installiert: $InstallDir"

$configFile = Join-Path $InstallDir "kiwi-update-server.properties"
if (Test-Path $configFile) {
    # Die Datei enthaelt den Publishing-Token. Ein Update darf sie nie ersetzen.
    Write-Host "Konfiguration bleibt unveraendert: $configFile"
} else {
    & $java -jar (Join-Path $InstallDir "kiwi-update-server.jar") --init
    if ($LASTEXITCODE -ne 0) { throw "Die Konfiguration konnte nicht erzeugt werden." }
}

if ($OpenFirewallPort -gt 0) {
    $ruleName = "Kiwi Update Server $OpenFirewallPort"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $OpenFirewallPort | Out-Null
        Write-Host "Firewall-Regel angelegt: $ruleName"
    } else {
        Write-Host "Firewall-Regel war bereits vorhanden: $ruleName"
    }
}

if ($RegisterService) {
    $taskName = "KiwiUpdateServer"
    $action = New-ScheduledTaskAction -Execute $java `
        -Argument "-jar `"$(Join-Path $InstallDir 'kiwi-update-server.jar')`"" `
        -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # Ein eigenes, nicht administratives Konto ist besser; NETWORK SERVICE ist
    # das, was ohne Rueckfrage vorhanden ist.
    $principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\NETWORK SERVICE" -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "Autostart eingerichtet: Aufgabe $taskName"
    Write-Host "Starten mit: Start-ScheduledTask -TaskName $taskName"
}

Write-Host ""
Write-Host "Naechster Schritt: $configFile oeffnen und KIWI_UPDATE_PUBLIC_BASE_URL sowie TLS eintragen."
Write-Host "Danach starten:  & `"$java`" -jar `"$(Join-Path $InstallDir 'kiwi-update-server.jar')`""
