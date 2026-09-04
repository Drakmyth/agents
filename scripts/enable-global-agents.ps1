$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "GLOBAL_AGENTS.md"
$destination = Join-Path $root "AGENTS.md"

if (Test-Path $destination) {
    Write-Host "Already present: $destination"
    exit 0
}

try {
    New-Item -ItemType SymbolicLink -Path $destination -Target $source | Out-Null
    Write-Host "Created symbolic link: $destination"
} catch {
    New-Item -ItemType HardLink -Path $destination -Target $source | Out-Null
    Write-Host "Created hard link (symbolic links unavailable): $destination"
}
