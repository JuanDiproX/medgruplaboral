# Ingreso del paciente desde celular

Se unifica la identidad de `/ingreso/:token` y `atencion.html`: papel cálido, tinta marino, títulos en Libre Caslon Display, cuerpo en Schibsted Grotesk y botones amplios. La validación presenta datos del control, pasos Validar / Ingresar y ayuda de permisos desplegable.

El JS del ingreso pasa a `public/ingreso.js` y su CSS a `public/ingreso.css`. No cambian las rutas, los tokens, los enlaces de invitación ni las reglas de aprobación del servidor. La ubicación se solicita al tocar el botón, con alta precisión, 20 segundos de espera y sin reutilizar lecturas antiguas.

Se distinguen los estados de carga, permiso denegado, señal agotada, error de red y fuera de rango. Hay reintento y protección frente a doble toque. Los errores y datos del servidor se insertan como texto. Solo se ofrece el enlace de llamada cuando el servidor responde positivamente. La excepción geográfica autorizada sigue identificándose como tal; no se presenta como ubicación validada.

El espacio de llamada y archivos conserva sus controles y lógica de chat. Solo se adapta su estilo. La huella de versión y el verificador de producción incluyen las seis piezas de estas pantallas.

Validación: `node --check server.js`, `node --check public/ingreso.js` y `npm run test:all`: 38 pruebas aprobadas (33 generales y 5 de integración). La prueba nueva de ingreso usa API y geolocalización simuladas; incluye permiso denegado, señal agotada, fuera de rango, excepción, enlace inválido, entrevista cerrada, domicilio sin verificar, reintento de red y doble toque. Revisa anchos de 320, 390 y 1280 px. Otra prueba comprueba el acceso desde el chat móvil y que la llamada siga bloqueada antes de validar.

Capturas ficticias: `output/ingreso-paciente/`. No se contactó a pacientes, no se generaron salas ni se probó GPS o videollamada reales durante esta modificación.

## Simplificación posterior: entrada automática

Por pedido del usuario, cuando el servidor aprueba el ingreso, la pantalla de ubicación navega automáticamente al enlace que devuelve, usando `location.replace`. Se conserva el botón como alternativa si la navegación no se completa. El espacio del paciente carga automáticamente la llamada cuando su sesión devuelve un enlace autorizado; el chat médico interno no abre otra llamada. Los permisos de cámara y micrófono siguen a cargo del navegador.

La prueba del recorrido ahora comprueba con un solo toque: ubicación simulada → autorización → navegación a Atención → iframe de videollamada abierto, sin tocar otro botón. También prueba la excepción autorizada y el enlace directo cuando no hay chat. Las respuestas denegadas siguen sin ofrecer acceso ni navegar.
