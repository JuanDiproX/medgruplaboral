# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Médicos laborales** de MEDGRUP: atienden turnos por videoconsulta, redactan dictámenes e informes, firman.
- **Administración MEDGRUP**: programa turnos, gestiona médicos, empresas, presupuestos y ausentismo.
- **Empresas clientes**: entran a su portal (`/empresa`) para ver informes y actas de su personal.
- **Trabajadores/pacientes**: no inician sesión; entran a la consulta desde un link (`/ingreso/:token`, `atencion.html`).

## Product Purpose

Portal de trabajo de MEDGRUP Servicio Médico Laboral (medicinalaboral.medgrup.com.ar): agenda de turnos, videoconsultas con grabación (Daily), juntas médicas, informes médico-legales con firma digital, actas, control de ausentismo y gestión de empresas. Éxito: el médico ve qué turno sigue y entra a la consulta sin fricción; la administración opera el día sin errores.

## Operating Context

- Se usa en jornada de turnos, en escritorio y en celular (el médico puede atender desde el teléfono; la videollamada pasa a pantalla completa en mobile).
- App de una sola página (`public/index.html`, HTML + CSS + JS inline) servida por `server.js` (Express, Postgres) en Railway. El sitio público vive aparte en laboral.medgrup.com.ar (`medicina-laboral.html`, `sitio.css`).
- Se edita en producción mientras hay turnos: los cambios visuales no pueden tocar el comportamiento.

## Capabilities and Constraints

- Roles: admin (ve médicos, empresas, presupuestos, firmas) y médico.
- Estados de turno con significado operativo: próximo, inminente, completado.
- Muchos estilos inline y HTML generado desde JS; el CSS global debe convivir con ellos.
- Sin base de datos local: el panel autenticado no se puede ejercitar en local con datos reales.

## Brand Commitments

- Marca MEDGRUP Servicio Médico, logo en `public/logo.png`.
- El portal comparte mundo visual con el sitio público rediseñado (sistema editorial de `public/sitio.css`), confirmado por el usuario el 2026-10-02.

## Evidence on Hand

- Contacto real: administracion@medgrup.com.ar.
- Ámbito: Tierra del Fuego (Río Grande, Ushuaia) y resto del país.

## Product Principles

1. El turno que sigue manda: estado y hora se leen antes que cualquier otra cosa.
2. Urgencia con un solo color: lo inminente y la acción inmediata se distinguen sin ruido alrededor.
3. Cero sorpresas en producción: cambios visuales sin tocar flujos ni datos.
4. Mismo MEDGRUP en el sitio y en el portal.
