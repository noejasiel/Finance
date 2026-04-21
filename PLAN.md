# Plan Completo — Finance App v2

> Revisión pendiente antes de implementar.

---

## 1. Cambios al Schema (Prisma)

```prisma
model User {
  // Campos nuevos:
  name            String?
  email           String?  @unique
  role            String   @default("user")   // "user" | "admin"
  onboardingStep  String   @default("name")   // "name" | "done"
}
```

Migración: `pnpm db:push` — no rompe datos existentes.

---

## 2. Flujo WhatsApp — Onboarding nuevo usuario

Cuando el bot recibe el primer mensaje de un número nuevo:

```
Nuevo usuario escribe cualquier cosa
  → Bot: "👋 ¡Hola! Soy tu asistente de finanzas.
           ¿Cómo te llamas?"

Usuario responde: "Luis"
  → Bot: "¡Listo, Luis! 💰 Ya puedes registrar gastos e ingresos.
           Escribe *ayuda* para ver cómo funciono.
           
           También puedes ver tus finanzas en la web:
           👉 https://tu-dominio.com"

A partir de aquí flujo normal.
```

**Cambios en código:**
- `flow.ts` — nuevo intent `onboarding_name`
- `user.ts` — `findOrCreateUser` devuelve `onboardingStep`
- `client.ts` — antes de `detectBasicIntent`, verificar si `onboardingStep !== "done"`

---

## 3. Respuesta consistente del bot al registrar

Toda confirmación de gasto/ingreso usará esta estructura fija:

```
💸 Gasto registrado          (o 💰 Ingreso registrado)
━━━━━━━━━━━━━━━━━━━━
  $35.00 MXN
  🍔 Comida  ·  café

📊 Este mes: $1,235.00 en gastos

_Escribe "borra el último" para deshacer._
```

**Cambio en código:** `transaction.ts → buildTransactionConfirmation()`

---

## 4. Backend — Endpoints nuevos para la web

### Auth (OTP por WhatsApp)
```
POST /api/v1/auth/request-otp   { phone }
  → Genera código 6 dígitos, lo manda por WhatsApp vía bot
  → Guarda en LoginChallenge (ya existe en schema)

POST /api/v1/auth/verify-otp    { phone, code }
  → Verifica código, devuelve JWT en cookie httpOnly
  → Crea sesión

POST /api/v1/auth/logout
  → Limpia cookie
```

### Dashboard usuario
```
GET /api/v1/me/summary          → totales del mes + balance
GET /api/v1/me/transactions     → lista paginada con filtros
GET /api/v1/me/chart            → datos agrupados por semana/mes
GET /api/v1/me/categories       → gastos por categoría del mes
DELETE /api/v1/me/transactions/:id
PATCH  /api/v1/me/transactions/:id
```

### Admin (requiere role: admin)
```
GET /api/v1/admin/stats         → usuarios totales, activos, mensajes hoy
GET /api/v1/admin/users         → lista de usuarios con métricas
GET /api/v1/admin/users/:id     → detalle de usuario
GET /api/v1/admin/activity      → mensajes por día (últimos 30 días)
```

---

## 5. Frontend — Rutas (Next.js App Router)

```
/                   → Redirige a /login si no hay sesión, o a /dashboard
/login              → Pantalla OTP
/dashboard          → Dashboard principal usuario
/dashboard/transactions → Lista completa de transacciones
/admin              → Dashboard admin (solo role: admin)
/admin/users        → Tabla de usuarios
/admin/users/[id]   → Detalle de usuario
```

---

## 6. Páginas — Detalle de cada vista

### `/login`
- Fondo negro con partículas sutiles (canvas animado, futurista)
- Logo "Financial Noir" centrado con glow verde
- Input teléfono → botón "Enviarme código"
- Input OTP (6 cajas individuales, autofocus entre ellas)
- Animación: el form entra con `spring` desde abajo
- Estado de carga: botón con spinner + shimmer en inputs

---

### `/dashboard`

**Layout:** Sidebar fijo izquierda + contenido principal

**Sidebar (glassmorphism):**
- Logo + tagline
- Nav: Dashboard, Transacciones, (Admin si aplica)
- Footer: avatar + nombre + logout
- En móvil: se colapsa en bottom nav bar

**Header flotante:**
- Breadcrumb dinámico
- Búsqueda rápida
- Avatar usuario

**Tarjetas resumen (fila de 3):**
- 💸 Gastos del mes — monto grande, delta vs mes anterior
- 💰 Ingresos del mes — monto grande, delta
- 📊 Balance — verde/rojo según positivo/negativo
- Cada tarjeta tiene sparkline (mini gráfica de tendencia, sin ejes)
- Animación: entran en stagger con `spring` desde abajo

**Gráfica semanal:**
- Barras: gastos (rojo) vs ingresos (verde) por semana
- Librería: Recharts (ya está en el ecosistema Next.js)
- Filtros: Este mes / Mes anterior / Últimos 3 meses
- Animación: barras crecen desde 0 al montar con `easeOut`

**Grid inferior (2 columnas):**

Izquierda — Gastos por categoría:
- Ícono + nombre + monto + barra de progreso animada
- Top 5 del mes
- Card "Tip del mes" generado por IA (un insight simple)

Derecha — Últimas transacciones:
- Tabla: ícono categoría + descripción + monto + fecha
- Últimas 8 transacciones
- Botón "Ver todas" → va a `/dashboard/transactions`
- Hover en fila: background cambia suavemente
- Animación: filas entran en stagger con delay

---

### `/dashboard/transactions`

- Filtros: rango de fechas, tipo (gasto/ingreso), categoría
- Tabla paginada (20 por página)
- Columnas: descripción, categoría, monto, fecha, acciones
- Acciones por fila: editar (modal) / eliminar (soft delete con undo)
- Selección múltiple para eliminar en bulk
- Botón exportar CSV
- Estado vacío con ilustración
- Animación: tabla entra con fade, filas en stagger

---

### `/admin`

**Tarjetas resumen (fila de 4):**
- 👥 Usuarios totales
- ✅ Activos este mes (al menos 1 transacción)
- 💬 Mensajes procesados hoy
- 💰 Volumen total registrado

**Gráfica de actividad:**
- Línea: mensajes recibidos por día (últimos 30 días)
- Área bajo la curva con gradiente verde
- Animación: línea se dibuja de izquierda a derecha

---

### `/admin/users`

- Tabla de usuarios: nombre, teléfono, fecha registro, último msg, movimientos este mes, balance del mes
- Click en fila → panel lateral deslizable (drawer) con:
  - Últimas 5 transacciones del usuario
  - Mini gráfica de su mes
- Ordenable por columna
- Buscador por nombre/teléfono
- Animación: drawer entra desde la derecha con `spring`

---

## 7. Animaciones — Estrategia con Framer Motion

### Globales (en layout)
```tsx
// Page transitions — fade + slide hacia arriba
<motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -8 }}
  transition={{ duration: 0.25, ease: "easeOut" }}
/>
```

### Tarjetas (stagger)
```tsx
// Contenedor
<motion.div variants={containerVariants} initial="hidden" animate="show">
  // Cada card
  <motion.div variants={{ hidden: { opacity:0, y:20 }, show: { opacity:1, y:0 } }} />
</motion.div>
```

### Números (counter animado)
```tsx
// Los montos en las tarjetas cuentan desde 0 hasta el valor real
// Usando useMotionValue + useTransform de Framer Motion
```

### Barras de progreso (categorías)
```tsx
// Ancho va de 0% al valor real al montar
<motion.div
  initial={{ width: 0 }}
  animate={{ width: `${pct}%` }}
  transition={{ duration: 0.8, ease: "easeOut", delay: index * 0.1 }}
/>
```

### Interacciones
- Botones: `whileTap={{ scale: 0.97 }}`
- Cards: `whileHover={{ y: -2 }}`
- Sidebar items: `whileHover={{ x: 4 }}`

### OTP inputs
- Cada caja vibra suavemente si el código es incorrecto (`shake` animation)
- Check verde animado al verificar correctamente

---

## 8. Estilo — Ajustes sobre DESIGN.md

Aplicar encima del sistema de diseño existente:

```css
/* Border radius más pronunciado */
--radius-card: 1.5rem;     /* cards principales */
--radius-inner: 1rem;      /* elementos dentro de cards */
--radius-btn: 0.875rem;    /* botones */
--radius-input: 0.75rem;   /* inputs */

/* Toque futurista */
/* Ghost border con glow en cards activos */
box-shadow: 0 0 0 1px rgba(75, 226, 119, 0.08),
            0 20px 40px rgba(0,0,0,0.4);

/* Gradiente sutil en fondos de sección */
background: linear-gradient(135deg, #1C1B1B 0%, #181717 100%);

/* Línea de acento izquierda en secciones (ya está en AGENT.txt) */
border-left: 2px solid #4BE277;
```

---

## 9. Stack tecnológico nuevo (frontend)

```
framer-motion       → animaciones
recharts            → gráficas
jose                → JWT (firmar/verificar tokens)
date-fns            → formateo de fechas
```

No se agrega nada más. El resto ya está (Next.js 15, Tailwind, shadcn/ui).

---

## 10. Orden de implementación

| # | Tarea | Dónde |
|---|---|---|
| 1 | Schema: name, email, role, onboardingStep | Prisma |
| 2 | Onboarding WhatsApp (pedir nombre) | Backend |
| 3 | Formato consistente de respuesta | Backend |
| 4 | Endpoints auth (OTP) | Backend |
| 5 | Endpoints dashboard + admin | Backend |
| 6 | `/login` con OTP | Frontend |
| 7 | Layout (sidebar + header) con animaciones | Frontend |
| 8 | `/dashboard` — tarjetas + gráfica + categorías + transacciones | Frontend |
| 9 | `/dashboard/transactions` — tabla completa | Frontend |
| 10 | `/admin` + `/admin/users` | Frontend |

---

*Revisar y confirmar antes de arrancar.*
