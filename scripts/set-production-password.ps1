# set-production-password.ps1 - the ONE action that supplies the production database password.
#
# Why this exists instead of "edit the file in an editor":
#   The first attempt at supplying this value did not land - the credential file was byte-identical
#   to the template afterwards (856 bytes, unchanged mtime), and no PROD_DB_PASS line existed
#   anywhere else on the machine. An editor can save to the wrong folder, append .txt, or never be
#   saved at all, and none of those failures are visible from the outside. A hidden prompt has
#   exactly one failure mode ("nothing entered"), and it reports it.
#
# What it guarantees:
#   * Read-Host -AsSecureString does not echo the value, and the value is never part of a command
#     line, so it is not written to PowerShell's command history file.
#   * It writes to the single sanctioned path (~/.agrishop/production.env, outside the repository)
#     and touches only the PROD_DB_PASS line.
#   * It prints the resulting character count and file size, never the value.
#
# Usage (one line, no editor involved):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/set-production-password.ps1
#
# Re-runnable: running it again replaces the value rather than appending a second line.

param([string]$Path = (Join-Path $env:USERPROFILE '.agrishop\production.env'))

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Output "No credential file at: $Path"
  Write-Output "Create the template first:  npm run creds:production -- --init"
  exit 2
}

if ([Console]::IsInputRedirected) {
  # Automation path: the value arrives on stdin, so the write logic can be exercised with a canary
  # by the verifier, and a script can supply it without the value entering any command line.
  $plain = [Console]::In.ReadLine()
} else {
  Write-Output "Production database password for project gkswcfljxlutkfdvvqng"
  Write-Output "(Supabase dashboard -> Agrishop APp -> Settings -> Database. Input is hidden and not echoed.)"
  $secure = Read-Host -AsSecureString "Password"
  $plain = [System.Net.NetworkCredential]::new("", $secure).Password
}

if ([string]::IsNullOrEmpty($plain)) {
  Write-Output "Nothing entered - the file was NOT changed."
  exit 2
}

$lines = [System.IO.File]::ReadAllLines($Path)
$replaced = $false
for ($i = 0; $i -lt $lines.Length; $i++) {
  if ($lines[$i] -match '^PROD_DB_PASS=') { $lines[$i] = 'PROD_DB_PASS=' + $plain; $replaced = $true }
}
if (-not $replaced) { $lines += ('PROD_DB_PASS=' + $plain) }
[System.IO.File]::WriteAllLines($Path, $lines, (New-Object System.Text.UTF8Encoding($false)))

$check = [System.IO.File]::ReadAllLines($Path) | Where-Object { $_ -match '^PROD_DB_PASS=' } | Select-Object -First 1
$chars = 0
if ($check) { $chars = $check.Substring(13).Length }
Write-Output ("Saved. PROD_DB_PASS holds " + $chars + " characters; file is " + (Get-Item -LiteralPath $Path).Length + " bytes; line replaced: " + $replaced)
Write-Output "The value was not printed, and it is not in your PowerShell history."
