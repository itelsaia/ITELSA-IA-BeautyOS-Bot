$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$tenantsPath = Join-Path $projectRoot 'tenants.json'

if (-not (Test-Path -LiteralPath $tenantsPath)) {
  throw 'No se encontró tenants.json. Cópialo desde tenants.example.json y configura el demo.'
}

$tenants = Get-Content -Raw -LiteralPath $tenantsPath | ConvertFrom-Json
$demo = $tenants.'demo-beautyos'

if (-not $demo) {
  throw 'No existe la entrada demo-beautyos en tenants.json.'
}

if (-not $demo.webhookGasUrl -or -not $demo.sheetId) {
  throw 'El demo necesita webhookGasUrl y sheetId en la configuración privada.'
}

$sheetUrl = 'https://docs.google.com/spreadsheets/d/' + $demo.sheetId + '/edit'

Start-Process -FilePath $demo.webhookGasUrl
Start-Process -FilePath $sheetUrl

Write-Host 'Demo BeautyOS abierto: CRM Web App y Google Sheet.'
