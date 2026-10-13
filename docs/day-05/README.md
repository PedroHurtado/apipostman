# Día 5 — Tests avanzados y Collection Runner

**Martes 13 de octubre · 15:30–19:00**

| Bloque | Duración | Contenido |
|---|---|---|
| M5 (2ª parte) | 1h30 | Validación con JSON Schema, arrays y propiedades anidadas, encadenamiento de variables entre requests |
| Descanso | 10 min | |
| M5 (cont.) | 1h10 | Flujo de autenticación automático, tests de errores (400, 401, 404, 409, 422), organización de los tests por niveles |
| M6 (1ª parte) | 40 min | Collection Runner: orden de ejecución, iteraciones, avance de los data files |

**Objetivo del día:** convertir la colección en una **suite de regresión** que se ejecute de principio a fin con un clic y deje la base de datos como estaba.

---

## 1. Validar el esquema de la respuesta (JSON Schema)

Comprobar campo a campo es tedioso. Un **JSON Schema** describe la forma completa del JSON y la valida en una sola aserción.

```javascript
const ingredienteSchema = {
    type: "object",
    required: ["id", "name", "cost", "vegetarian"],
    properties: {
        id:         { type: "integer", minimum: 1 },
        name:       { type: "string", minLength: 1, maxLength: 60 },
        cost:       { type: "number", exclusiveMinimum: 0 },
        vegetarian: { type: "boolean" }
    },
    additionalProperties: false
};

const pizzaSchema = {
    type: "object",
    required: ["id", "name", "vegetarian", "ingredients", "ingredientsCost", "profitMargin", "price"],
    properties: {
        id:              { type: "integer" },
        name:            { type: "string" },
        description:     { type: ["string", "null"] },
        vegetarian:      { type: "boolean" },
        ingredients:     { type: "array", minItems: 1, items: ingredienteSchema },
        ingredientsCost: { type: "number" },
        profitMargin:    { type: "number" },
        price:           { type: "number" }
    }
};

pm.test("La pizza cumple el esquema", () => {
    pm.response.to.have.jsonSchema(pizzaSchema);
});
```

`pm.response.to.have.jsonSchema` usa internamente **Ajv**, el validador de JSON Schema más extendido en JavaScript. Si necesitas controlar las opciones, por ejemplo ver *todos* los errores a la vez, puedes usarlo directamente:

```javascript
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(pizzaSchema);

pm.test("Esquema válido (Ajv)", () => {
    const ok = validate(pm.response.json());
    pm.expect(ok, JSON.stringify(validate.errors, null, 2)).to.be.true;
});
```

> **¿Y tv4?** Muchos ejemplos antiguos usan `tv4.validate(...)`. tv4 está **obsoleto** en Postman y solo soporta borradores antiguos de JSON Schema. Usa `jsonSchema` o Ajv.

> **De dónde sacar el esquema:** cópialo de `components.schemas` del contrato OpenAPI (http://localhost:8080/v3/api-docs). Así el test valida exactamente lo que promete el contrato. Guárdalo en una variable de colección (`pizzaSchema`) para reutilizarlo: `JSON.parse(pm.collectionVariables.get("pizzaSchema"))`.

## 2. Arrays: longitud, elementos y propiedades anidadas

En **Listar pizzas**:

```javascript
const pizzas = pm.response.json();

pm.test("Devuelve un array no vacío", () => {
    pm.expect(pizzas).to.be.an("array").that.is.not.empty;
});

pm.test("Contiene la Margarita", () => {
    const nombres = pizzas.map(p => p.name);
    pm.expect(nombres).to.include("Margarita");
});

pm.test("Ordenadas alfabéticamente por nombre", () => {
    const nombres = pizzas.map(p => p.name);
    const ordenados = [...nombres].sort((a, b) => a.localeCompare(b));
    pm.expect(nombres).to.eql(ordenados);
});

pm.test("Todas las pizzas cumplen la regla del precio", () => {
    pizzas.forEach(p => {
        const esperado = Math.round(p.ingredientsCost * 1.2 * 100) / 100;
        pm.expect(p.price, p.name).to.be.closeTo(esperado, 0.001);
    });
});

pm.test("Todas llevan masa (propiedad anidada)", () => {
    pizzas.forEach(p => {
        const ingredientes = p.ingredients.map(i => i.name);
        pm.expect(ingredientes, p.name).to.include("Masa");
    });
});
```

En **Listar pizzas vegetarianas con precio máximo** (`?vegetarian=true&maxPrice=8`):

```javascript
pm.test("El filtro se respeta en cada elemento", () => {
    const pizzas = pm.response.json();
    pm.expect(pizzas).to.have.lengthOf.at.least(1);
    pm.expect(pizzas.every(p => p.vegetarian && p.price <= 8)).to.be.true;
    // Una pizza vegetariana no puede tener ningún ingrediente no vegetariano
    pizzas.forEach(p => p.ingredients.forEach(i => pm.expect(i.vegetarian, `${p.name} → ${i.name}`).to.be.true));
});
```

Las funciones de array de JavaScript (`map`, `filter`, `find`, `some`, `every`, `reduce`) son tus mejores aliadas. Pasar un segundo argumento a `pm.expect(valor, "mensaje")` hace que el fallo diga **qué elemento** ha fallado.

## 3. Encadenamiento de variables entre requests

Un flujo completo de negocio, donde cada paso usa lo que produjo el anterior:

```
1. Login                               → guarda token
2. Crear ingrediente "Trufa"           → guarda ingredientId
3. Crear pizza con Masa, Tomate, Trufa → guarda pizzaId y precioInicial
4. Subir el coste de la trufa en 1 €   (PUT ingrediente)
5. Obtener pizza                       → price == precioInicial + 1,20
6. Borrar ingrediente                  → 409 (lo usa una pizza)
7. Borrar pizza                        → 204
8. Borrar ingrediente                  → 204
9. Obtener pizza                       → 404
```

Paso 3, *Post-response*:

```javascript
const pizza = pm.response.json();
pm.collectionVariables.set("pizzaId", pizza.id);
pm.collectionVariables.set("precioInicial", pizza.price);
```

Paso 5, *Post-response*:

```javascript
pm.test("El precio refleja el nuevo coste del ingrediente (+1 € × 1,20)", () => {
    const inicial = Number(pm.collectionVariables.get("precioInicial"));
    pm.expect(pm.response.json().price).to.be.closeTo(inicial + 1.20, 0.001);
});
```

> Recuerda que las variables se guardan como **texto**: usa `Number(...)` antes de operar con ellas.

**Nombres únicos:** para que el flujo se pueda repetir sin chocar con el 409, genera el nombre en el pre-request del paso 2:

```javascript
pm.collectionVariables.set("ingredientName", `Trufa ${Date.now()}`);
```

**Limpieza:** un buen flujo **deja los datos como estaban** (pasos 7 y 8). Así se puede ejecutar contra un entorno compartido tantas veces como haga falta.

## 4. Flujo de autenticación automático

### 4.1 Opción A: una request de login al principio

La carpeta *Auth → Login* va la primera, y su script guarda el token (día 3). Es simple y visible, pero obliga a ejecutar siempre la colección entera desde el principio.

### 4.2 Opción B: login transparente con `pm.sendRequest` en el pre-request de la colección

```javascript
// Pre-request de la COLECCIÓN: se ejecuta antes de cada request
const url = pm.request.url.toString();
if (url.includes("/api/auth/")) return;           // no lo hagas para las propias requests de auth

const token = pm.environment.get("token");
const expira = Number(pm.environment.get("tokenExpiresAt") || 0);

if (!token || Date.now() > expira - 10_000) {      // margen de 10 s
    pm.sendRequest({
        url: pm.variables.replaceIn("{{baseUrl}}/api/auth/login"),
        method: "POST",
        header: { "Content-Type": "application/json" },
        body: {
            mode: "raw",
            raw: JSON.stringify({
                username: pm.variables.get("username"),
                password: pm.variables.get("password")
            })
        }
    }, (err, res) => {
        if (err || res.code !== 200) {
            console.error("Login automático fallido", err || res.text());
            return;
        }
        const body = res.json();
        pm.environment.set("token", body.accessToken);
        pm.environment.set("refreshToken", body.refreshToken);
        pm.environment.set("tokenExpiresAt", Date.now() + body.expiresIn * 1000);
        console.log("🔑 Login automático correcto");
    });
}
```

Con esto, **cualquier request funciona aunque la ejecutes suelta**. En el día 6 la mejoraremos para que use el *refresh token* en lugar de repetir el login.

## 5. Tests de errores: validar que la API falla correctamente

Una API madura se nota en sus errores. Comprueba el código, el **formato** del error y que el mensaje sea útil.

Todas las respuestas de error de la Pizzería API tienen la misma forma:

```json
{
  "timestamp": "2026-10-13T14:00:00Z",
  "status": 400,
  "error": "Bad Request",
  "message": "La petición contiene datos no válidos",
  "path": "/api/ingredients",
  "errors": [ { "field": "cost", "message": "debe ser mayor que o igual a 0.01" } ]
}
```

| Caso | Request | Esperado |
|---|---|---|
| Campos inválidos | `POST /api/ingredients` con `{"name":"","cost":-1}` | **400** y `errors` con `name`, `cost` y `vegetarian` |
| JSON mal formado | `POST /api/ingredients` con `{"name": ` | **400** |
| Tipo inválido en la ruta | `GET /api/pizzas/abc` | **400** |
| Sin token | `POST /api/ingredients` con *Auth = No Auth* | **401** y cabecera `WWW-Authenticate: Bearer` |
| Token falso | `Authorization: Bearer inventado` | **401** |
| Credenciales incorrectas | `POST /api/auth/login` con una contraseña errónea | **401** |
| No existe | `GET /api/pizzas/999999` | **404** |
| Nombre duplicado | `POST /api/ingredients` con `"name":"Masa"` | **409** |
| Recurso en uso | `DELETE /api/ingredients/1` (la masa) | **409** |
| Regla de negocio | `POST /api/pizzas` con `"ingredientIds":[1, 999999]` | **422** y un mensaje que nombra el `999999` |

Ejemplo para el 400:

```javascript
const error = pm.response.json();

pm.test("400 Bad Request", () => pm.response.to.have.status(400));

pm.test("Formato de error estándar", () => {
    pm.expect(error).to.include.all.keys("timestamp", "status", "error", "message", "path", "errors");
    pm.expect(error.status).to.equal(400);
    pm.expect(error.path).to.equal("/api/ingredients");
});

pm.test("Informa de cada campo inválido", () => {
    const campos = error.errors.map(e => e.field);
    pm.expect(campos).to.include.members(["name", "cost", "vegetarian"]);
});
```

Y para el 422:

```javascript
pm.test("422 cuando un ingrediente no existe", () => {
    pm.response.to.have.status(422);
    pm.expect(pm.response.json().message).to.include("999999");
});
```

> **Regla de oro:** por cada request "feliz" de escritura debería haber al menos una request de error. Los errores son la parte del contrato que más se rompe sin que nadie se dé cuenta.

## 6. Organización de los tests: colección, carpeta y request

Los *post-response scripts* también existen a nivel de **colección** y de **carpeta**, y se ejecutan **antes** que los de la request. Úsalos para no repetir código:

| Nivel | Qué poner | Ejemplo |
|---|---|---|
| **Colección** | Lo que debe cumplirse siempre | Tiempo de respuesta, `Content-Type` JSON cuando hay body, formato estándar de los errores 4xx |
| **Carpeta** | Lo común a un recurso | En *Pizzas*: la regla del precio para cualquier pizza devuelta |
| **Request** | Lo específico del caso | "Devuelve la Margarita", "201 con Location" |

Post-response **de colección**:

```javascript
pm.test(`[global] ${pm.info.requestName} responde en menos de ${pm.variables.get("maxResponseTime") || 1000} ms`, () => {
    pm.expect(pm.response.responseTime).to.be.below(Number(pm.variables.get("maxResponseTime") || 1000));
});

if (pm.response.code >= 400 && pm.response.code < 500) {
    pm.test("[global] El error sigue el formato estándar", () => {
        const e = pm.response.json();
        pm.expect(e).to.include.all.keys("status", "error", "message", "path");
        pm.expect(e.status).to.equal(pm.response.code);
    });
}
```

**Más convenciones:**
- Nombra los tests como requisitos ("Devuelve 404 si la pizza no existe"), no como el código que ejecutan ("status check").
- Prefija los tests globales con `[global]` para distinguirlos en los informes.
- Si un mismo bloque de código lo necesitan varias colecciones, el **Package Library** del equipo permite reutilizarlo con `pm.require("@equipo/utilidades")`.

---

## 7. Collection Runner

`Colección → Run` (o el botón **Run** de la colección) abre el **Collection Runner**:

| Opción | Uso |
|---|---|
| **Orden** | Por defecto, el de la colección (de arriba abajo y carpeta a carpeta). Se puede reordenar arrastrando y desmarcar requests |
| **Iterations** | Cuántas veces se repite la ejecución completa |
| **Delay** | Pausa entre requests en ms. Útil si la API tiene *rate limit* |
| **Data file** | CSV o JSON con una fila por iteración (día 6) |
| **Persist responses for a session** | Guarda las respuestas para revisarlas. Desactívalo en ejecuciones grandes |
| **Run manually / Schedule / CLI** | Ejecutar ahora, programar en la nube, o generar el comando de Postman CLI |

### Controlar el flujo desde los scripts

```javascript
// Saltar a otra request por su nombre (solo en Runner / Newman)
pm.execution.setNextRequest("Borrar pizza");

// Terminar la ejecución
pm.execution.setNextRequest(null);

// En un pre-request: no enviar esta request
if (!pm.environment.get("pizzaId")) {
    pm.execution.skipRequest();
}
```

> En scripts antiguos verás `postman.setNextRequest(...)`. Es equivalente, pero está en desuso.

---

## 8. Mock servers, Specs y Copy link

### 8.1 Mock server: una API falsa que responde con tus ejemplos

Un **mock server** es una URL en la nube de Postman (`https://<id>.mock.pstmn.io`) que **no ejecuta lógica**. Recibe una request, busca entre los **ejemplos guardados** de la colección el que mejor encaja y lo devuelve tal cual.

**Para qué sirve:**

| Situación | Cómo ayuda el mock |
|---|---|
| El frontend o la app móvil empiezan antes de que exista el backend | Trabajan contra el mock con respuestas realistas desde el día 1 |
| Diseño *API-first* | Se acuerda el contrato, se mockea y se valida con los consumidores antes de programar |
| Errores difíciles de provocar en la API real | 500, 503, respuestas lentas, cuerpos raros: basta con guardar un ejemplo |
| Dependencias de terceros (pasarela de pago, envío de SMS…) | No gastas dinero ni dependes de su disponibilidad |
| Probar la propia colección de tests | Compruebas que tus tests detectan un 404 o un JSON mal formado sin romper la API |

**Paso a paso:**

1. **Guarda ejemplos.** En *Obtener pizza*, pulsa **Send** y luego **Save Response → Save as example**. Repite con una pizza que no existe para tener un ejemplo **404**. Un ejemplo se puede editar a mano: status, cabeceras y body.
2. **Crea el mock.** En la colección, **⋯ → Mock collection** (o **New → Mock server → Select an existing collection**).
   - **Name:** `Pizzería mock`.
   - **Environment:** opcional, solo si los ejemplos usan variables.
   - **Simulate a fixed network delay:** útil para probar *timeouts*.
   - **Make mock server private:** obliga a enviar la cabecera `x-api-key` con una API key de Postman.
3. **Copia la URL** del mock y crea un entorno `pizzeria-mock` con `baseUrl = https://<id>.mock.pstmn.io`.
4. **Cambia de entorno** y vuelve a lanzar las requests. Los tests que pasaban contra la API real deberían pasar contra el mock.

**Cómo elige el ejemplo (matching):** filtra por **método**, puntúa la **ruta** y los **query params**, y devuelve el ejemplo con mejor puntuación. Si hay empate, gana el que devuelve 200. Puedes forzar la elección con cabeceras:

| Cabecera | Efecto |
|---|---|
| `x-mock-response-code: 404` | Solo considera ejemplos con ese status |
| `x-mock-response-name: Pizza no encontrada` | Elige el ejemplo por su nombre |
| `x-mock-match-request-body: true` | Exige que el body de la request coincida con el del ejemplo |
| `x-mock-match-request-headers: true` | Exige que las cabeceras coincidan |

**Ejemplos dinámicos:** si en la URL del ejemplo escribes una variable que no existe, como `{{baseUrl}}/api/pizzas/{{pizzaId}}`, actúa de **comodín**. Captura cualquier id, y puedes devolverlo en el body del ejemplo con `"id": {{pizzaId}}`.

> **Límites:** el mock está en la nube, así que es público (salvo que lo hagas privado) y **no puede ver tu `localhost`**. El plan Free tiene un número limitado de llamadas al mock al mes (en el momento de escribir esto, unas 1.000). Consulta tu consumo en *Resource usage*.

### 8.2 Specs (Spec Hub): el contrato dentro de Postman

**Spec Hub** (barra lateral → **Specs**) es el lugar de Postman para escribir y mantener **especificaciones de API**: OpenAPI 2.0/3.0/3.1, AsyncAPI, protobuf, GraphQL y Smithy.

Una *spec* es el **contrato** de la API: qué endpoints hay, qué recibe cada uno, qué devuelve y con qué códigos. Una colección es *una forma de probar* ese contrato. El contrato manda.

| Para qué sirve | Detalle |
|---|---|
| **Fuente única de verdad** | Backend, frontend y QA trabajan contra el mismo documento |
| **Generar la colección** | **Generate collection** crea carpetas, requests y **ejemplos de respuesta**, que son la materia prima del mock server |
| **Mantenerla sincronizada** | Si cambia la spec, la colección generada se actualiza; también se pueden llevar cambios de la colección a la spec |
| **Validación y linting** | Marca errores de sintaxis y reglas de gobierno (nombres, descripciones, códigos de error documentados…) |
| **Documentación** | Vista previa de la documentación a partir de la spec |
| **Tests de contrato** | Los `components.schemas` son los JSON Schema que usamos en el apartado 1 |

**Con la Pizzería API:**

1. **Specs → Import** y pega `http://localhost:8080/v3/api-docs`, o importa el fichero descargado de esa URL.
2. Revisa los avisos del linter. Cada aviso es una pista de algo que el contrato no explica bien.
3. **Generate collection.** Compárala con la colección que has escrito a mano: ¿te falta algún endpoint o algún código de error?
4. Copia `components.schemas.PizzaResponse` a la variable `pizzaSchema` para los tests de esquema.

> Flujo *API-first* completo: **spec → colección generada (con ejemplos) → mock server → consumidores trabajando → implementación real → tests de contrato contra la API real.**

### 8.3 Copy link: compartir un elemento concreto con el equipo

En cualquier colección, carpeta, request o ejemplo hay un icono **Copy link** (también en **⋯ → Share**). Genera una URL de Postman que lleva a un compañero **exactamente a ese elemento**, dentro del workspace del equipo:

- "Mira esta request, falla con este body": pegas el enlace en Slack o en el ticket y el compañero la abre tal cual.
- Con **Share** puedes incluir el **entorno** seleccionado, e incluso la **respuesta** de la request (en requests creadas desde octubre de 2024).
- Si quien abre el enlace no es del equipo, se le pide **solicitar acceso** y un administrador lo aprueba.

**Por qué no lo veréis en clase:** el enlace solo tiene sentido dentro de un **workspace de equipo**. Desde el 1 de marzo de 2026 el plan **Free es de un único usuario**, así que la colaboración (workspaces compartidos, enlaces a elementos, comentarios) requiere un plan de pago de equipo.

**Alternativas en la versión gratuita:**
- **Exportar** la colección en v2.1 y compartir el fichero (día 4).
- **Versionarla en Git** junto al código (día 4). Es lo más profesional, porque la colección se revisa en las *pull requests* como cualquier otro fichero.
- Compartir el **comando de Newman / Postman CLI** que la ejecuta (día 6).

---

## 9. Práctica

1. Añade el esquema de la pizza a **Obtener pizza** y el de ingrediente a **Obtener ingrediente**. Rompe la API a propósito (pide `/api/pizzas` en una request con el esquema de *una* pizza) y lee el error.
2. Añade los tests de arrays del apartado 2 a **Listar pizzas** y **Listar pizzas vegetarianas**.
3. Crea la carpeta **Flujo de negocio** con los 9 pasos del apartado 3 y ejecútala con el Runner. Ejecútala **dos veces seguidas**: debe pasar las dos.
4. Mueve el login al pre-request de la colección (apartado 4.2). Borra `token` del entorno y lanza una request de escritura suelta: debe funcionar.
5. Crea la carpeta **Errores** con todos los casos de la tabla del apartado 5, cada uno con sus tests. Recuerda poner *No Auth* en los casos de 401.
6. Mueve a la colección los tests de tiempo y de formato de error, y quita los duplicados de las requests.
7. Lanza la colección completa en el Runner con 3 iteraciones y 100 ms de *delay*. Revisa los resultados y exporta el informe.
8. **Reto:** usa `pm.execution.setNextRequest` para que, si falla el login, la ejecución se detenga en lugar de producir 30 fallos en cascada.

La solución de referencia está en [../day-06/pizzeria-api-tests.postman_collection.json](../day-06/pizzeria-api-tests.postman_collection.json). Es la que ejecutaremos con Newman el día 6.

**Retos del día:** [RETOS.md](RETOS.md). Ábrelo con la vista previa de Markdown de VS Code (`Ctrl+Shift+V`) para desplegar las pistas y las soluciones.

---

## Recursos

- [Escribir tests (post-response scripts)](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/)
- [Ejemplos de tests, incluido JSON Schema](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-examples/)
- [Referencia del objeto `pm` (`pm.sendRequest`, `pm.execution`…)](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/overview/)
- [Chai — API BDD](https://www.chaijs.com/api/bdd/)
- [JSON Schema — Getting started paso a paso](https://json-schema.org/learn/getting-started-step-by-step)
- [Ajv — validador de JSON Schema](https://ajv.js.org/)
- [MDN — 422 Unprocessable Content](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/422)
- [Introducción a las ejecuciones de colecciones (Runner)](https://learning.postman.com/docs/tests-and-scripts/running-collections/intro-to-collection-runs/)
- [Construir flujos de ejecución con `setNextRequest`](https://learning.postman.com/docs/tests-and-scripts/running-collections/building-workflows/)
- [Mock servers: llamadas y algoritmo de matching](https://learning.postman.com/docs/design-apis/mock-apis/matching-algorithm)
- [Spec Hub: diseñar APIs en Postman](https://learning.postman.com/docs/design-apis/specifications/overview)
- [Compartir elementos de Postman (Copy link / Share)](https://learning.postman.com/docs/collaborating-in-postman/sharing)
