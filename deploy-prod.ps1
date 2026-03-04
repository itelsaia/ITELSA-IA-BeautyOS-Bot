<#
.SYNOPSIS
Script de despliegue automatizado para ITELSA BeautyOS.
Este script empuja el código core a BEAUTY_CORE_MASTER y
luego iterativamente a cada proyecto en la carpeta _clientes.

.DESCRIPTION
Paso 1: Renombra momentáneamente .clasp.prod.json a .clasp.json en crm-webapp y hace push.
Paso 2: Restaura el .clasp.json de desarrollo.
Paso 3: Itera por cada carpeta en _clientes y hace clasp push.
#>

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 INICIANDO DESPLIEGUE A PRODUCCIÓN 🚀" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- 1. DESPLIEGUE CORE MASTER ---
Write-Host "`n[1/3] Preparando entorno Core..." -ForegroundColor Yellow
Set-Location -Path ".\crm-webapp"

if (Test-Path ".clasp.prod.json") {
    Write-Host "-> Intercambiando archivos .clasp.json para apuntar a PROD"
    Rename-Item -Path ".clasp.json" -NewName ".clasp.dev.json" -Force
    Rename-Item -Path ".clasp.prod.json" -NewName ".clasp.json" -Force

    Write-Host "-> Subiendo código a BEAUTY_CORE_MASTER..."
    clasp push --force

    Write-Host "-> Restaurando archivos .clasp.json locales a DEV"
    Rename-Item -Path ".clasp.json" -NewName ".clasp.prod.json" -Force
    Rename-Item -Path ".clasp.dev.json" -NewName ".clasp.json" -Force
} else {
    Write-Warning "No se encontró crm-webapp/.clasp.prod.json. Saltando push core."
}

Set-Location -Path ".."

# --- 2. DESPLIEGUE CLIENTES ---
Write-Host "`n[2/3] Actualizando clientes individuales..." -ForegroundColor Yellow

$clientesPath = ".\_clientes"
if (Test-Path $clientesPath) {
    $carpetasClientes = Get-ChildItem -Path $clientesPath -Directory

    foreach ($cliente in $carpetasClientes) {
        Write-Host "-> Subiendo cliente: $($cliente.Name)" -ForegroundColor Magenta
        Set-Location -Path $cliente.FullName
        
        if (Test-Path ".clasp.json") {
            clasp push --force
        } else {
            Write-Warning "-> No se encontró .clasp.json en $($cliente.Name), omitiendo."
        }

        Set-Location -Path "..\.." 
        # Volvemos a la raíz
    }
} else {
    Write-Warning "La carpeta _clientes no existe aún."
}

# --- 3. FINALIZAR ---
Write-Host "`n[3/3] Despliegue completado." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Recuerda entrar a Google Apps Script en BEAUTY_CORE_MASTER y crear una 'Nueva Versión' de la biblioteca." -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan
