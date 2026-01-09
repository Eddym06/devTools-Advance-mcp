# Test Workflow - Verificación de Herramientas MCP

## 🎯 Escenario de Prueba del Usuario

**Prompt Original**: 
> "Navega a apple.com, luego presiona un botón e intercepta el tráfico de red, y que manda ese paquete, luego vuelve a la página inicial, y ejecuta el paquete que interceptaste y mandaselo a la página ver que hace"

---

## ✅ Secuencia CORRECTA Esperada

### Paso 1: Navegación
```
Tool: navigate
Input: { url: "https://apple.com" }
Reason: Usuario dice "navega a" - debe usar navigate, NO create_tab
```

**❌ INCORRECTO**: `create_tab({ url: "https://apple.com" })`
**✅ CORRECTO**: `navigate({ url: "https://apple.com" })`

---

### Paso 2: Esperar Carga
```
Tool: wait_for_load_state
Input: { state: "networkidle" }
Reason: Asegurar que la página cargó completamente antes de analizar
```

---

### Paso 3: Analizar Página (CRÍTICO)
```
Tool: get_html
Input: { tabId: "xxx" }
Reason: OBLIGATORIO antes de click - necesitamos ver qué botones existen
```

**⚠️ CRÍTICO**: La IA DEBE hacer este paso. Si salta directo a click, está mal.

Ejemplo de salida esperada:
```html
<button class="ac-gn-link-bag">Shopping Bag</button>
<a href="/shop" class="ac-gn-link">Shop</a>
<button id="ac-gn-menustate" class="ac-gn-menustate">Menu</button>
```

---

### Paso 4: Habilitar Interceptación
```
Tool: enable_response_interception
Input: { patterns: ["*"], tabId: "xxx" }
Reason: Usuario dice "intercepta el tráfico de red"
```

---

### Paso 5: Click en Botón
```
Tool: click
Input: { 
  selector: ".ac-gn-link-bag",  // Selector verificado del paso 3
  tabId: "xxx" 
}
Reason: Usuario dice "presiona un botón"
```

**❌ INCORRECTO**: click con selector adivinado sin get_html primero
**✅ CORRECTO**: click con selector verificado de get_html

---

### Paso 6: Listar Tráfico Interceptado
```
Tool: list_intercepted_responses
Input: { tabId: "xxx" }
Reason: Usuario dice "que manda ese paquete" - necesitamos ver qué se capturó
```

**Salida esperada**:
```json
{
  "interceptedResponses": [
    {
      "requestId": "ABC123.1",
      "url": "https://www.apple.com/shop/api/cart",
      "method": "GET",
      "responseStatusCode": 200
    },
    {
      "requestId": "ABC123.2", 
      "url": "https://www.apple.com/shop/api/products",
      "method": "GET",
      "responseStatusCode": 200
    }
  ],
  "count": 2
}
```

---

### Paso 7: Volver a Página Inicial
```
Tool: go_back
Input: { tabId: "xxx" }
Reason: Usuario dice "vuelve a la página inicial"
```

**Alternativa válida**: `navigate({ url: "https://apple.com" })`

---

### Paso 8: Modificar y Reenviar Paquete
```
Tool: modify_intercepted_response
Input: {
  requestId: "ABC123.1",  // De list_intercepted_responses
  modifiedBody: '{"modified": "data"}',
  tabId: "xxx"
}
Reason: Usuario dice "ejecuta el paquete que interceptaste y mandaselo a la página"
```

**Alternativa**: Si quiere simplemente reenviar sin modificar, usar `continue_intercepted_request`

---

## 🔴 Errores Detectados en la Ejecución Real

### Error #1: Uso de create_tab en vez de navigate
```
❌ INCORRECTO:
create_tab({ url: "https://apple.com" })

✅ CORRECTO:
navigate({ url: "https://apple.com" })

Razón: Usuario dice "navega a", no "abre nueva pestaña"
```

---

### Error #2: Click sin get_html previo
```
❌ INCORRECTO:
click({ selector: "a[href*='shop']" })  // Adivinando selector

✅ CORRECTO:
get_html() → Analizar HTML → click({ selector: ".verified-class" })

Razón: Workflow obligatorio: analizar ANTES de interactuar
```

---

### Error #3: IA dice que no encuentra list_intercepted_responses
```
Mensaje de error de la IA:
"Las herramientas disponibles no incluyen una función para listar las 
solicitudes interceptadas"

REALIDAD: La herramienta SÍ existe!

Herramienta: list_intercepted_responses
Ubicación: src/tools/advanced-network.ts línea 155
Descripción: "📋 STEP 2 of interception workflow..."

Posibles causas:
1. IA no está leyendo bien las descripciones
2. IA busca nombre diferente ("list_intercepted_requests" vs "list_intercepted_responses")
3. Sistema de "activación" confuso (IA dice "necesito activar las herramientas")
```

---

### Error #4: IA intenta "activar" herramientas
```
Mensaje de IA:
"Necesito activar las herramientas de inspección de red"

PROBLEMA: No hay sistema de activación en el código!
Todas las herramientas están siempre disponibles.

Solución aplicada:
- Eliminadas referencias a "activación" en descripciones
- Todas las tools están en allTools[] desde el inicio
- No hay lazy loading ni activación
```

---

## 🧪 Cómo Probar Manualmente

### Test 1: Verificar que navigate funciona
```bash
# En VS Code, pedir a la IA:
"Usa el MCP custom-chrome para navegar a google.com"

# Verificar que usa:
✅ navigate({ url: "https://google.com" })
❌ create_tab({ url: "https://google.com" })
```

---

### Test 2: Verificar workflow de análisis
```bash
# Pedir:
"Navega a example.com y haz click en el primer link"

# Secuencia esperada:
1. navigate
2. wait_for_load_state
3. get_html  ← CRÍTICO: Debe estar aquí
4. click con selector del HTML
```

---

### Test 3: Verificar interception workflow
```bash
# Pedir:
"Navega a httpbin.org/get e intercepta el tráfico"

# Secuencia esperada:
1. navigate({ url: "https://httpbin.org/get" })
2. enable_response_interception
3. wait_for_load_state
4. list_intercepted_responses  ← DEBE aparecer!

# Si la IA dice "no encuentro la herramienta", HAY UN BUG
```

---

### Test 4: Verificar que list_intercepted_responses existe
```bash
# Comando manual para verificar:
npm run build
node dist/index.js  # Iniciar MCP server

# En el cliente MCP, listar tools y buscar:
- enable_response_interception ✓
- list_intercepted_responses ✓
- modify_intercepted_response ✓
- disable_response_interception ✓

# Todos deben aparecer!
```

---

## 📊 Checklist de Verificación

- [ ] navigate se usa para "navega a", NO create_tab
- [ ] get_html se ejecuta ANTES de click/type
- [ ] wait_for_load_state se ejecuta después de navigate
- [ ] enable_response_interception está disponible
- [ ] list_intercepted_responses está disponible (NO dice "necesito activar")
- [ ] modify_intercepted_response funciona con requestId válido
- [ ] Workflow completo funciona: navigate → analyze → interact → intercept
- [ ] IA no adivina selectores, los obtiene de get_html

---

## 🔧 Herramientas Actualizadas

### Descripciones Mejoradas:

1. **navigate**: Ahora indica claramente que es la PRIMARY NAVIGATION TOOL
2. **create_tab**: Ahora dice explícitamente "DO NOT USE for simple navigation"
3. **click**: Workflow obligatorio con get_html previo
4. **type**: Prerequisito de get_html
5. **enable_response_interception**: Workflow completo 1-2-3-4
6. **list_intercepted_responses**: Marcado como STEP 2 del workflow
7. **modify_intercepted_response**: Marcado como STEP 3 con ejemplo

---

## 💡 Próximos Pasos

Si los errores persisten:

1. **Verificar MCP Client**: El cliente que usa VS Code puede tener cache
2. **Reiniciar MCP Server**: Forzar reload del servidor
3. **Verificar package.json**: Asegurar que apunta a dist/index.js
4. **Logs del servidor**: Ver si las tools se registran correctamente
5. **Test con cliente MCP puro**: Eliminar VS Code de la ecuación

---

## 📝 Cambios Aplicados en Este Fix

| Archivo | Línea | Cambio |
|---------|-------|--------|
| navigation.ts | 13 | navigate: "PRIMARY NAVIGATION TOOL" con emojis |
| navigation.ts | 175 | create_tab: "DO NOT USE for simple navigation" |
| interaction.ts | 13 | click: "CRITICAL WORKFLOW: get_html FIRST" |
| interaction.ts | 71 | type: "PREREQUISITE: get_html FIRST" |
| capture.ts | 12 | screenshot: "WHEN TO USE" con casos |
| capture.ts | 70 | get_html: "CRITICAL ANALYSIS TOOL" obligatorio |
| advanced-network.ts | 56 | enable_response_interception: "START HERE" con workflow |
| advanced-network.ts | 156 | list_intercepted_responses: "STEP 2" con énfasis |
| advanced-network.ts | 213 | modify_intercepted_response: "STEP 3" con ejemplo |

---

**Resultado esperado**: La IA debe seguir el workflow correcto en todos los casos y NUNCA decir que no encuentra una herramienta que existe.
