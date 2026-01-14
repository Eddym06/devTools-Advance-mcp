# 🎯 Guía de Workflows - Custom Chrome MCP

## Problema Resuelto

Anteriormente, las IAs confundían las herramientas y usaban `execute_script + fetch()` en lugar de las herramientas correctas para replicar paquetes de red.

---

## ✅ Workflow Correcto: Capturar y Replicar Tráfico

### **Opción 1: TODO EN UN PASO** (Recomendado)

```javascript
// Herramienta: capture_click_and_resend
// Hace: Click → Captura → Navega → Replica automáticamente

capture_click_and_resend({
  clickSelector: 'a.globalnav-link-store',  // Botón a presionar
  returnUrl: 'https://www.apple.com',        // Página para volver
  urlPattern: '*'                            // Filtro de peticiones
})

// ✅ RESULTADO:
// - Hace clic en el botón
// - Captura TODO el tráfico de red
// - Vuelve a la página inicial
// - Replica el PRIMER paquete capturado
// - Devuelve la respuesta del servidor
```

**Cuándo usar:** Cuando quieres hacer todo de una vez sin pasos intermedios.

---

### **Opción 2: PASO A PASO** (Control granular)

#### Paso 1: Capturar tráfico

```javascript
// Herramienta: capture_network_on_action
capture_network_on_action({
  action: 'click',
  selector: 'a.globalnav-link-store',
  urlPattern: '*'
})

// ✅ RESULTADO:
// {
//   requests: [
//     { requestId: 'interception-job-1.0', url: '...', method: 'POST', ... },
//     { requestId: 'interception-job-2.0', url: '...', method: 'GET', ... }
//   ],
//   nextStep: "💡 To replay: resend_network_request({ requestId: 'interception-job-1.0' })",
//   warning: "⚠️ DO NOT use execute_script+fetch() to replay"
// }
```

#### Paso 2: Navegar de vuelta (opcional)

```javascript
// Herramienta: browser_action
browser_action({
  action: 'navigate',
  url: 'https://www.apple.com'
})
```

#### Paso 3: Activar herramientas avanzadas

```javascript
// Herramienta: show_advanced_tools
show_advanced_tools()

// ✅ RESULTADO:
// {
//   message: 'Advanced tools unlocked',
//   keyTools: [
//     'resend_network_request - REPLAY CAPTURED PACKETS (use this!)',
//     ...
//   ],
//   hint: 'resend_network_request is NOW AVAILABLE'
// }
```

#### Paso 4: Replicar el paquete

```javascript
// Herramienta: resend_network_request (ahora disponible)
resend_network_request({
  requestId: 'interception-job-1.0'  // Del paso 1
})

// ✅ RESULTADO:
// {
//   success: true,
//   replayResult: {
//     status: 200,
//     bodyPreview: '...'
//   },
//   hint: '✅ Packet resent with preserved authentication'
// }
```

**Cuándo usar:** Cuando necesitas inspeccionar los paquetes capturados antes de replicarlos, o quieres modificar headers/body.

---

## ❌ LO QUE NO DEBES HACER

### ❌ NO uses `execute_script` + `fetch()`

```javascript
// ❌ MAL - Esto rompe autenticación y CORS
execute_script({
  script: `
    return fetch('https://api.example.com', {
      method: 'POST',
      body: '...'
    });
  `
})

// ✅ BIEN - Usa la herramienta correcta
resend_network_request({ requestId: 'xxx' })
```

**Por qué:** `execute_script + fetch()` no preserva:
- Cookies de sesión
- Headers de autenticación
- Contexto de origen (CORS)
- Estado del navegador

---

## 🔍 Validación Automática

El sistema ahora **detecta y bloquea** el uso incorrecto:

```javascript
execute_script({
  script: "return fetch('...', { method: 'POST' })"
})

// ❌ RESPUESTA:
// {
//   error: "Use resend_network_request to replay captured packets",
//   suggestion: "capture_network_on_action → resend_network_request",
//   hint: "execute_script+fetch() breaks authentication and CORS"
// }
```

---

## 📊 Comparación de Métodos

| Método | Preserva Auth | Preserva CORS | Pasos | Recomendado |
|--------|---------------|---------------|-------|-------------|
| `capture_click_and_resend` | ✅ | ✅ | 1 | ⭐⭐⭐ |
| `capture_network_on_action` + `resend_network_request` | ✅ | ✅ | 4 | ⭐⭐ |
| `execute_script` + `fetch()` | ❌ | ❌ | 1 | ❌ No usar |

---

## 🎓 Ejemplos de Uso Correcto

### Ejemplo 1: Replicar petición de login

```javascript
capture_click_and_resend({
  clickSelector: 'button[type="submit"]',
  returnUrl: 'https://example.com',
  urlPattern: '*api/login*'
})
```

### Ejemplo 2: Capturar y modificar petición

```javascript
// Paso 1: Capturar
const result = capture_network_on_action({
  action: 'click',
  selector: '#submit-button',
  urlPattern: '*api*'
})

// Paso 2: Activar avanzadas
show_advanced_tools()

// Paso 3: Replicar con modificaciones
resend_network_request({
  requestId: result.requests[0].requestId,
  customHeaders: { 'X-Custom-Header': 'value' },
  customBody: '{"modified": true}'
})
```

---

## 🚀 Herramientas por Categoría

### 🎯 Smart Workflows (Visibles por defecto)
- `capture_network_on_action` - Captura tráfico en una acción
- `capture_click_and_resend` - Todo en un paso
- `navigate_and_extract_content` - Navega y extrae contenido
- `test_api_endpoint` - Prueba endpoints API

### 🔧 Control
- `show_advanced_tools` - Desbloquea 50 herramientas avanzadas
- `hide_advanced_tools` - Oculta herramientas avanzadas

### ⚙️ Advanced (Requieren `show_advanced_tools`)
- `start_capturing_network_requests` - Inicia captura manual
- `show_captured_network_traffic` - Lista peticiones capturadas
- `resend_network_request` - **REPLICA PAQUETES** ⭐
- `modify_network_request` - Modifica antes de enviar
- `block_network_request` - Bloquea peticiones
- `stop_capturing_network_requests` - Detiene captura

---

## 💡 Tips para IAs

1. **Siempre usa `capture_click_and_resend` primero** - Es la solución más simple
2. **Si necesitas control granular**, usa el workflow paso a paso
3. **NUNCA uses `execute_script + fetch()`** para replicar tráfico
4. **Activa herramientas avanzadas** antes de usar `resend_network_request`
5. **Lee los mensajes `nextStep`** - te dicen exactamente qué hacer

---

## 🐛 Debugging

Si `resend_network_request` no está disponible:
1. ✅ Verifica que llamaste `show_advanced_tools()`
2. ✅ Verifica que el requestId es correcto (del resultado de capture)
3. ✅ El mensaje de `show_advanced_tools` debe mencionar que `resend_network_request` está disponible

---

**Última actualización:** 11 de enero de 2026
