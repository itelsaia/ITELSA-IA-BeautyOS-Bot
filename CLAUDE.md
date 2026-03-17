# BeautyOS - Reglas de Desarrollo

## REGLA #1: Cero Deuda Tecnica — NO NEGOCIABLE

Cada cambio que se haga DEBE cumplir estas reglas. Sin excepciones.

### Codigo Limpio
- **No dejar variables sin usar.** Si se crea una variable, debe usarse. Si se deja de usar, se elimina.
- **No dejar codigo muerto.** Bloques comentados, funciones sin llamar, imports sin uso = ELIMINAR.
- **No dejar console.log de debug.** Solo se permiten logs operacionales con prefijo estandar: `[openai]`, `[webhook]`, `[evolution]`, `[tenants]`, `[sheets]`.
- **No duplicar logica.** Si una regla existe en codigo (guardrail), el prompt solo debe referenciar el comportamiento, NO duplicar la logica completa.

### Comentarios y Documentacion
- **Comentar el POR QUE, no el QUE.** El codigo debe ser autoexplicativo. Los comentarios explican decisiones, no sintaxis.
- **Secciones con separadores claros.** Usar `// ─── Nombre de seccion ───` para bloques logicos en archivos grandes.
- **Actualizar docs cuando cambia el comportamiento.** Si un cambio afecta flujos documentados en los `.md`, actualizar esos docs en el mismo commit.

### Antes de Cada Commit
1. **Verificar sintaxis:** `node -e "require('./agent-bot/src/services/openai.js')"` (debe cargar sin errores)
2. **Buscar variables sin usar:** Revisar que cada `const`/`let` nuevo se use en el codigo
3. **Buscar codigo muerto:** No dejar bloques que se calculan pero no se consumen
4. **Revisar diff completo:** `git diff` antes de commit para verificar que solo van cambios intencionados
5. **Un commit = un proposito.** No mezclar fixes con features ni limpieza con logica nueva.

### Commits
- Formato: `tipo: Descripcion breve en español`
- Tipos: `feat`, `fix`, `refactor`, `docs`, `chore`
- Si un fix requiere multiples iteraciones, hacer commits incrementales (v1, v2) y al final un commit de limpieza
- SIEMPRE incluir `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

### Despliegue
- SIEMPRE hacer `git push` despues de commit
- En el servidor: `cd ~/beautyos && git pull && cd agent-bot && pm2 restart beautyos-bot`
- Si se toco `crm-webapp/`: hacer `clasp push + clasp deploy` en AMBOS proyectos GAS (ver MEMORY.md)

---

## REGLA #2: Codigo > Prompt — Guardrails en Codigo

La IA (GPT) puede ignorar instrucciones del prompt. Para logica critica de negocio:

- **Validaciones de precio:** Calcular en codigo, no confiar en lo que la IA envie
- **Restricciones de promo:** Bloquear en el handler de la funcion, no solo en el prompt
- **Formato de datos:** Validar en codigo (fechas, montos, IDs) antes de guardar
- El prompt es la "primera linea" (guia a la IA). El codigo es la "ultima linea" (garantiza el resultado).

---

## REGLA #3: Estructura del Proyecto

```
agent-bot/
  src/
    app.js          - Entry point Express multi-tenant
    routes/
      webhook.js    - Handler webhooks Evolution API
    services/
      openai.js     - IA + Function Calling + Guardrails
      evolution.js  - Cliente REST Evolution API
      tenants.js    - Gestor multi-tenant
      sheets.js     - Carga datos Google Sheets
      api.js        - Singleton HTTP a GAS
      session.js    - Onboarding state machine
crm-webapp/
  src/
    Backend.gs      - API endpoints (doPost)
    Setup.gs        - Inicializacion de hojas
    index.html      - CRM Web App frontend
```

### Archivos Sensibles (NO commitear)
- `.env` — Variables de entorno
- `credenciales-google.json` — Service Account JWT
- `tenants.json` — Config de clientes con URLs privadas

---

## REGLA #4: Patron de Guardrails en openai.js

Cuando se necesite proteger una regla de negocio critica, seguir este patron:

```javascript
// ── GUARDRAIL: [Nombre descriptivo] ──
// Que protege: [explicacion breve]
// Como funciona: [logica en 1-2 lineas]
if (condicion_de_bloqueo) {
    toolResultText = `🚫 MENSAJE CLARO PARA LA IA con instrucciones exactas`;
    console.log(`[openai] ⛔ Log operacional del bloqueo`);
} else {
    // Flujo normal
}
```

Principios:
- El guardrail BLOQUEA la ejecucion y devuelve un mensaje estructurado a la IA
- El mensaje debe incluir las OPCIONES concretas para el cliente
- El codigo FUERZA valores correctos (precios, fechas) — no depende de la IA
- Usar parametros explicitos en la funcion (ej: `acepta_perder_descuento`) en vez de flags de sesion
