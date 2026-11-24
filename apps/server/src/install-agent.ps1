# tg-claude: this Windows computer joins your bot. The one line from /pair runs this; nothing else to install
# by hand and no admin rights: Node and the agent go to %USERPROFILE%\.tg-claude-vps\agent, the agent starts with
# your Windows session. Served by your own server for one pairing code; the code works once, for 10 minutes
function Install-TgcvAgent {
  $ErrorActionPreference = 'Stop'
  # Invoke-WebRequest is many times faster without its progress bar
  $ProgressPreference = 'SilentlyContinue'
  # Non-ASCII text (the check mark, folder names) as text, in the window and in whatever reads its output; the agent
  # itself writes UTF-8. The script stays ASCII, so no code page can garble it: the check mark is made with [char]
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
  $Server = '__SERVER__'
  $Wss = '__WSS__'
  $Code = '__CODE__'
  $NodeVersion = '__NODE__'
  $Dir = if ($env:TGCV_HOME) { $env:TGCV_HOME } else { Join-Path $env:USERPROFILE '.tg-claude-vps\agent' }
  $Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  function Step($text) { Write-Host "`n$text" -ForegroundColor Cyan }

  if (-not (Test-Path $Tar)) { Write-Host 'Windows 10 (1803) or newer is needed.' -ForegroundColor Red; return }
  $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("tgcv-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $Tmp | Out-Null
  try {
    # Node of its own, the version the server runs, checked against nodejs.org's own list of checksums
    $Node = Join-Path $Dir 'node\node.exe'
    if (-not ((Test-Path $Node) -and ((& $Node --version) -eq $NodeVersion))) {
      Step "Downloading Node ${NodeVersion}..."
      $Name = "node-$NodeVersion-win-$Arch"
      $Zip = Join-Path $Tmp "$Name.zip"
      Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$Name.zip" -OutFile $Zip -UseBasicParsing
      $Sums = (Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
      $Want = ($Sums -split "`n" | Where-Object { $_ -match " $Name\.zip$" }) -replace ' .*', ''
      $Got = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower()
      if (-not $Want -or $Got -ne $Want.Trim()) { Write-Host 'Node downloaded with errors (checksum mismatch). Run the line again.' -ForegroundColor Red; return }
      & $Tar -xf $Zip -C $Tmp
      if (Test-Path (Join-Path $Dir 'node')) { Remove-Item -Recurse -Force (Join-Path $Dir 'node') }
      Move-Item (Join-Path $Tmp $Name) (Join-Path $Dir 'node')
    }

    Step 'Downloading the agent from your server...'
    $Bundle = Join-Path $Tmp 'agent.tar.gz'
    try {
      Invoke-WebRequest "$Server/install/$Code/agent.tar.gz" -OutFile $Bundle -UseBasicParsing
    } catch {
      Write-Host 'The server did not hand over the agent: the code from /pair has expired or was already used. Get a new one: /pair' -ForegroundColor Red
      return
    }
    foreach ($Old in 'apps', 'packages', 'node_modules') {
      $Path = Join-Path $Dir $Old
      if (Test-Path $Path) { Remove-Item -Recurse -Force $Path }
    }
    & $Tar -xzf $Bundle -C $Dir
    # The protocol package is linked in place: a junction needs no admin rights
    New-Item -ItemType Junction -Force -Path (Join-Path $Dir 'node_modules\@tgcv\protocol') -Target (Join-Path $Dir 'packages\protocol') | Out-Null

    Step 'Connecting this computer to the bot...'
    & $Node (Join-Path $Dir 'apps\agent\src\main.ts') setup $Code --server $Wss
    if ($LASTEXITCODE -ne 0) { Write-Host 'Could not connect: see the message above. Get a new code (/pair) and run the line again.' -ForegroundColor Red; return }
    Write-Host "`n$([char]0x2714) Done. The agent is installed in $Dir and starts by itself when you sign in to Windows. You can close this window." -ForegroundColor Green
  } finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  }
}
Install-TgcvAgent
