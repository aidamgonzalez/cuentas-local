# Cuentas del Local

App para llevar la inversión en el local comercial de Aida y Maria: presupuesto, aportes de cada socia, gastos de obra, facturas escaneadas y reparto de los ingresos del alquiler.

- **Página:** GitHub Pages (este repositorio). Se instala en el celular como app.
- **Datos, facturas y usuarios:** Supabase. Los datos **no** se guardan en este repositorio.

## Puesta en marcha

1. Crea un proyecto en [Supabase](https://supabase.com).
2. En **SQL Editor → New query**, pega todo `supabase.sql` y toca **Run**.
3. En **Authentication → Sign In / Providers → Email**, desactiva **Confirm email**.
4. En **Authentication → URL Configuration**, pon como **Site URL** `https://aidamgonzalez.github.io/cuentas-local/` y agrégala también en **Redirect URLs**.
5. Copia la **Project URL** y la clave **publishable** (Project Settings → API) en `supabase-config.js`.
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
