# Día 5 — Retos

Diez retos sobre la Pizzería API. Los marcados con ⭐ son los más importantes del día: **tests de errores de cliente (4xx) para todos los endpoints, y su automatización**.

Cada reto tiene una **pista** y una **solución** plegadas. Intenta resolverlo antes de abrirlas. En VS Code, abre la vista previa con `Ctrl+Shift+V` y haz clic en cada bloque para desplegarlo.

| # | Reto | Tema | Dificultad |
|---|---|---|---|
| 1 | Predice el código | Errores HTTP | ★☆☆ |
| 2 | Tu primer mock server | Mock server | ★☆☆ |
| 3 | El mock de los casos raros | Mock server | ★★☆ |
| 4 | El contrato manda | Spec Hub | ★★☆ |
| 5 | ⭐ La matriz de errores de cliente | Tests de error | ★★☆ |
| 6 | ⭐ Errores de cliente en piloto automático | Tests de error | ★★★ |
| 7 | ¿Puede fallar tu test? | Calidad de los tests | ★☆☆ |
| 8 | Los errores no cuentan secretos | Seguridad | ★☆☆ |
| 9 | Deja la base de datos como estaba | Independencia | ★★☆ |
| 10 | Exporta sin filtrar secretos | Buenas prácticas | ★☆☆ |

---

## Reto 1 — Predice el código ★☆☆

Antes de pulsar **Send**, escribe en un papel qué código de estado esperas en cada caso. Después compruébalo.

| # | Request | Tu predicción |
|---|---|---|
| a | `POST /api/ingredients` **sin token** y con body `{"name":""}` | |
| b | `PUT /api/ingredients/999999` con token y body `{"name":""}` | |
| c | `PUT /api/ingredients/999999` con token y un body válido | |
| d | `DELETE /api/ingredients/1` con token | |
| e | `GET /api/pizzas/abc` | |
| f | `POST /api/pizzas` con token y `"ingredientIds":[999999]` | |
| g | `POST /api/ingredients` con token, body válido y `Content-Type: text/plain` | |
| h | `GET /api/pizzas?vegetarian=true&maxPrice=0.01` | |

¿Qué te dicen los casos **a**, **b** y **c** sobre el **orden** en que la API hace las comprobaciones?

<details>
<summary>💡 Pista</summary>

La API comprueba primero **quién eres**, luego **si lo que envías está bien formado** y por último **si tiene sentido con los datos que hay**. Y un filtro que no encuentra nada no es un error.

</details>

<details>
<summary>✅ Solución</summary>

| # | Código | Por qué |
|---|---|---|
| a | **401** | La autenticación va antes que la validación. Sin token, ni siquiera se mira el body |
| b | **400** | La validación del body va antes que buscar el recurso |
| c | **404** | Body correcto, pero el ingrediente no existe |
| d | **409** | La masa la usan pizzas: borrarla dejaría datos inconsistentes |
| e | **400** | `abc` no se puede convertir al tipo del id |
| f | **422** | La petición está bien formada, pero viola una regla de negocio (el ingrediente no existe) |
| g | **415** | La API solo acepta `application/json` |
| h | **200** con `[]` | Una búsqueda sin resultados **no es un error** |

Orden de las comprobaciones: **autenticación (401) → formato y validación (400/415) → existencia (404) → conflictos y reglas de negocio (409/422)**.

Esto importa al escribir tests de error: si quieres probar un 400, la request debe llevar token; si no, recibirás un 401 y no estarás probando lo que crees.

</details>

---

## Reto 2 — Tu primer mock server ★☆☆

1. Guarda como ejemplos las respuestas de **Listar pizzas**, **Obtener pizza** (200) y **Obtener pizza** con un id que no existe (404).
2. Crea un mock server de la colección y un entorno `pizzeria-mock` cuyo `baseUrl` apunte al mock.
3. Lanza esas tres requests con el entorno del mock. **Los tests tienen que pasar sin tocar ni una línea.**
4. **Para la API** (Ctrl+C en la consola de Spring Boot) y vuelve a lanzarlas contra el mock. ¿Siguen funcionando?

<details>
<summary>💡 Pista</summary>

- **Send → Save Response → Save as example.** Ponle un nombre que diga qué devuelve: `Pizza encontrada`, `Pizza no encontrada`.
- Colección → **⋯ → Mock collection**.
- Si el mock responde con un error `mockRequestNotFoundError`, el problema está en el matching: revisa el **método**, la **ruta** y que el ejemplo esté **guardado**.

</details>

<details>
<summary>✅ Solución</summary>

1. Ejemplos guardados en cada request: `Listado`, `Pizza encontrada` y `Pizza no encontrada` (este último con la URL `/api/pizzas/999999` y status 404).
2. **⋯ → Mock collection → Name: Pizzería mock → Create**. Copia la URL `https://<id>.mock.pstmn.io`.
3. Duplica el entorno `pizzeria-dev` como `pizzeria-mock` y cambia `baseUrl`.
4. Con la API parada, el mock sigue respondiendo: **no depende de ella**. Es lo que permite al equipo de frontend avanzar sin backend.

¿Y si pides `GET /api/pizzas/3` y solo tienes ejemplos para `/1` y `/999999`? El mock devuelve el **más parecido**, que puede no ser el que esperas. En el reto 3 lo resolvemos con comodines.

</details>

---

## Reto 3 — El mock de los casos raros ★★☆

La API real casi nunca devuelve un **503 Service Unavailable**, pero tu cliente tiene que saber manejarlo. Con el mock del reto 2:

1. Añade a **Obtener pizza** un ejemplo `Servicio caído` con status **503**, la cabecera `Retry-After: 30` y un body con el formato de error estándar.
2. Consigue que el mock devuelva ese ejemplo **sin cambiar la URL**.
3. Escribe un test que solo se ejecute cuando la respuesta sea 503 y compruebe que viene `Retry-After`.
4. **Extra:** haz que `GET /api/pizzas/{cualquier número}` devuelva una pizza **con el id que has pedido**.

<details>
<summary>💡 Pista</summary>

- Para forzar un ejemplo: cabeceras `x-mock-response-code` o `x-mock-response-name`.
- Para el extra: en la URL del ejemplo, una variable que **no existe** en ningún entorno actúa como comodín, y se puede reutilizar en el body del ejemplo.

</details>

<details>
<summary>✅ Solución</summary>

Request con la cabecera `x-mock-response-code: 503` (o `x-mock-response-name: Servicio caído`).

Test:

```javascript
if (pm.response.code === 503) {
    pm.test("503 indica cuándo reintentar", () => {
        pm.response.to.have.header("Retry-After");
        pm.expect(Number(pm.response.headers.get("Retry-After"))).to.be.above(0);
    });
}
```

**Extra:** ejemplo con URL `{{baseUrl}}/api/pizzas/{{idPedido}}` (sin definir `idPedido` en ningún sitio) y body:

```json
{ "id": {{idPedido}}, "name": "Pizza de prueba", "vegetarian": true, "ingredients": [], "ingredientsCost": 0, "profitMargin": 0.2, "price": 0 }
```

`GET /api/pizzas/42` devuelve `"id": 42`.

**Lección:** el mock sirve para probar el **cliente** (o tus propios tests) ante situaciones que la API real no te deja provocar fácilmente.

</details>

---

## Reto 4 — El contrato manda ★★☆

1. Importa en **Specs** el contrato de `http://localhost:8080/v3/api-docs`.
2. Genera una colección a partir de la spec y compárala con la tuya. Haz una lista de lo que **la spec tiene y tu colección no**: endpoints, parámetros, códigos de respuesta.
3. Copia `PizzaResponse` e `IngredientResponse` de `components.schemas` a variables de colección y úsalas en los tests de esquema (apartado 1 del README).
4. Cambia temporalmente el esquema para exigir un campo que no existe (`"required": [..., "calories"]`). El test debe **fallar**. Déjalo como estaba.

<details>
<summary>💡 Pista</summary>

- **Specs → Import → Link**, o descarga el JSON y súbelo.
- La colección generada incluye **ejemplos de respuesta** por cada código documentado. Fíjate en cuántos códigos 4xx documenta cada endpoint.
- Recupera el esquema con `JSON.parse(pm.collectionVariables.get("pizzaSchema"))`.

</details>

<details>
<summary>✅ Solución</summary>

Habitualmente aparecen en la lista:
- `POST /api/auth/refresh`, `POST /api/auth/logout` y `GET /api/auth/me`, que suelen quedarse sin probar.
- Los filtros `name` de pizzas y `vegetarian` de ingredientes.
- Los códigos 401, 409, 415 y 422, que el contrato documenta y la colección a mano no cubre.

Test de esquema reutilizable en *Obtener pizza*:

```javascript
const pizzaSchema = JSON.parse(pm.collectionVariables.get("pizzaSchema"));

pm.test("Cumple el contrato PizzaResponse", () => {
    pm.response.to.have.jsonSchema(pizzaSchema);
});
```

Si el esquema contiene `$ref` a otros esquemas (por ejemplo, `ingredients` apunta a `IngredientResponse`), sustitúyelos por el esquema completo o valida con Ajv añadiendo los dos esquemas con `ajv.addSchema(...)`.

**Lección:** una colección escrita a mano solo prueba lo que a alguien se le ocurrió probar. **Comparar con el contrato es la forma más barata de encontrar huecos.**

</details>

---

## Reto 5 — ⭐ La matriz de errores de cliente ★★☆

**Para cada endpoint** de la API, rellena la matriz con los errores 4xx que **puede** devolver y crea en la carpeta **Errores** una request con sus tests por cada celda marcada.

| Endpoint | 400 validación | 400 JSON mal formado | 400 tipo en ruta/query | 401 | 404 | 405 | 409 | 415 | 422 |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/auth/login` | | | | | | | | | |
| `GET /api/ingredients` | | | | | | | | | |
| `GET /api/ingredients/{id}` | | | | | | | | | |
| `POST /api/ingredients` | | | | | | | | | |
| `PUT /api/ingredients/{id}` | | | | | | | | | |
| `DELETE /api/ingredients/{id}` | | | | | | | | | |
| `GET /api/pizzas` | | | | | | | | | |
| `GET /api/pizzas/{id}` | | | | | | | | | |
| `POST /api/pizzas` | | | | | | | | | |
| `PUT /api/pizzas/{id}` | | | | | | | | | |
| `DELETE /api/pizzas/{id}` | | | | | | | | | |

Cada request de error debe comprobar como mínimo:
1. El **código** exacto, no basta con "es un 4xx".
2. El **formato estándar** del error (`timestamp`, `status`, `error`, `message`, `path`).
3. Si es de validación, que `errors` señala **el campo** culpable.
4. Que **no ha cambiado nada**: después de un `POST` erróneo, el recurso no existe; después de un `DELETE` con 409, el recurso sigue ahí.

<details>
<summary>💡 Pista</summary>

- Las reglas de validación están en los DTO: [IngredientRequest.java](../../pizzeria-api/src/main/java/com/curso/pizzeria/dto/IngredientRequest.java) y [PizzaRequest.java](../../pizzeria-api/src/main/java/com/curso/pizzeria/dto/PizzaRequest.java). **Cada anotación (`@NotBlank`, `@Size`, `@DecimalMin`…) es al menos un caso de error.**
- Los GET son públicos: nunca dan 401.
- El 405 se provoca con un método que el endpoint no admite, como `PATCH`.
- Para el punto 4 usa `pm.sendRequest` en el post-response.

</details>

<details>
<summary>✅ Solución</summary>

| Endpoint | 400 val. | 400 JSON | 400 tipo | 401 | 404 | 405 | 409 | 415 | 422 |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/auth/login` | ✔ | ✔ | | ✔ (credenciales) | | | | ✔ | |
| `GET /api/ingredients` | | | ✔ `?vegetarian=quizas` | | | | | | |
| `GET /api/ingredients/{id}` | | | ✔ `/abc` | | ✔ | ✔ | | | |
| `POST /api/ingredients` | ✔ | ✔ | | ✔ | | | ✔ nombre repetido | ✔ | |
| `PUT /api/ingredients/{id}` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ nombre repetido | ✔ | |
| `DELETE /api/ingredients/{id}` | | | ✔ | ✔ | ✔ | | ✔ en uso | | |
| `GET /api/pizzas` | | | ✔ `?maxPrice=barato` | | | | | | |
| `GET /api/pizzas/{id}` | | | ✔ | | ✔ | ✔ | | | |
| `POST /api/pizzas` | ✔ | ✔ | | ✔ | | | ✔ nombre repetido | ✔ | ✔ ingrediente inexistente |
| `PUT /api/pizzas/{id}` | ✔ | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ | ✔ |
| `DELETE /api/pizzas/{id}` | | | ✔ | ✔ | ✔ | | | | |

Son más de **50 requests** si se cubre cada regla de validación por separado. Por eso existe el reto 6.

Ejemplo del punto 4, en *POST ingrediente con cost negativo*:

```javascript
pm.test("400 y no se ha creado nada", (done) => {
    pm.response.to.have.status(400);
    const nombre = JSON.parse(pm.request.body.raw).name;
    pm.sendRequest(pm.variables.replaceIn("{{baseUrl}}/api/ingredients"), (err, res) => {
        pm.expect(err).to.be.null;
        pm.expect(res.json().map(i => i.name)).to.not.include(nombre);
        done();
    });
});
```

`done` hace que el test espere a la respuesta de `pm.sendRequest`. Sin él, el test termina antes de comprobar nada.

**Lección:** los tests de error son los que más fallos encuentran y los que menos se escriben. **Por cada regla del contrato, al menos un test que la rompa.**

</details>

---

## Reto 6 — ⭐ Errores de cliente en piloto automático ★★★

Escribir 50 requests casi iguales a mano es lento, y en cuanto cambia una regla hay que tocarlas todas. Automatízalo:

- Una **única request** genérica, *Error de cliente (auto)*, en la carpeta **Errores automáticos**.
- Su pre-request **genera la lista de casos**: para cada endpoint de escritura parte de un **body válido** y aplica **mutaciones**, cada una rompiendo **una sola** regla.
- Además, casos genéricos para **todos** los endpoints de escritura: sin token, token falso, JSON mal formado y `Content-Type` incorrecto.
- La request se **repite a sí misma** hasta agotar los casos, y cada vuelta crea un test con un nombre que diga qué se ha probado.

**Objetivo:** añadir una regla nueva debe costar **una línea**.

<details>
<summary>💡 Pista</summary>

- Las funciones no se pueden guardar en variables, pero los datos sí: genera la lista de casos (objetos planos) y guárdala con `JSON.stringify`.
- En el pre-request puedes modificar la request antes de enviarla: `pm.request.method`, `pm.request.url.update(...)`, `pm.request.body.update(...)` y `pm.request.headers.upsert(...)`.
- Configura la request con **Auth = No Auth** y gestiona tú la cabecera `Authorization` en cada caso.
- Para repetirla: `pm.execution.setNextRequest(pm.info.requestName)`. Recuerda que **solo funciona en el Runner y en Newman**.

</details>

<details>
<summary>✅ Solución</summary>

Request **Error de cliente (auto)**: método `GET`, URL `{{baseUrl}}`, **Auth: No Auth**, body *raw / JSON* vacío.

**Pre-request:**

```javascript
// 1. Generar los casos en la primera vuelta
if (!pm.collectionVariables.get("casosError")) {
    const ingrediente = { name: `Auto ${Date.now()}`, cost: 1.5, vegetarian: true };
    const pizza = { name: `Auto ${Date.now()}`, description: "Generada", ingredientIds: [1, 2] };

    // Cada mutación rompe UNA regla del contrato: [descripción, cómo romperla, campo que debe señalar el error]
    const mutaciones = {
        ingrediente: [
            ["sin name",             b => delete b.name,               "name"],
            ["name vacío",           b => b.name = "",                 "name"],
            ["name de 61 caracteres", b => b.name = "x".repeat(61),    "name"],
            ["sin cost",             b => delete b.cost,               "cost"],
            ["cost 0",               b => b.cost = 0,                  "cost"],
            ["cost 100.01",          b => b.cost = 100.01,             "cost"],
            ["cost con 3 decimales", b => b.cost = 1.234,              "cost"],
            ["sin vegetarian",       b => delete b.vegetarian,         "vegetarian"]
        ],
        pizza: [
            ["sin name",                     b => delete b.name,                   "name"],
            ["name de 61 caracteres",        b => b.name = "x".repeat(61),         "name"],
            ["description de 256 caracteres", b => b.description = "x".repeat(256), "description"],
            ["sin ingredientIds",            b => delete b.ingredientIds,          "ingredientIds"],
            ["ingredientIds vacío",          b => b.ingredientIds = [],            "ingredientIds"]
        ]
    };

    const escritura = [
        { method: "POST", path: "/api/ingredients",   valido: ingrediente, tipo: "ingrediente" },
        { method: "PUT",  path: "/api/ingredients/1", valido: ingrediente, tipo: "ingrediente" },
        { method: "POST", path: "/api/pizzas",        valido: pizza,       tipo: "pizza" },
        { method: "PUT",  path: "/api/pizzas/1",      valido: pizza,       tipo: "pizza" }
    ];

    const casos = [];
    const caso = (method, path, nombre, esperado, extra = {}) =>
        casos.push({ method, path, nombre, esperado, auth: "valido", body: "", ...extra });

    escritura.forEach(ep => {
        const body = JSON.stringify(ep.valido);
        // Genéricos: valen para cualquier endpoint de escritura
        caso(ep.method, ep.path, "sin token",               401, { body, auth: null });
        caso(ep.method, ep.path, "token falso",             401, { body, auth: "Bearer inventado" });
        caso(ep.method, ep.path, "JSON mal formado",        400, { body: '{"name": ' });
        caso(ep.method, ep.path, "Content-Type text/plain", 415, { body, contentType: "text/plain" });
        // Una por cada regla de validación
        mutaciones[ep.tipo].forEach(([nombre, romper, campo]) => {
            const roto = JSON.parse(body);
            romper(roto);
            caso(ep.method, ep.path, nombre, 400, { body: JSON.stringify(roto), campo });
        });
    });

    // Ids y parámetros mal formados, recursos inexistentes, conflictos y reglas de negocio
    ["/api/ingredients", "/api/pizzas"].forEach(base => {
        caso("GET",    `${base}/abc`,    "id no numérico",  400);
        caso("GET",    `${base}/999999`, "id inexistente",  404);
        caso("DELETE", `${base}/999999`, "borrar inexistente", 404);
        caso("PATCH",  `${base}/1`,      "método no admitido", 405);
    });
    caso("PUT",  "/api/pizzas/999999", "modificar inexistente", 404, { body: JSON.stringify(pizza) });
    caso("GET",  "/api/pizzas?maxPrice=barato",       "maxPrice no numérico",   400);
    caso("GET",  "/api/ingredients?vegetarian=quizas", "vegetarian no booleano", 400);
    caso("POST", "/api/ingredients", "nombre duplicado", 409, { body: JSON.stringify({ ...ingrediente, name: "Masa" }) });
    caso("DELETE", "/api/ingredients/1", "ingrediente en uso", 409);
    caso("POST", "/api/pizzas", "ingrediente inexistente", 422, { body: JSON.stringify({ ...pizza, ingredientIds: [1, 999999] }) });

    pm.collectionVariables.set("casosError", JSON.stringify(casos));
    pm.collectionVariables.set("casoIdx", 0);
    console.log(`🧪 ${casos.length} casos de error generados`);
}

// 2. Preparar la request para el caso actual
const casos = JSON.parse(pm.collectionVariables.get("casosError"));
const c = casos[Number(pm.collectionVariables.get("casoIdx"))];

pm.request.method = c.method;
pm.request.url.update(pm.variables.replaceIn(`{{baseUrl}}${c.path}`));
pm.request.body.update(c.body);
pm.request.headers.upsert({ key: "Content-Type", value: c.contentType || "application/json" });

if (c.auth === "valido") {
    pm.request.headers.upsert({ key: "Authorization", value: `Bearer ${pm.environment.get("token")}` });
} else if (c.auth) {
    pm.request.headers.upsert({ key: "Authorization", value: c.auth });
} else {
    pm.request.headers.remove("Authorization");
}
```

**Post-response:**

```javascript
const casos = JSON.parse(pm.collectionVariables.get("casosError"));
const i = Number(pm.collectionVariables.get("casoIdx"));
const c = casos[i];
const titulo = `${c.method} ${c.path} · ${c.nombre}`;

pm.test(`${titulo} → ${c.esperado}`, () => {
    pm.response.to.have.status(c.esperado);
});

if (c.campo) {
    pm.test(`${titulo} → señala el campo "${c.campo}"`, () => {
        const campos = (pm.response.json().errors || []).map(e => e.field);
        pm.expect(campos).to.include(c.campo);
    });
}

// Siguiente caso, o fin del bucle
if (i + 1 < casos.length) {
    pm.collectionVariables.set("casoIdx", i + 1);
    pm.execution.setNextRequest(pm.info.requestName);
} else {
    pm.collectionVariables.unset("casoIdx");
    pm.collectionVariables.unset("casosError");
}
```

**Cómo se ejecuta:** botón derecho en la carpeta **Errores automáticos → Run**. Genera más de 50 tests con nombres como `POST /api/ingredients · cost con 3 decimales → 400`.

**Puntos clave:**
- El token lo obtiene el **pre-request de la colección** (apartado 4.2 del README) antes de que se ejecute este script.
- El test de formato estándar de errores del **post-response de la colección** (apartado 6) se aplica también a todos estos casos, sin escribir nada más.
- Si cortas una ejecución a medias, borra `casosError` y `casoIdx` de las variables de colección antes de relanzar.
- **Regla nueva = una línea nueva** en `mutaciones` o una llamada a `caso(...)`.
- Variante sin bucle: recorrer los casos con `pm.sendRequest` dentro de un único post-response. Funciona también al pulsar **Send**, pero los casos no aparecen como requests en el informe del Runner.
- Variante *data-driven*: guardar los casos en un `errores.json` y pasarlo como *data file* (día 6). Es más legible para gente que no programa, pero pierdes la generación automática a partir del body válido.

</details>

---

## Reto 7 — ¿Puede fallar tu test? ★☆☆

Un test que **nunca puede fallar** es peor que no tenerlo, porque da una falsa sensación de seguridad. Los tres tests siguientes **pasan**. Averigua por qué ninguno sirve para nada y corrígelos.

```javascript
// Test A — en "Listar pizzas vegetarianas con precio máximo" (?vegetarian=true&maxPrice=0.5)
pm.test("Todas las pizzas son vegetarianas", () => {
    pm.response.json().forEach(p => pm.expect(p.vegetarian).to.be.true);
});

// Test B — en "Obtener pizza"
pm.test("El precio es positivo", () => {
    pm.response.json().price > 0;
});

// Test C — en "Obtener pizza"
pm.test("La pizza tiene ingredientes", () => {
    pm.expect(pm.response.json().ingredients).to.exist;
});
```

<details>
<summary>💡 Pista</summary>

Técnica: **rompe a propósito** lo que el test dice comprobar (cambia el valor esperado o la URL) y mira si se pone en rojo. Si sigue en verde, el test no comprueba nada.

</details>

<details>
<summary>✅ Solución</summary>

- **A:** con `maxPrice=0.5` la lista viene **vacía**, y `forEach` sobre `[]` no ejecuta ninguna aserción. Pasa siempre. Lo mismo ocurre con `every` sobre un array vacío, que devuelve `true`.
- **B:** la comparación se calcula y se descarta. **No hay ninguna aserción**, y un `pm.test` sin aserciones que fallen siempre pasa.
- **C:** `[]` "existe". Una pizza sin ingredientes pasaría.

```javascript
pm.test("Todas las pizzas son vegetarianas", () => {
    const pizzas = pm.response.json();
    pm.expect(pizzas, "la lista no debería estar vacía").to.not.be.empty;
    pizzas.forEach(p => pm.expect(p.vegetarian, p.name).to.be.true);
});

pm.test("El precio es positivo", () => {
    pm.expect(pm.response.json().price).to.be.above(0);
});

pm.test("La pizza tiene ingredientes", () => {
    pm.expect(pm.response.json().ingredients).to.be.an("array").that.is.not.empty;
});
```

**Lección:** **todo test nuevo se ve fallar al menos una vez.** Si no lo has visto en rojo, no sabes si funciona.

</details>

---

## Reto 8 — Los errores no cuentan secretos ★☆☆

Un mensaje de error no debe revelar detalles internos: trazas de Java, nombres de clases, SQL, rutas del servidor o versiones. Esa información le ahorra trabajo a un atacante.

Escribe **un único test**, en el post-response de la **colección**, que se aplique a **cualquier** respuesta 4xx o 5xx y falle si el body contiene alguna de esas pistas. Lanza después la carpeta **Errores**.

<details>
<summary>💡 Pista</summary>

Trabaja con `pm.response.text()`, no con `json()`: así también vale si el error no es JSON. Una lista de expresiones regulares y un `forEach` bastan.

</details>

<details>
<summary>✅ Solución</summary>

```javascript
if (pm.response.code >= 400) {
    pm.test("[global] El error no expone detalles internos", () => {
        const cuerpo = pm.response.text();
        const fugas = [
            /Exception/i,              // NullPointerException, SQLException...
            /\bat [\w.$]+\(/,          // líneas de stack trace: "at com.curso.pizzeria..."
            /org\.(springframework|hibernate|h2)/i,
            /\b(select|insert|update|delete)\b.+\bfrom\b/i,
            /[A-Z]:\\|\/home\/|\/usr\//, // rutas del servidor
            /"trace"\s*:/
        ];
        fugas.forEach(re => pm.expect(cuerpo, `coincide con ${re}`).to.not.match(re));
    });
}
```

Comprueba que el test **puede fallar** (reto 7): cambia temporalmente `/Exception/` por `/error/i` y verás que salta.

**Lección:** los tests de seguridad más rentables son **globales**. Se escriben una vez y protegen todos los endpoints, incluidos los que se añadan en el futuro.

</details>

---

## Reto 9 — Deja la base de datos como estaba ★★☆

Una suite profesional se puede lanzar **contra un entorno compartido tantas veces como haga falta**. Demuéstralo:

1. Al **principio** de la carpeta **Flujo de negocio**, guarda cuántas pizzas y cuántos ingredientes hay.
2. Al **final**, comprueba que hay exactamente los mismos.
3. Ejecuta la carpeta **tres veces seguidas** en el Runner (3 iteraciones). Las tres deben pasar.
4. Ahora quita el paso *Borrar pizza* y vuelve a ejecutarla. ¿Qué test falla y qué te dice?

<details>
<summary>💡 Pista</summary>

- Pre-request del primer paso: `pm.sendRequest` a los dos listados. (El pre-request de la carpeta no sirve: se ejecuta antes de **cada** request de la carpeta.)
- Post-response del último paso: lo mismo, comparando.
- Comprobar también los **nombres** es más robusto que contar: si la suite borra uno y crea otro, el total no cambia.

</details>

<details>
<summary>✅ Solución</summary>

Pre-request del **primer paso** (*Login*):

```javascript
const base = pm.variables.replaceIn("{{baseUrl}}");
["ingredients", "pizzas"].forEach(recurso => {
    pm.sendRequest(`${base}/api/${recurso}`, (err, res) => {
        pm.collectionVariables.set(`antes_${recurso}`, JSON.stringify(res.json().map(x => x.name).sort()));
    });
});
```

Post-response del **último paso** (*Obtener pizza → 404*):

```javascript
const base = pm.variables.replaceIn("{{baseUrl}}");
["ingredients", "pizzas"].forEach(recurso => {
    pm.test(`La suite deja ${recurso} como estaban`, (done) => {
        pm.sendRequest(`${base}/api/${recurso}`, (err, res) => {
            const antes = JSON.parse(pm.collectionVariables.get(`antes_${recurso}`));
            const despues = res.json().map(x => x.name).sort();
            pm.expect(despues).to.eql(antes);
            done();
        });
    });
});
```

Sin el paso *Borrar pizza*:
- Falla `La suite deja pizzas como estaban`, con la pizza sobrante en el diff.
- El borrado del ingrediente también falla con **409**, porque la pizza lo sigue usando.

Un fallo de limpieza **se propaga**: por eso la limpieza se prueba igual que la funcionalidad.

**Lección:** **cada test crea sus propios datos y los borra.** Nunca dependas de "la pizza con id 8 que creé ayer".

</details>

---

## Reto 10 — Exporta sin filtrar secretos ★☆☆

Exporta la colección y el entorno `pizzeria-dev` (v2.1) a una carpeta temporal y búscalos con el editor:

1. ¿Aparece el **token**, el **refresh token** o la **contraseña** en algún fichero?
2. Corrígelo para que el fichero exportado se pueda subir a Git sin miedo, **sin** que deje de funcionar en tu Postman.
3. ¿Se ha exportado alguna variable temporal que no debería estar ahí, como `casosError` o `antes_pizzas`?

<details>
<summary>💡 Pista</summary>

- Busca en VS Code (`Ctrl+Shift+F`) un trozo de tu token o `"password"`.
- Cada variable tiene dos valores: el **inicial** (compartido, se exporta) y el **actual** (local). Los scripts con `.set(...)` escriben en el actual.
- Las variables de entorno pueden ser de tipo **secret**. Para credenciales, Postman ofrece además el **Vault** (`{{vault:nombre}}`), que nunca se sincroniza ni se exporta.

</details>

<details>
<summary>✅ Solución</summary>

1. Lo habitual es encontrar la **contraseña** como valor inicial del entorno, porque se escribió ahí el primer día. A veces también el token, si alguien lo pegó a mano en el valor inicial.
2. Corrección:
   - Deja **vacío el valor inicial** de `token`, `refreshToken` y `tokenExpiresAt`. Los rellena el login automático.
   - Mueve `password` al **Vault** (`{{vault:pizzeria-password}}`), o deja vacío su valor inicial y pon el real solo en el valor actual, marcado como *secret*.
   - En CI la contraseña llega por variable de entorno del pipeline: `--env-var password=$PIZZERIA_PASSWORD` (día 6).
3. Las variables temporales se **borran al terminar** con `unset` (como hace el reto 6), o se guardan con `pm.variables.set`, que solo vive durante la ejecución.

Comprobación final:

```bash
grep -rniE "password\"|bearer|eyJ" *.json
```

No debería devolver ningún valor real.

**Lección:** **una colección en Git es código**, y en el código no se suben secretos. Revísalo antes de cada commit.

</details>
