<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cleanText($value, int $maxLength): string
{
    $text = trim((string) $value);
    $text = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $text) ?? '';
    return mb_substr($text, 0, $maxLength, 'UTF-8');
}

function forwardToGas(array $payload): array
{
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        throw new RuntimeException('No fue posible preparar la solicitud.');
    }

    if (function_exists('curl_init')) {
        $curl = curl_init(BEAUTYOS_GAS_ENDPOINT);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $encoded,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT => 'BeautyOS-Hostinger/1.0',
        ]);
        $body = curl_exec($curl);
        $error = curl_error($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        if ($body === false || $error !== '') {
            throw new RuntimeException('No fue posible conectar con el servicio de registro.');
        }
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException('El servicio de registro respondió con un estado no válido.');
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nUser-Agent: BeautyOS-Hostinger/1.0\r\n",
                'content' => $encoded,
                'timeout' => 20,
                'ignore_errors' => true,
            ],
        ]);
        $body = @file_get_contents(BEAUTYOS_GAS_ENDPOINT, false, $context);
        if ($body === false) {
            throw new RuntimeException('No fue posible conectar con el servicio de registro.');
        }
    }

    $result = json_decode($body, true);
    if (!is_array($result)) {
        throw new RuntimeException('El servicio de registro devolvió una respuesta inválida.');
    }
    return $result;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Método no permitido.']);
}

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if (!in_array($originHost, BEAUTYOS_ALLOWED_HOSTS, true)) {
        respond(403, ['error' => 'Origen no autorizado.']);
    }
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 16384) {
    respond(400, ['error' => 'Solicitud inválida.']);
}

$input = json_decode($raw, true);
if (!is_array($input)) {
    respond(400, ['error' => 'El contenido enviado no es válido.']);
}

$nombreContacto = cleanText($input['nombreContacto'] ?? '', 100);
$nombreNegocio = cleanText($input['nombreNegocio'] ?? '', 120);
$ciudad = cleanText($input['ciudad'] ?? '', 100);
$tipoNegocio = cleanText($input['tipoNegocio'] ?? '', 100);
$necesidad = cleanText($input['necesidadPrincipal'] ?? '', 120);
$cantidadEmpleados = cleanText($input['cantidadEmpleados'] ?? '', 40);
$whatsapp = preg_replace('/\D+/', '', (string) ($input['whatsapp'] ?? '')) ?? '';

if ($nombreContacto === '' || $nombreNegocio === '' || $ciudad === '' || $tipoNegocio === '' || $necesidad === '' || $cantidadEmpleados === '') {
    respond(422, ['error' => 'Completa todos los campos obligatorios.']);
}
$employeeOptions = ['Solo yo', '2 a 5', '6 a 10', '11 o mas'];
if (!in_array($cantidadEmpleados, $employeeOptions, true)) {
    respond(422, ['error' => 'Selecciona una cantidad de empleados válida.']);
}
if (strlen($whatsapp) < 10 || strlen($whatsapp) > 15) {
    respond(422, ['error' => 'Revisa el número de WhatsApp.']);
}

$clientIp = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$rateFile = sys_get_temp_dir() . '/beautyos-lead-' . hash('sha256', $clientIp);
if (is_file($rateFile) && time() - (int) filemtime($rateFile) < 8) {
    respond(429, ['error' => 'Espera unos segundos antes de volver a enviar el formulario.']);
}
@touch($rateFile);

$payload = [
    'action' => 'saveLead',
    'nombreContacto' => $nombreContacto,
    'nombreNegocio' => $nombreNegocio,
    'ciudad' => $ciudad,
    'whatsapp' => $whatsapp,
    'tipoNegocio' => $tipoNegocio,
    'necesidadPrincipal' => $necesidad,
    'cantidadEmpleados' => $cantidadEmpleados,
    'email' => '',
    'fuente' => 'landing-hostinger',
    'autorizaDatos' => 'SI',
    'notas' => 'Tipo de negocio: ' . $tipoNegocio . ' | Desea mejorar: ' . $necesidad,
];

try {
    $result = forwardToGas($payload);
    if (!empty($result['error'])) {
        respond(502, ['error' => cleanText($result['error'], 240)]);
    }
    respond(200, $result);
} catch (Throwable $error) {
    error_log('BeautyOS lead proxy: ' . $error->getMessage());
    respond(502, ['error' => 'No pudimos registrar tu solicitud en este momento. Inténtalo nuevamente o escríbenos por WhatsApp.']);
}
