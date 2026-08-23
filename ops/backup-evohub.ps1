param(
  [string]$EnvFile = ".env",
  [string]$OutputRoot = "ops/backups"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') {
      $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $values
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$envPath = if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $root $EnvFile }
$env = Read-DotEnv $envPath
foreach ($required in @("SUPABASE_DB_URL", "SUPABASE_SCHEMA")) {
  if (-not $env[$required]) { throw "Variável obrigatória ausente: $required" }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$out = Join-Path $root (Join-Path $OutputRoot $stamp)
New-Item -ItemType Directory -Path $out -Force | Out-Null

$dbUrl = $env["SUPABASE_DB_URL"]
$schema = $env["SUPABASE_SCHEMA"]
$dumpName = "evohub-$schema.dump"
$dockerOut = "/backup/$dumpName"

Write-Host "Gerando dump do schema $schema..."
docker run --rm -v "${out}:/backup" postgres:16 pg_dump --format=custom --no-owner --no-acl --schema=$schema --file=$dockerOut $dbUrl

$head = (git -C $root rev-parse HEAD).Trim()
$branch = (git -C $root branch --show-current).Trim()
$manifest = [ordered]@{
  created_at = (Get-Date).ToUniversalTime().ToString("o")
  repository = "https://github.com/Camposoberano/evohub-bridge.git"
  branch = $branch
  commit = $head
  supabase_schema = $schema
  database_dump = $dumpName
  storage_buckets = @("soberano-config", "soberano-out", "soberano-relay", "chatwoot-media")
  notes = @(
    "O dump não contém segredos do .env.",
    "Os arquivos do Supabase Storage devem ser exportados separadamente.",
    "Não versionar este diretório; ele está protegido pelo .gitignore."
  )
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out "manifest.json") -Encoding UTF8

Write-Host "Backup concluído em $out"
