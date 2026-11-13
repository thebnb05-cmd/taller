# TH3 BNB Servicio Técnico

Sistema integral de gestión para talleres de reparación de celulares, tablets, notebooks, consolas y electrónica, con sincronización en tiempo real mediante **Firebase Firestore**, autenticación con Google (**Firebase Authentication**), seguimiento público para clientes y soporte **PWA** (instalable en celulares, tablets y escritorio).

## Características principales

- **Autenticación real con Firebase Authentication**: Acceso seguro con Google (`signInWithPopup` + `onAuthStateChanged`), sin usuarios hardcodeados ni contraseñas simuladas.
- **Base de datos en tiempo real con Cloud Firestore**: Consultas en vivo con `onSnapshot`, escritura atómica con `writeBatch`, esquema documentado en `firebase-blueprint.json` y reglas de seguridad Zero-Trust en `firestore.rules`.
- **Reparaciones y Check-In adaptativo**: Wizard de 2 pasos según tipo de equipo, estado físico/funcional, patrón de desbloqueo interactivo en Canvas, asignación de repuestos con descuento de stock, edición rápida, boleta imprimible y enlace público de seguimiento (`/?track=CODIGO`) sin exposición de PII.
- **Clientes, Productos e Inventario**: Ficha de cliente con historial, alta/edición de productos con cálculo automático de ganancia/IVA/redondeo, escaneo de código de barras con cámara o lector USB, e importación masiva desde Excel (`.xlsx`) o `.csv`.
- **Agenda, Proveedores, Ventas, Compras y Reportes**: Control de tareas, cuentas de proveedores, ventas con descuento de stock, compras y reportes por rango de fechas.

## Configuración local

1. Instalá las dependencias:

```bash
npm install
```

2. Verificá que `firebase-applet-config.json` contenga la configuración pública de tu proyecto de Firebase y que las reglas de `firestore.rules` estén desplegadas en tu base de datos.

3. Iniciá el entorno de desarrollo:

```bash
npm run dev
```

## Despliegue en Vercel desde GitHub

1. Subí este repositorio a GitHub.
2. Importá el repositorio en [Vercel](https://vercel.com).
3. En **Firebase Console → Authentication → Settings → Authorized domains**, agregá tu dominio de producción de Vercel (por ejemplo `tu-taller.vercel.app`) para habilitar el inicio de sesión con Google.
4. Desplegá (`npm run build` / `dist` ya configurados en `vercel.json`).
