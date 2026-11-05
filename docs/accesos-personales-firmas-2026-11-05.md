# Invitaciones clínicas y firma desde el enlace personal

La ventana Links de un turno clínico prepara enlaces de MEDGRUP para cada profesional asignado. Cada acceso autoriza exclusivamente la consulta indicada y el nombre vinculado: no crea una sesión del panel ni permite cambiar el firmante desde el navegador. Los tokens son aleatorios, se guardan con hash y cifrado para poder reutilizar el enlace vigente, y vencen treinta días después de su emisión o de la fecha del turno (la mayor). Se invalidan al revocar, cancelar el turno o retirar al profesional del equipo asignado.

Los enlaces y salas de Daily ya existentes se conservan. Al abrir la invitación, la página carga el enlace Daily propio del profesional. El paciente mantiene su invitación y la validación domiciliaria existente, cuando corresponde. No se enviaron invitaciones automáticamente durante esta implementación.

La página Atención permite dibujar y confirmar la firma del acta, con consentimiento explícito. Se usa el nombre del token, no datos de identidad enviados por el cliente. El servidor exige un ingreso de ese participante registrado en eventos; abrir el enlace por sí solo no acredita asistencia. La firma se integra a firmas_acta y queda disponible en el acta del panel, también para pacientes remotos. Una tabla de auditoría conserva el contenido mostrado, su hash, firmante, rol, fecha, IP y agente del navegador.

La médica invitada también puede revisar los informes del mismo turno y firmarlos desde el enlace cuando estén generados. La firma del acta no se aplica automáticamente a un informe posterior. La firma del informe requiere su revisión de contenido vigente y se integra a firmas_dictamen; para el autor también actualiza firma_doctor. Un informe de otro turno se rechaza. La edición del texto completo archiva el documento y sus firmas previas, invalida firmas y PDF firmado y obliga a revisar nuevamente.

El acceso del paciente no permite firmar informes médicos. La invitación profesional no permite administrar usuarios ni acceder al resto del panel. El chat existente queda disponible con el nombre y rol del profesional.

Comprobaciones: 40 pruebas aprobadas (34 generales y 6 de integración), con API, base, ubicaciones y videollamada simuladas. Se prueban estabilidad de enlaces, aislamiento de turnos y roles, nombre inalterable, consentimiento, asistencia previa, firmas idempotentes, participación del paciente, revisión de informe, rechazo de contenido desactualizado y revocación. El recorrido de celular dibuja y guarda firmas ficticias sin cuenta de panel.

Captura ficticia: `output/participante/firma-celular.png`. No se realizó una videollamada real ni se firmaron documentos de pacientes reales en estas pruebas.

Operación: reabrir Links en el turno del 11/11 y compartir el enlace personal que corresponda a cada profesional. Los enlaces Daily enviados antes continúan entrando a la misma sala, pero la interfaz de firma se encuentra en la nueva invitación de MEDGRUP. Para firmar después de la consulta, volver al mismo enlace y usar Actualizar documentos. Para registrar la finalización del turno se conserva el circuito existente del panel médico.
