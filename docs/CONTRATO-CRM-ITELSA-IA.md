# Contrato de información con CRM-ITELSA-IA

Este documento debe entregarse al agente responsable del proyecto `CRM-ITELSA-IA`.

## 1. Responsabilidades

### CRM-ITELSA-IA

- prospectos y oportunidades;
- demos y seguimientos;
- propuestas y aceptación;
- cliente comercial;
- implementación y mensualidad;
- cobros, vencimientos y cartera;
- tareas de onboarding;
- campañas de ITELSA IA.

### BeautyOS

- preparación técnica del demo;
- aprovisionamiento;
- CRM operativo del negocio;
- agente IA del cliente;
- agenda, servicios y colaboradores;
- integración con WhatsApp;
- pruebas y soporte técnico.

## 2. CRM → BeautyOS: solicitud de demo

```json
{
  "schemaVersion": "beautyos-demo-request-v1",
  "opportunityId": "OPO-0001",
  "requestedDemoAt": "2026-01-01T15:00:00-05:00",
  "business": {
    "name": "Negocio prospecto",
    "sector": "Salón de belleza",
    "city": "Ciudad"
  },
  "contact": {
    "name": "Contacto"
  },
  "discovery": {
    "mainNeed": "Agenda y citas",
    "teamSize": "2 a 5",
    "desiredAgentName": "Luna",
    "topServices": [
      "Servicio 1",
      "Servicio 2"
    ],
    "generalSchedule": "Descripción breve"
  },
  "assignedTo": "Responsable"
}
```

No incluir número, correo u otros datos personales si no son necesarios para preparar el demo.

## 3. BeautyOS → CRM: resultado técnico del demo

```json
{
  "schemaVersion": "beautyos-implementation-v1",
  "opportunityId": "OPO-0001",
  "implementationStatus": "DEMO_READY",
  "preparedAt": "ISO-8601",
  "preparedBy": "Responsable",
  "notes": "Notas no sensibles"
}
```

Estados permitidos:

- `DEMO_REQUESTED`
- `DEMO_PREPARING`
- `DEMO_READY`
- `DEMO_COMPLETED`
- `PROVISIONING_PENDING`
- `PROVISIONING`
- `UAT_PENDING`
- `UAT_APPROVED`
- `ACTIVE`
- `SUSPENDED`
- `CANCELLED`
- `BLOCKED`

## 4. CRM → BeautyOS: orden de aprovisionamiento

```json
{
  "schemaVersion": "beautyos-provisioning-v1",
  "opportunityId": "OPO-0001",
  "customerId": "CLI-0001",
  "commercialStatus": "WON",
  "clientSlug": "negocio-ejemplo",
  "plan": {
    "code": "BEAUTYOS_PLAN",
    "implementationValue": 0,
    "monthlyValue": 0,
    "billingStartDate": "YYYY-MM-DD",
    "billingDay": 1,
    "promotion": "",
    "firstPaymentStatus": "PENDING_OR_PAID"
  },
  "business": {
    "name": "Negocio",
    "city": "Ciudad",
    "address": "",
    "mapsUrl": "",
    "logoUrl": "",
    "primaryColor": "#00BFD6"
  },
  "agent": {
    "name": "Nombre elegido",
    "welcomeMessage": "",
    "tone": "Cercano y profesional"
  },
  "operations": {
    "timeZone": "America/Bogota",
    "services": [],
    "staff": [],
    "schedule": [],
    "paymentPolicy": "",
    "frequentQuestions": []
  },
  "implementationOwner": "Responsable"
}
```

El payload no contiene:

- claves API;
- credenciales Google;
- PIN;
- Web App URL;
- IDs de Sheet o GAS;
- tokens de WhatsApp;
- datos bancarios completos.

Esos valores permanecen en la ficha técnica privada.

## 5. BeautyOS → CRM: activación

```json
{
  "schemaVersion": "beautyos-implementation-v1",
  "opportunityId": "OPO-0001",
  "customerId": "CLI-0001",
  "clientSlug": "negocio-ejemplo",
  "implementationStatus": "ACTIVE",
  "uat": {
    "approved": true,
    "approvedAt": "ISO-8601",
    "approvedBy": "Cliente"
  },
  "goLiveAt": "ISO-8601",
  "nextTechnicalReviewAt": "ISO-8601",
  "notes": "Sin datos sensibles"
}
```

## 6. Reglas para el agente del CRM

- No marcar `ACTIVE` solo porque la oportunidad está ganada.
- No solicitar claves ni contraseñas por chat.
- No copiar URLs privadas en notas comerciales.
- No prometer fecha de salida sin confirmación técnica.
- No activar facturación recurrente sin fecha y condiciones aceptadas.
- Crear tareas si faltan datos del negocio.
- Mantener separadas la etapa comercial y la técnica.

## 7. Integración inicial

Primera versión:

- intercambio mediante formulario o JSON copiado;
- revisión humana;
- actualización manual de estados.

Versión futura:

- endpoint autenticado y versionado;
- idempotencia por `opportunityId`;
- registro de auditoría;
- sin secretos en el payload.
