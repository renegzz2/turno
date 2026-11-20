# Turno

Checador web para tablet con número de empleado y PIN, panel de asistencia y exportación en formato `.xlsx`. El enlace principal abre el checador. Desde **Ir al panel**, el Administrador y el Líder inician sesión con correo y contraseña.

## Probar en Windows

Con Node.js 24 o posterior:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abre [http://localhost:3000](http://localhost:3000) para checar con el empleado **101** y el PIN inicial **123456**. Sin variables de Supabase, el servidor de desarrollo usa datos de prueba en `.demo/`.

| Acceso | Correo de demostración |
| --- | --- |
| Administrador | `admin@turno.test` |
| Líder | `lider@turno.test` |

Las dos cuentas del panel usan `Turno-Demo-2026!`. Desde el panel, **Cerrar sesión** vuelve al checador. Los datos y las cuentas de prueba se conservan al reiniciar el servidor.

## Conectar Supabase

1. Crea un proyecto Supabase y copia `.env.example` a `.env.local`. Completa `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` con la URL y la clave publicable del proyecto. Configura `SUPABASE_SECRET_KEY` en el servidor para habilitar la creación de usuarios. Reinicia el servidor después de cambiar las variables.
2. Aplica las migraciones pendientes con la CLI de Supabase o en el SQL Editor, en este orden.
   1. [Checador y asistencias](supabase/migrations/202611190001_attendance.sql)
   2. [Bajas e incidencias](supabase/migrations/202611190002_status_and_incidents.sql)
   3. [Horarios, detección de faltas y restablecimiento de PIN](supabase/migrations/202611190003_schedules_pin.sql)
   4. [Ajustes manuales e historial de checadas](supabase/migrations/202611190004_shift_adjustments.sql)
   5. [Rol de Líder](supabase/migrations/202611190005_leader_role.sql)
   6. [Inicio de sesión y gestión de usuarios](supabase/migrations/202611190006_panel_users.sql)
   7. [Checador público](supabase/migrations/202611190007_public_kiosk.sql)
   8. [Carga masiva de personal y horarios](supabase/migrations/202611190008_personnel_import.sql)
   9. [PIN opcional en la carga de personal](supabase/migrations/202611190009_personnel_import_pin.sql)
   10. [Actualización de personal por número de empleado](supabase/migrations/202611190010_update_personnel_import.sql)
   11. [QR dinámico por turno](supabase/migrations/202611190011_dynamic_qr.sql)
   12. [Configuración general de la empresa](supabase/migrations/202611190012_company_settings.sql)
3. Para iniciar una empresa nueva, crea el primer administrador y la cuenta técnica del checador en **Authentication → Users**, con sus correos confirmados. Copia los UUID de estos usuarios. Si la empresa ya tiene esas cuentas vinculadas, pasa al paso 5.
4. En el SQL Editor, vincula ambos usuarios con una empresa. Cambia el nombre, la zona horaria (identificador IANA) y los UUID de ejemplo antes de ejecutar:

```sql
with empresa as (
  insert into public.organizations (name, timezone)
  values ('Mi empresa', 'America/Mexico_City')
  returning id
)
insert into public.organization_users (user_id, organization_id, role)
select cuenta.user_id, empresa.id, cuenta.role
from empresa
cross join (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'admin'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'kiosk')
) as cuenta(user_id, role);
```

5. Habilita el checador público de esta instalación. Sustituye el UUID de ejemplo por el de la cuenta técnica vinculada con rol `kiosk` y ejecuta lo siguiente en el SQL Editor. Este comando también permite sustituir el token de esa cuenta:

```sql
with nuevo as (
  select encode(extensions.gen_random_bytes(32), 'hex') as token
), guardado as (
  insert into attendance_private.public_terminals (kiosk_id, token_hash)
  select u.user_id, extensions.digest(n.token, 'sha256')
  from public.organization_users u cross join nuevo n
  where u.user_id = '00000000-0000-0000-0000-000000000002'::uuid and u.role = 'kiosk'
  on conflict (kiosk_id) do update set token_hash = excluded.token_hash
  returning kiosk_id
)
select nuevo.token as turno_kiosk_token from nuevo cross join guardado;
```

6. Guarda el token devuelto como `TURNO_KIOSK_TOKEN` en el entorno del servidor y reinícialo. La empresa vinculada a ese token será la del checador del enlace principal. Desde **Personal**, un Administrador puede asignar el número y PIN de cada trabajador.

## Roles del panel

| Permiso dentro de la empresa | Administrador | Líder |
| --- | --- | --- |
| Consultar asistencias y exportar el corte a Excel | Sí | Sí |
| Agregar jornadas, ajustar checadas y consultar su historial | Sí | Sí |
| Registrar incidencias y vacaciones, y justificar faltas | Sí | Sí |
| Asignar y actualizar horarios | Sí | Sí |
| Dar de alta, dar de baja y reactivar trabajadores | Sí | |
| Restablecer PIN y anular incidencias | Sí | |
| Configurar el envío de QR por trabajador | Sí | |
| Editar la configuración general de la empresa | Sí | |

En **Usuarios → Nuevo usuario**, el Administrador registra el correo, el rol y la contraseña inicial. La cuenta puede iniciar sesión de inmediato. Comparte la contraseña inicial por un canal privado. Desde **Cuentas del panel** también puedes cambiar el rol de otras cuentas de tu empresa.

El Administrador y el Líder usan la misma pantalla de acceso. Los trabajadores checan desde el enlace principal con su número de empleado, PIN y QR cuando tienen asignado un canal de envío. Cada ajuste de jornada queda registrado con la cuenta que lo realizó.

## Cortes y exportación

- **Semanal** y **catorcenal** calculan 7 o 14 días a partir de cualquier fecha de inicio.
- **Quincenal** propone del 1 al 15 o del 16 al último día del mes. **Mensual** propone el mes calendario.
- **Personalizado** admite cualquier par de fechas válidas. Si editas el fin de una propuesta, se convierte en personalizado.
- Cada corte incluye los dos días seleccionados en la zona horaria de la empresa. Si una jornada cerrada cruza el límite de un corte, conserva las horas originales de checada y suma solo los minutos dentro del corte. Una jornada sin salida aparece en el corte en que empezó y queda sin horas calculadas hasta cerrarse.
- **Exportar Excel** usa las fechas aplicadas al panel y genera las hojas **Corte**, **Asistencias**, **Horas extra**, **Incidencias** y **Retardos y faltas**.

## Horas extra en México

- El checador guarda la hora real de salida. **Asistencias → Horas extra** y el Excel clasifican las jornadas cerradas en minutos dobles y triples. El excedente del límite semanal del tramo triple se muestra dentro del total de triples y se señala por separado.
- Turno usa el horario vigente del día de la jornada y la zona horaria de la empresa. Suma todas las jornadas de la semana laboral configurada y presenta los minutos que caen dentro del corte. Las alertas revisan la semana completa. Un turno nocturno se atribuye a su día de inicio para aplicar los límites.
- El cálculo estima el tiempo trabajado a partir de las checadas. Un descanso sin registrar queda dentro del intervalo de asistencia. Los registros sin horario ordinario aplicable, como un día de descanso programado, se muestran como **Sin clasificar** para revisión. Revisa estas estimaciones antes de liquidar nómina.
- Los topes se aplican por fecha, incluida la reducción gradual de la jornada ordinaria y el cambio gradual en el tramo de horas extra dobles. [Decreto del 1 de mayo de 2026](https://sidof.segob.gob.mx/notas/docFuente/5786537)

## Configuración general

- En **Configuración**, el Administrador guarda el nombre de la empresa, sube o quita su logo y elige el inicio de la semana laboral. La primera vez que un Administrador inicia sesión antes de guardar estos datos, Turno abre esta sección.
- El nombre aparece en el panel, el checador y el resumen de Excel. El logo aparece en el panel y el checador. Se admiten imágenes estáticas PNG, JPG o WebP de hasta 512 KB y 4 megapíxeles.
- El valor inicial de la semana laboral es de lunes a domingo. El día elegido se usa para calcular horas extra en todos los reportes, incluidos los cortes históricos. Las fechas y el tipo de corte de nómina se eligen por separado en **Asistencias**.

## Bajas e incidencias

- En **Personal → Trabajadores**, usa **Dar de baja** o **Reactivar**. La baja se aplica de inmediato y conserva las checadas e incidencias anteriores. El trabajador de baja puede cerrar una jornada abierta y queda impedido de iniciar otra mientras siga de baja.
- En **Personal → Nueva incidencia**, registra una falta justificada, falta injustificada, incapacidad o vacaciones. Puedes indicar un día o un rango inclusivo. Las incidencias se capturan manualmente y no modifican las checadas ni las horas calculadas.
- Puedes registrar incidencias históricas para trabajadores de baja. Se admite una incidencia por trabajador y fecha. Si necesitas corregir una, usa **Anular** en **Incidencias registradas** y captura el rango correcto.
- El panel y el Excel incluyen las incidencias con al menos un día en el corte seleccionado y muestran las fechas con las que se registraron.

## Carga masiva de personal

- Como Administrador, abre **Personal → Carga masiva desde Excel** y descarga la plantilla. Captura una fila por trabajador en la hoja **Personal**, con el número de empleado, el nombre y las horas de entrada y salida de cada día laboral. La columna de número está preformateada como texto para conservar los ceros iniciales.
- Si el número de empleado ya existe, conserva su nombre y su estado. Para el alta de un número nuevo, llena el nombre completo.
- Usa horas en formato **HH:mm**. Cuando incluyas horas, deja ambas celdas vacías en los días de descanso. Una salida anterior a la entrada termina al día siguiente. Para conservar el horario de un trabajador existente, deja todas las horas vacías. Si dejas **Tolerancia (min)** vacía, se conserva la que aplica en la fecha de vigencia o se usa cero si el trabajador aún no tiene horario.
- Selecciona desde cuándo aplica el horario y pulsa **Importar Excel**. Se admiten hasta 500 trabajadores por archivo de 512 KB. Se valida el archivo completo y se guarda como una sola operación. Si hay un error o un número repetido en el archivo, corrige las filas indicadas antes de reintentar.
- **PIN** es una columna opcional con formato de texto para conservar los ceros iniciales. Si ingresas seis dígitos, se aplican al terminar la carga. Deja la celda vacía para conservar el PIN actual o dejarlo pendiente en un alta nueva. Puedes asignarlo desde **Horario y PIN**.

## Horarios y PIN

- En **Personal → Horario y PIN**, asigna las horas por día, desmarca los descansos y elige la tolerancia de entrada. Puedes guardar un horario desde hoy o programarlo para una fecha futura. Las versiones anteriores se conservan. Una salida anterior a la hora de entrada indica un turno nocturno.
- La detección toma la primera entrada asignada al día del turno e indica retardo cuando supera la tolerancia. La falta aparece tras finalizar un turno laboral sin entrada. No se generan faltas para descansos, vacaciones, incapacidad, días de baja o fechas sin horario.
- En **Asistencias → Retardos y faltas**, usa **Justificar falta** para registrar una falta justificada por ese día. Si estaba incluida en un rango injustificado, los demás días conservan su clasificación. Puedes anular una justificación desde **Personal → Incidencias registradas**.
- En **Personal → Horario y PIN → Restablecer PIN**, captura y confirma el nuevo PIN de seis dígitos. El nuevo PIN reemplaza al anterior de inmediato.

## QR dinámico por turno

En **Personal → ficha del trabajador → QR por turno**, el Administrador elige **Correo electrónico** o **WhatsApp** y guarda el destino. El trabajador necesita un horario vigente y un PIN. Los trabajadores que no tienen un canal asignado siguen checando con su número y PIN.

- Los envíos comienzan 30 minutos antes de la entrada programada y se renuevan cada 10 minutos según la zona horaria de la empresa. Se detienen al registrar la entrada o al terminar el horario programado si no hubo entrada.
- Para la entrada, el trabajador usa su número, PIN y el QR vigente. Puede mostrar la imagen al checador o escribir el código que figura en el mensaje. El escaneo por cámara requiere HTTPS en producción.
- Para la salida, ingresa su número y PIN y usa el mismo QR que se aceptó en la entrada. Sigue sirviendo para esa salida aunque hayan pasado más de diez minutos o el turno haya cruzado medianoche. Tras la salida, el QR queda consumido.

### Activar envíos

1. Aplica la migración 011 y configura `SUPABASE_SECRET_KEY` en el servidor. Genera un secreto aleatorio para `TURNO_QR_JOB_SECRET`. Configura al menos un proveedor con las variables de `.env.example`.
   - **Correo.** Configura `RESEND_API_KEY` y `TURNO_QR_FROM_EMAIL` con un remitente de tu dominio verificado en Resend. El QR se adjunta como PNG y el código también aparece en el cuerpo. [Documentación de Resend](https://resend.com/docs/api-reference/emails/send-email)
   - **WhatsApp.** Configura el token de Cloud API, ID del número de empresa, versión de Graph, nombre e idioma de la plantilla. Usa una plantilla aprobada con encabezado de imagen y una variable **posicional** `{{1}}` en el cuerpo para el código. Registra el número del trabajador con el prefijo internacional y su autorización para recibir mensajes. [WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview) · [Política de mensajes](https://business.whatsapp.com/policy/)
2. Si Turno corre en localhost, usa la tarea de la sección siguiente. Para una instalación publicada con HTTPS, habilita Supabase Cron, `pg_net` y Vault. Guarda la URL pública completa de la tarea y el mismo `TURNO_QR_JOB_SECRET` en Vault. Ejecuta estas dos llamadas una sola vez por proyecto. [Guía de programación de Supabase](https://supabase.com/docs/guides/functions/schedule-functions)

```sql
select vault.create_secret('https://turno.ejemplo.mx/api/qr-dispatch', 'turno_qr_dispatch_url');
select vault.create_secret('SUSTITUYE_POR_TURNO_QR_JOB_SECRET', 'turno_qr_job_secret');
```

3. Programa la tarea para revisar cada minuto qué trabajadores necesitan un QR. Las renovaciones siguen sus intervalos de diez minutos.

```sql
select cron.schedule('turno-qr-dispatch', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'turno_qr_dispatch_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'turno_qr_job_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
```

### Tarea de envío en localhost

Ejecuta `npm.cmd run dev` para iniciar Turno y `npm.cmd run qr:local` en otra terminal. La tarea llama al servidor local al arrancar y una vez por minuto mientras siga abierta. Tanto Turno como la tarea cargan el secreto de `.env.local`. Si Turno está en otro puerto, configura `TURNO_QR_LOCAL_PORT`. El envío de los correos se realiza desde la aplicación con Resend y la asistencia se guarda en Supabase aunque Turno corra en tu equipo.

## Ajustes de checadas

- En **Asistencias → Agregar jornada**, registra una entrada que se omitió y agrega la salida si ya la conoces. Para agregar una salida faltante o corregir las horas de una jornada existente, usa **Ajustar** en su fila. Las horas se capturan en la zona horaria de la empresa.
- El motivo es obligatorio. El historial conserva las horas de antes y después, la cuenta que hizo el ajuste y el momento del cambio. Cuando se agrega una jornada, el historial indica que no había un registro previo.
- El Administrador y el Líder pueden ajustar jornadas de su empresa. Se bloquean los ajustes que se superponen con otra jornada o cuyas checadas cambiaron mientras estaba abierto el formulario. Las horas actualizadas se usan en el panel, la detección de retardos y faltas y la exportación del corte.

`npm.cmd run typecheck` verifica TypeScript. `npm.cmd run build` genera la compilación de producción.
