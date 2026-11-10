# MEDGRUP como SaaS: varias prestadoras en una sola base

Decisión del 10/11/2026: modelo multi-organización (todas las prestadoras en la misma aplicación y la misma base, separadas por organización). Este documento es el plan; **no está implementado**. Lo que sí quedó hecho y sirve para este camino: importación por Excel, auditoría, enlaces cortos, CORS por origen y errores sin detalle interno.

## Por qué va por etapas

Hoy el sistema asume una sola prestadora:

- Ninguna de las 32 tablas tiene columna de organización. Las ~190 consultas de `server.js` leen datos globales.
- Marca, correos, textos de actas e informes, médicos iniciales y el correo de administración están escritos en el código.
- Las empresas clientes se relacionan con turnos y casos por **nombre**, no por id.
- El aislamiento entre empresas clientes depende de comparar ese nombre en cada ruta.

Agregar `organizacion_id` a mano en cada consulta es la forma más común de terminar con una fuga de datos entre clientes: alcanza con olvidarse un `WHERE`. Por eso el aislamiento tiene que estar garantizado por la base, no por la disciplina de quien escribe la consulta.

## Diseño

**Aislamiento con Row Level Security de PostgreSQL.**

- Tabla `organizaciones (id, slug, nombre, estado, plan, creado_en)` y `organizacion_config (organizacion_id, marca, logo, colores, remitente, textos legales, radio por defecto, tolerancia, zona horaria)`.
- `organizacion_id NOT NULL` en todas las tablas con datos de clientes, con índice.
- Política RLS en cada tabla: `USING (organizacion_id = current_setting('app.org')::int)`. La aplicación se conecta con un rol sin `BYPASSRLS`.
- Cada pedido HTTP toma una conexión, hace `SET LOCAL app.org = <id de la sesión>` dentro de una transacción y recién ahí consulta. Una consulta sin organización fijada no devuelve filas: el olvido falla cerrado.
- Tareas de fondo (recordatorios, cola de correos, webhooks de Daily) recorren organizaciones y fijan `app.org` explícitamente. Para Daily, la organización se resuelve por la sala.

**Identidad y acceso.**

- La sesión guarda `organizacion_id`. Los usuarios pertenecen a una organización; el email es único por organización.
- Rol nuevo `superadmin` (operación de la plataforma), con acceso auditado y sin lectura de contenido clínico por defecto.
- Entrada por subdominio (`prestadora.dominio.com`) o por selección al iniciar sesión. Los enlaces cortos y de ingreso ya resuelven por token, no necesitan cambios.

**Marca.**

- Logo, nombre, colores y remitente salen de `organizacion_config` en: panel, pantallas del paciente, correos, actas, informes y PDF.
- Las variables CSS ya están centralizadas (`:root`), así que el tema por organización es un bloque de estilos generado.

## Etapas

| Etapa | Qué | Riesgo para la operación actual |
|---|---|---|
| 0 · hecho | Importación por Excel, auditoría, enlaces cortos, endurecimiento | Ninguno |
| 1 | Relacionar turnos, casos y seguimientos con `empresa_id` (hoy es por nombre). Entidad paciente única (hoy es un nombre suelto por turno) | Bajo: columnas nuevas, se completan con una migración verificable |
| 2 | Tabla `organizaciones`, `organizacion_id` en todas las tablas con MEDGRUP como organización 1, sin activar RLS todavía | Bajo: solo agrega columnas con valor por defecto |
| 3 | Conexión por pedido con `SET LOCAL app.org`; activar RLS tabla por tabla, con pruebas de "organización A no ve nada de B" para cada ruta | Medio: es el cambio de fondo; se hace en un entorno de ensayo con copia de la base |
| 4 | Marca y textos por organización; sacar del código los datos de MEDGRUP | Medio: toca plantillas de actas e informes |
| 5 | Alta de una organización nueva: asistente (datos, marca, primer administrador, importación de empresas y casos) | Bajo |
| 6 | Operación SaaS: planes y límites, facturación, respaldo y exportación por organización, baja con borrado verificable | — |

Antes de la etapa 3 conviene partir `server.js` (4.900 líneas) en módulos por dominio y pasar el esquema a migraciones versionadas: hoy el esquema se arma al arrancar, lo que con varias organizaciones y RLS deja de ser manejable.

## Antes de vender a un tercero

Aunque el código esté listo, ofrecerlo a otra prestadora implica tratar datos de salud por cuenta de terceros. Hay que definir con asesoramiento legal: el contrato de tratamiento de datos con cada cliente, la inscripción y las obligaciones de la Ley 25.326 para datos sensibles, el consentimiento del paciente para la geolocalización y la grabación, plazos de conservación y el procedimiento ante un incidente. No soy abogado; esto es una lista de temas a resolver, no un dictamen.

## Camino corto si aparece un primer cliente antes

Mientras no esté la etapa 3, un cliente puede arrancar en una instalación separada (otro servicio en Railway con su propia base y sus variables). El importador por Excel ya permite cargarle los casos el primer día, y esa base se puede fusionar después como una organización más.
