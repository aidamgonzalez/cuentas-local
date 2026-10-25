# Cuentas del Local

App para llevar la inversión en el local comercial de Aida y Maria: presupuesto, aportes de cada socia, gastos de obra, facturas escaneadas y reparto de los ingresos del alquiler.

- **Página:** GitHub Pages (este repositorio). Se instala en el celular como app.
- **Datos, facturas y usuarios:** Supabase. Los datos **no** se guardan en este repositorio.

## Puesta en marcha

La app usa el mismo proyecto de Supabase del sistema de hospedaje. Sus tablas empiezan por `inv_` y sus facturas van en la carpeta `inv-facturas`, así que no se mezclan con hospedaje.

1. En Supabase, abre el proyecto de hospedaje.
2. En **SQL Editor → New query**, pega todo `supabase.sql` y toca **Run**.
3. En **Authentication → URL Configuration → Redirect URLs**, agrega `https://aidamgonzalez.github.io/cuentas-local/` (no cambies la Site URL).
4. Revisa que en **Authentication → Sign In / Providers → Email** esté desactivado **Confirm email**.
5. `supabase-config.js` ya tiene la Project URL y la clave publishable de ese proyecto.
6. En GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.
7. Abre la app, toca **Primera vez: crear mi clave** con tu correo y entra.
8. En **Socias y reglas → Respaldo → Importar respaldo**, carga el archivo `.json` de respaldo.
9. En **Socias y reglas → Acceso a la app**, agrega el correo de cada socia.

## Instalar en el celular

- **iPhone (Safari):** abre el enlace → botón Compartir → **Agregar a pantalla de inicio**.
- **Android (Chrome):** abre el enlace → menú ⋮ → **Instalar app** o **Agregar a pantalla principal**.

## Bueno saber

- Solo los correos de **Acceso a la app** pueden entrar.
- Un proyecto gratuito de Supabase se pausa si pasa una semana sin uso. Si la app no carga, entra a supabase.com y toca **Restore project**.
- Descarga un respaldo de vez en cuando desde **Socias y reglas → Respaldo**.
