# Preparar un demo de BeautyOS

## Regla principal

El demo es un entorno reutilizable con datos temporales. No usar información sensible y no prometer que esa misma instancia será la definitiva.

## Información mínima desde CRM-ITELSA-IA

- ID de oportunidad.
- Fecha y hora del demo.
- Nombre del negocio.
- Tipo de negocio.
- Ciudad.
- Nombre del contacto.
- Necesidad principal.
- Nombre deseado para el agente, si ya fue definido.
- Tres a diez servicios principales.
- Número aproximado de colaboradores.
- Horario general.
- Logo y color, si están disponibles.

Si faltan servicios u horarios, utilizar datos ficticios claramente identificados como demo.

## Preparación

### 1. Reservar el entorno

- Confirmar que no existe otro demo durante la misma franja.
- Crear una copia local de `FICHA-IMPLEMENTACION-CLIENTE.template.md` dentro de `ops/demos/<opportunityId>/`.
- Registrar responsable y hora de limpieza posterior.

### 2. Limpiar el demo

Conservar encabezados y borrar registros anteriores de:

- `AGENDA`
- `CLIENTES`
- `SESIONES`
- `NOVEDADES`
- datos temporales de promociones o conocimiento.

No borrar catálogos estructurales sin respaldo.

### 3. Personalizar

En `CONFIGURACION`:

- `NOMBRE_NEGOCIO`
- `NOMBRE_AGENTE`
- `SALUDO_BASE`
- `COLOR_MARCA`
- `ENLACE_LOGO`
- dirección y ubicación si aportan valor.

En las demás hojas:

- servicios y precios;
- uno o dos colaboradores de demostración;
- competencias;
- horarios;
- preguntas frecuentes;
- promoción de ejemplo si aplica.

No escribir claves IA o claves internas en el Sheet.

### 4. Sincronizar el agente

- Confirmar que `demo-beautyos` está habilitado localmente.
- Reiniciar o sincronizar el bot.
- Verificar que el agente diga su nombre y el del negocio configurado.

### 5. Prueba interna

- Abrir CRM.
- Validar acceso.
- Crear cliente ficticio.
- Consultar servicios por WhatsApp.
- Pedir horarios.
- Agendar una cita.
- Reprogramarla.
- Cancelarla.
- Confirmar que el CRM y Sheet reflejan cada cambio.
- Confirmar que otro tenant no cambió.

### 6. Registrar listo

Informar al CRM central:

```json
{
  "schemaVersion": "beautyos-implementation-v1",
  "opportunityId": "OPORTUNIDAD_CRM",
  "implementationStatus": "DEMO_READY",
  "demoPreparedAt": "ISO-8601",
  "preparedBy": "RESPONSABLE",
  "notes": "Sin incluir URLs, claves ni datos sensibles"
}
```

## Durante el demo

Orden recomendado:

1. Confirmar el problema del prospecto.
2. Mostrar conversación con el agente personalizado.
3. Mostrar agenda y CRM.
4. Mostrar servicios, equipo y disponibilidad.
5. Mostrar recordatorios, promociones y reportes pertinentes.
6. Explicar que recibirá una instancia independiente.
7. Acordar decisión y siguiente acción.

No mostrar paneles, datos o conversaciones de otro cliente.

## Después

- Registrar resultado y objeciones en CRM-ITELSA-IA.
- Definir próxima acción y fecha.
- Limpiar datos del prospecto.
- Restaurar identidad neutral del demo.
- Si la venta se ganó, iniciar una instancia nueva siguiendo el proceso de conversión.

## Criterio de demo completado

- [ ] El prospecto vio su flujo principal.
- [ ] No se expusieron datos de terceros.
- [ ] Se registró resultado comercial.
- [ ] Existe siguiente acción.
- [ ] El entorno quedó limpio.
