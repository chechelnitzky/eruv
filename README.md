# Eruv La Dehesa

PWA para visualizar, revisar y monitorear el Eruv de La Dehesa.

## Roles

- **Guest:** puede ver el mapa, el estado general y el estado de cada pórtico. No puede reportar alertas ni realizar revisiones.
- **Usuario pendiente:** cuenta creada, a la espera de aprobación del administrador.
- **Usuario aprobado:** puede reportar alertas y realizar revisiones semanales.
- **Administrador:** aprueba usuarios, administra pórticos, alertas y ciclos de revisión.

## Stack previsto

- React + Vite + TypeScript
- Leaflet para el mapa interactivo
- Supabase Auth + Postgres + RLS
- Cloudflare Pages (`*.pages.dev`)
- PWA / Web Push en una etapa posterior

## Flujo semanal

La revisión semanal se habilita los jueves a las 13:00 en zona horaria `America/Santiago`. El Eruv solo se declara OK cuando todos los pórticos activos fueron revisados satisfactoriamente en el ciclo vigente y no existen alertas abiertas que invaliden el estado.

## Mapa

El mapa definitivo se reconstruirá a partir del Google My Maps existente, usando coordenadas precisas del trazado y de cada pórtico. El pantallazo inicial se usará solo como referencia visual aproximada.
