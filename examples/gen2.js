const fs = require('fs');
const path = require('path');

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

const lines = (s) => s.replace(/^\n/, '').replace(/\n$/, '').split('\n');
const indent = (s, n) => s.replace(/^\n/, '').replace(/\n$/, '').split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

// ---------------------------------------------------------------------------
// Librería compartida: se define en el pre-request de la colección.
// Cada script la instancia con su propio pm: const qa = qaLib(pm);
// ---------------------------------------------------------------------------
const LIB = `
// Estado de la petición actual: se reinicia antes de CADA petición,
// así ninguna petición hereda nada de la anterior.
qaState = { fx: {}, cleanup: [], error: undefined };

qaLib = (pm) => {
  const base = () => pm.environment.get("baseUrl");

  const send = (method, path, body, token) => new Promise((resolve, reject) => pm.sendRequest({
    url: base() + path,
    method,
    header: Object.assign(
      { "Content-Type": "application/json" },
      token ? { Authorization: "Bearer " + token } : {}
    ),
    body: body === undefined ? undefined : { mode: "raw", raw: JSON.stringify(body) }
  }, (err, res) => err ? reject(err) : resolve(res)));

  const ok = (res, what) => {
    if (res.code < 200 || res.code > 299) throw new Error(what + " -> HTTP " + res.code + " " + res.text());
    return res;
  };

  const qa = {
    send,
    fx: qaState.fx,

    // Identificador único: los datos de cada petición nunca colisionan con otros
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),

    // Guarda un valor como fixture y como variable local ({{clave}} en URL/body)
    set: (key, value) => { qaState.fx[key] = value; pm.variables.set(key, value); return value; },

    async login() {
      const res = ok(await send("POST", "/api/auth/login", {
        username: pm.environment.get("username"),
        password: pm.environment.get("password")
      }), "login");
      const tokens = res.json();
      qa.set("accessToken", tokens.accessToken);
      qa.set("refreshToken", tokens.refreshToken);
      return tokens;
    },

    track(kind, id) { qaState.cleanup.push({ kind, id }); },

    async createIngredient(name, cost, vegetarian) {
      const res = ok(await send("POST", "/api/ingredients", { name, cost, vegetarian }, qaState.fx.accessToken), "crear ingrediente");
      const ing = res.json();
      qa.track("ingredients", ing.id);
      return ing;
    },

    async createPizza(name, ingredientIds, description) {
      const res = ok(await send("POST", "/api/pizzas", { name, description, ingredientIds }, qaState.fx.accessToken), "crear pizza");
      const pizza = res.json();
      qa.track("pizzas", pizza.id);
      return pizza;
    },

    // Id que con seguridad no existe: se crea un recurso y se borra
    async deletedId(kind) {
      const res = kind === "ingredients"
        ? await qa.createIngredient("QA borrado " + qa.uid(), 1, true)
        : await qa.createPizza("QA borrada " + qa.uid(), [(await qa.createIngredient("QA ing " + qa.uid(), 1, true)).id]);
      ok(await send("DELETE", "/api/" + kind + "/" + res.id, undefined, qaState.fx.accessToken), "borrar " + kind);
      qaState.cleanup = qaState.cleanup.filter(c => !(c.kind === kind && c.id === res.id));
      return res.id;
    },

    // Pre-request: prepara los datos que necesita la petición
    arrange(fn) {
      (async () => { await fn(qa); })().catch(e => { qaState.error = String(e && e.message || e); });
    },

    // Si la petición ha creado un recurso, se registra para borrarlo
    trackResponse(kind) {
      if (pm.response.code >= 200 && pm.response.code < 300) {
        try { const id = pm.response.json().id; if (id !== undefined) qa.track(kind, id); } catch (e) { }
      }
    },

    // Tests: verificaciones asíncronas opcionales y, siempre, limpieza
    finish(verify) {
      pm.test("[arrange] fixtures preparados", () => pm.expect(qaState.error, qaState.error).to.be.undefined);
      (async () => {
        try {
          if (verify) await verify(qa);
        } catch (e) {
          pm.test("[verify] sin errores", () => { throw e; });
        } finally {
          await qa.cleanup();
        }
      })();
    },

    async cleanup() {
      if (qaState.cleanup.length === 0) return;
      // Token propio: la petición puede haber invalidado el suyo (logout)
      const token = ok(await send("POST", "/api/auth/login", {
        username: pm.environment.get("username"),
        password: pm.environment.get("password")
      }), "login teardown").json().accessToken;
      const results = [];
      for (const { kind, id } of qaState.cleanup.slice().reverse()) {
        const res = await send("DELETE", "/api/" + kind + "/" + id, undefined, token);
        results.push({ kind, id, code: res.code });
      }
      qaState.cleanup = [];
      pm.test("[teardown] datos de prueba eliminados", () => {
        results.forEach(r => pm.expect([200, 204, 404], r.kind + "/" + r.id).to.include(r.code));
      });
    },

    // ----- Aserciones reutilizables -----
    expectIngredient(ing, expected) {
      pm.test("Ingrediente: estructura y valores", () => {
        pm.expect(ing.id).to.be.a("number");
        pm.expect(ing.name).to.eql(expected.name);
        pm.expect(ing.cost).to.be.closeTo(expected.cost, 0.001);
        pm.expect(ing.vegetarian).to.eql(expected.vegetarian);
      });
    },

    expectPizza(p, expected) {
      const price = Math.round(expected.cost * 1.2 * 100) / 100;
      pm.test("Pizza: estructura", () => {
        pm.expect(p.id).to.be.a("number");
        pm.expect(p.name).to.eql(expected.name);
        pm.expect(p.ingredients).to.be.an("array");
        ["ingredientsCost", "profitMargin", "price"].forEach(k => pm.expect(p[k], k).to.be.a("number"));
      });
      pm.test("Pizza: contiene exactamente los ingredientes enviados", () => {
        const sort = a => a.slice().sort((x, y) => x - y);
        pm.expect(sort(p.ingredients.map(i => i.id))).to.eql(sort(expected.ingredientIds));
      });
      pm.test("Pizza: ingredientsCost = " + expected.cost, () => {
        pm.expect(p.ingredientsCost).to.be.closeTo(p.ingredients.reduce((a, i) => a + i.cost, 0), 0.001);
        pm.expect(p.ingredientsCost).to.be.closeTo(expected.cost, 0.001);
      });
      pm.test("Pizza: price = ingredientsCost + 20 % = " + price, () => {
        pm.expect(p.price).to.be.closeTo(price, 0.01);
      });
      pm.test("Pizza: vegetarian = " + expected.vegetarian, () => {
        pm.expect(p.vegetarian).to.eql(expected.vegetarian);
        pm.expect(p.vegetarian).to.eql(p.ingredients.every(i => i.vegetarian));
      });
    }
  };
  return qa;
};
`;

// ---------------------------------------------------------------------------
// Constructor de peticiones
// ---------------------------------------------------------------------------
function req(name, method, urlPath, { body, auth, query, arrange, tests = '', verify, track } = {}) {
  const qs = query ? '?' + query.map(([k, v]) => `${k}=${v}`).join('&') : '';
  const item = {
    name,
    event: [],
    request: {
      method,
      header: body !== undefined ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url: {
        raw: '{{baseUrl}}' + urlPath + qs,
        host: ['{{baseUrl}}'],
        path: urlPath.replace(/^\//, '').split('/'),
        ...(query ? { query: query.map(([key, value]) => ({ key, value })) } : {}),
      },
    },
  };
  if (body !== undefined) {
    // Los ids van sin comillas: {{ingAId}} se sustituye por un número
    const raw = JSON.stringify(body, null, 2).replace(/"(\{\{\w+Id\}\})"/g, '$1');
    item.request.body = { mode: 'raw', raw, options: { raw: { language: 'json' } } };
  }
  if (auth === 'none') item.request.auth = { type: 'noauth' };
  else if (auth) item.request.auth = { type: 'bearer', bearer: [{ key: 'token', value: auth, type: 'string' }] };

  if (arrange !== undefined) {
    const pre = `qaLib(pm).arrange(async (qa) => {\n${indent(arrange, 2)}\n});`;
    item.event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(pre) } });
  }
  let test = 'const qa = qaLib(pm);\n';
  if (track) test += `qa.trackResponse("${track}");\n`;
  test += tests.replace(/^\n/, '').replace(/\n$/, '') + '\n';
  test += verify ? `qa.finish(async (qa) => {\n${indent(verify, 2)}\n});` : 'qa.finish();';
  item.event.push({ listen: 'test', script: { type: 'text/javascript', exec: lines(test) } });
  return item;
}

const folder = (name, description, item) => ({ name, description, item });

const status = (code) => `pm.test("Status ${code}", () => pm.response.to.have.status(${code}));`;
const created = `pm.test("Status 200/201 (creado)", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));`;
const noContent = `pm.test("Status 200/204 (sin cuerpo)", () => pm.expect(pm.response.code).to.be.oneOf([200, 204]));`;
const clientError = `pm.test("Status 4xx (rechazada)", () => pm.expect(pm.response.code).to.be.within(400, 499));`;

const login = 'await qa.login();';

const tokenTests = `
const t = pm.response.json();
pm.test("Cumple el esquema TokenResponse", () => pm.response.to.have.jsonSchema({
  type: "object",
  required: ["accessToken", "refreshToken", "tokenType", "expiresIn"],
  properties: {
    accessToken: { type: "string", minLength: 1 },
    refreshToken: { type: "string", minLength: 1 },
    tokenType: { type: "string" },
    expiresIn: { type: "integer", minimum: 1 }
  }
}));
pm.test("tokenType es Bearer", () => pm.expect(t.tokenType.toLowerCase()).to.eql("bearer"));`;

// Fixtures estándar: A (veg, 1.50), B (veg, 0.75), C (no veg, 2.00)
const ingABC = `
${login}
const tag = qa.set("tag", "QA" + qa.uid());
qa.set("ingAId", (await qa.createIngredient(tag + " A", 1.5, true)).id);
qa.set("ingBId", (await qa.createIngredient(tag + " B", 0.75, true)).id);
qa.set("ingCId", (await qa.createIngredient(tag + " C", 2.0, false)).id);`;

// Pizza vegetal (A+B = 2.25 -> 2.70) y mixta (A+C = 3.50 -> 4.20)
const twoPizzas = `
${ingABC}
qa.set("pizzaVegId", (await qa.createPizza(tag + " Veg", [qa.fx.ingAId, qa.fx.ingBId], "Vegetal")).id);
qa.set("pizzaMixId", (await qa.createPizza(tag + " Mix", [qa.fx.ingAId, qa.fx.ingCId], "Mixta")).id);`;

// ---------------------------------------------------------------------------
// 01 Autenticación
// ---------------------------------------------------------------------------
const auth = folder('01 - Autenticación', 'Cada petición hace su propio login cuando lo necesita.', [
  req('Login correcto', 'POST', '/api/auth/login', {
    auth: 'none',
    body: { username: '{{username}}', password: '{{password}}' },
    tests: `${status(200)}\n${tokenTests}
pm.test("accessToken y refreshToken son distintos", () => pm.expect(t.accessToken).to.not.eql(t.refreshToken));`,
    verify: `
const me = await qa.send("GET", "/api/auth/me", undefined, t.accessToken);
pm.test("El accessToken obtenido es válido en /me", () => pm.expect(me.code).to.eql(200));
await qa.send("POST", "/api/auth/logout", undefined, t.accessToken);`,
  }),
  req('Login con contraseña incorrecta -> 401', 'POST', '/api/auth/login', {
    auth: 'none',
    body: { username: '{{username}}', password: 'contraseña-incorrecta' },
    tests: `${status(401)}
pm.test("No devuelve tokens", () => pm.expect(pm.response.text()).to.not.include("accessToken"));`,
  }),
  req('Login con usuario inexistente -> 401', 'POST', '/api/auth/login', {
    auth: 'none',
    arrange: 'qa.set("ghostUser", "no-existe-" + qa.uid());',
    body: { username: '{{ghostUser}}', password: 'x' },
    tests: status(401),
  }),
  req('Login sin password -> 400', 'POST', '/api/auth/login', {
    auth: 'none',
    body: { username: '{{username}}' },
    tests: status(400),
  }),
  req('Me - usuario del token', 'GET', '/api/auth/me', {
    arrange: login,
    tests: `${status(200)}
const u = pm.response.json();
pm.test("username coincide con el del login", () => pm.expect(u.username).to.eql(pm.environment.get("username")));
pm.test("expiresIn es un entero positivo", () => {
  pm.expect(Number.isInteger(u.expiresIn)).to.be.true;
  pm.expect(u.expiresIn).to.be.above(0);
});`,
  }),
  req('Me sin token -> 401', 'GET', '/api/auth/me', { auth: 'none', tests: status(401) }),
  req('Me con token inventado -> 401', 'GET', '/api/auth/me', { auth: 'token-inventado', tests: status(401) }),
  req('Refresh - canjea el refresh token', 'POST', '/api/auth/refresh', {
    auth: 'none',
    arrange: login,
    body: { refreshToken: '{{refreshToken}}' },
    tests: `${status(200)}\n${tokenTests}
pm.test("Devuelve un access token nuevo", () => pm.expect(t.accessToken).to.not.eql(qaState.fx.accessToken));`,
    verify: `
const me = await qa.send("GET", "/api/auth/me", undefined, t.accessToken);
pm.test("El nuevo accessToken es válido en /me", () => pm.expect(me.code).to.eql(200));`,
  }),
  req('Refresh con token inventado -> 401', 'POST', '/api/auth/refresh', {
    auth: 'none',
    body: { refreshToken: 'refresh-token-inventado' },
    tests: status(401),
  }),
  req('Refresh sin refreshToken -> 400', 'POST', '/api/auth/refresh', {
    auth: 'none',
    body: {},
    tests: status(400),
  }),
  req('Logout invalida el access token', 'POST', '/api/auth/logout', {
    arrange: login,
    tests: noContent,
    verify: `
const me = await qa.send("GET", "/api/auth/me", undefined, qa.fx.accessToken);
pm.test("El token ya no es válido tras el logout", () => pm.expect(me.code).to.eql(401));`,
  }),
  req('Logout sin token -> 401', 'POST', '/api/auth/logout', { auth: 'none', tests: status(401) }),
]);

// ---------------------------------------------------------------------------
// 02 Ingredientes
// ---------------------------------------------------------------------------
const ingredients = folder('02 - Ingredientes', 'Cada petición crea los ingredientes que necesita y los borra al terminar.', [
  req('Crear ingrediente', 'POST', '/api/ingredients', {
    arrange: `${login}\nqa.set("name", "QA" + qa.uid() + " Ingrediente");`,
    body: { name: '{{name}}', cost: 1.25, vegetarian: true },
    track: 'ingredients',
    tests: `${created}
const ing = pm.response.json();
qa.expectIngredient(ing, { name: qaState.fx.name, cost: 1.25, vegetarian: true });`,
    verify: `
const res = await qa.send("GET", "/api/ingredients/" + ing.id);
pm.test("Queda persistido", () => {
  pm.expect(res.code).to.eql(200);
  pm.expect(res.json()).to.eql(ing);
});`,
  }),
  req('Obtener ingrediente por id', 'GET', '/api/ingredients/{{ingAId}}', {
    auth: 'none',
    arrange: ingABC,
    tests: `${status(200)}
qa.expectIngredient(pm.response.json(), { name: qaState.fx.tag + " A", cost: 1.5, vegetarian: true });
pm.test("id coincide", () => pm.expect(pm.response.json().id).to.eql(qaState.fx.ingAId));`,
  }),
  req('Obtener ingrediente inexistente -> 404', 'GET', '/api/ingredients/{{missingId}}', {
    auth: 'none',
    arrange: `${login}\nqa.set("missingId", await qa.deletedId("ingredients"));`,
    tests: status(404),
  }),
  req('Listar ingredientes', 'GET', '/api/ingredients', {
    auth: 'none',
    arrange: ingABC,
    tests: `${status(200)}
const list = pm.response.json();
const ids = list.map(i => i.id);
pm.test("Es un array sin ids duplicados", () => {
  pm.expect(list).to.be.an("array");
  pm.expect(new Set(ids).size).to.eql(ids.length);
});
pm.test("Incluye los ingredientes creados", () => pm.expect(ids).to.include.members([qaState.fx.ingAId, qaState.fx.ingBId, qaState.fx.ingCId]));`,
  }),
  req('Listar ingredientes vegetarian=true', 'GET', '/api/ingredients', {
    auth: 'none',
    query: [['vegetarian', 'true']],
    arrange: ingABC,
    tests: `${status(200)}
const list = pm.response.json();
const ids = list.map(i => i.id);
pm.test("Todos son vegetarianos", () => pm.expect(list.every(i => i.vegetarian === true)).to.be.true);
pm.test("Incluye A y B", () => pm.expect(ids).to.include.members([qaState.fx.ingAId, qaState.fx.ingBId]));
pm.test("No incluye C", () => pm.expect(ids).to.not.include(qaState.fx.ingCId));`,
  }),
  req('Listar ingredientes vegetarian=false', 'GET', '/api/ingredients', {
    auth: 'none',
    query: [['vegetarian', 'false']],
    arrange: ingABC,
    tests: `${status(200)}
const list = pm.response.json();
const ids = list.map(i => i.id);
pm.test("Ninguno es vegetariano", () => pm.expect(list.every(i => i.vegetarian === false)).to.be.true);
pm.test("Incluye C", () => pm.expect(ids).to.include(qaState.fx.ingCId));
pm.test("No incluye A ni B", () => pm.expect(ids).to.not.include.members([qaState.fx.ingAId, qaState.fx.ingBId]));`,
  }),
  req('Modificar ingrediente', 'PUT', '/api/ingredients/{{ingAId}}', {
    arrange: `${ingABC}\nqa.set("newName", tag + " A modificado");`,
    body: { name: '{{newName}}', cost: 1.6, vegetarian: false },
    tests: `${status(200)}
qa.expectIngredient(pm.response.json(), { name: qaState.fx.newName, cost: 1.6, vegetarian: false });`,
    verify: `
const res = await qa.send("GET", "/api/ingredients/" + qa.fx.ingAId);
pm.test("El cambio queda persistido", () => {
  pm.expect(res.json().name).to.eql(qa.fx.newName);
  pm.expect(res.json().cost).to.be.closeTo(1.6, 0.001);
  pm.expect(res.json().vegetarian).to.eql(false);
});`,
  }),
  req('Borrar ingrediente', 'DELETE', '/api/ingredients/{{ingAId}}', {
    arrange: ingABC,
    tests: noContent,
    verify: `
const res = await qa.send("GET", "/api/ingredients/" + qa.fx.ingAId);
pm.test("Ya no existe (404)", () => pm.expect(res.code).to.eql(404));`,
  }),
  req('Borrar ingrediente usado en una pizza -> 4xx', 'DELETE', '/api/ingredients/{{ingCId}}', {
    arrange: `${ingABC}\nqa.set("pizzaId", (await qa.createPizza(tag + " Pizza", [qa.fx.ingCId])).id);`,
    tests: clientError,
    verify: `
const res = await qa.send("GET", "/api/ingredients/" + qa.fx.ingCId);
pm.test("El ingrediente sigue existiendo", () => pm.expect(res.code).to.eql(200));`,
  }),
  req('Crear ingrediente sin token -> 401', 'POST', '/api/ingredients', {
    auth: 'none',
    arrange: 'qa.set("name", "QA" + qa.uid() + " sin token");',
    body: { name: '{{name}}', cost: 1, vegetarian: true },
    track: 'ingredients',
    tests: status(401),
  }),
  req('Modificar ingrediente sin token -> 401', 'PUT', '/api/ingredients/{{ingAId}}', {
    auth: 'none',
    arrange: ingABC,
    body: { name: 'cambio no autorizado', cost: 9, vegetarian: false },
    tests: status(401),
    verify: `
const res = await qa.send("GET", "/api/ingredients/" + qa.fx.ingAId);
pm.test("El ingrediente no ha cambiado", () => pm.expect(res.json().name).to.eql(qa.fx.tag + " A"));`,
  }),
  req('Borrar ingrediente sin token -> 401', 'DELETE', '/api/ingredients/{{ingAId}}', {
    auth: 'none',
    arrange: ingABC,
    tests: status(401),
    verify: `
const res = await qa.send("GET", "/api/ingredients/" + qa.fx.ingAId);
pm.test("El ingrediente sigue existiendo", () => pm.expect(res.code).to.eql(200));`,
  }),
  ...[
    ['cost 0 (mínimo 0.01)', { name: '{{name}}', cost: 0, vegetarian: true }],
    ['cost 100.01 (máximo 100)', { name: '{{name}}', cost: 100.01, vegetarian: true }],
    ['sin name', { cost: 1, vegetarian: true }],
    ['name de 61 caracteres', { name: 'X'.repeat(61), cost: 1, vegetarian: true }],
    ['sin cost', { name: '{{name}}', vegetarian: true }],
    ['sin vegetarian', { name: '{{name}}', cost: 1 }],
  ].map(([label, body]) => req(`Crear ingrediente ${label} -> 400`, 'POST', '/api/ingredients', {
    arrange: `${login}\nqa.set("name", "QA" + qa.uid() + " inválido");`,
    body,
    track: 'ingredients',
    tests: status(400),
  })),
]);

// ---------------------------------------------------------------------------
// 03 Pizzas
// ---------------------------------------------------------------------------
const pizzas = folder('03 - Pizzas', 'Pizzas construidas con ingredientes propios de coste conocido: A=1.50 (veg), B=0.75 (veg), C=2.00 (no veg).', [
  req('Crear pizza vegetal (A+B) -> 2.70', 'POST', '/api/pizzas', {
    arrange: `${ingABC}\nqa.set("name", tag + " Veg");`,
    body: { name: '{{name}}', description: 'Pizza de pruebas', ingredientIds: ['{{ingAId}}', '{{ingBId}}'] },
    track: 'pizzas',
    tests: `${created}
const p = pm.response.json();
qa.expectPizza(p, { name: qaState.fx.name, ingredientIds: [qaState.fx.ingAId, qaState.fx.ingBId], cost: 2.25, vegetarian: true });
pm.test("description persistida", () => pm.expect(p.description).to.eql("Pizza de pruebas"));`,
  }),
  req('Crear pizza con un ingrediente no vegetariano (A+C) -> 4.20', 'POST', '/api/pizzas', {
    arrange: `${ingABC}\nqa.set("name", tag + " Mix");`,
    body: { name: '{{name}}', ingredientIds: ['{{ingAId}}', '{{ingCId}}'] },
    track: 'pizzas',
    tests: `${created}
qa.expectPizza(pm.response.json(), { name: qaState.fx.name, ingredientIds: [qaState.fx.ingAId, qaState.fx.ingCId], cost: 3.5, vegetarian: false });`,
  }),
  req('Obtener pizza por id', 'GET', '/api/pizzas/{{pizzaVegId}}', {
    auth: 'none',
    arrange: twoPizzas,
    tests: `${status(200)}
const p = pm.response.json();
qa.expectPizza(p, { name: qaState.fx.tag + " Veg", ingredientIds: [qaState.fx.ingAId, qaState.fx.ingBId], cost: 2.25, vegetarian: true });
pm.test("description persistida", () => pm.expect(p.description).to.eql("Vegetal"));`,
  }),
  req('Obtener pizza inexistente -> 404', 'GET', '/api/pizzas/{{missingId}}', {
    auth: 'none',
    arrange: `${login}\nqa.set("missingId", await qa.deletedId("pizzas"));`,
    tests: status(404),
  }),
  req('Listar pizzas', 'GET', '/api/pizzas', {
    auth: 'none',
    arrange: twoPizzas,
    tests: `${status(200)}
const list = pm.response.json();
pm.test("Incluye las pizzas creadas", () => pm.expect(list.map(p => p.id)).to.include.members([qaState.fx.pizzaVegId, qaState.fx.pizzaMixId]));
pm.test("Todas cumplen price = ingredientsCost + 20 %", () => {
  list.forEach(p => pm.expect(p.price, p.name).to.be.closeTo(p.ingredientsCost * 1.2, 0.01));
});`,
  }),
  req('Filtrar por name', 'GET', '/api/pizzas', {
    auth: 'none',
    query: [['name', '{{tag}} Veg']],
    arrange: twoPizzas,
    tests: `${status(200)}
pm.test("Devuelve solo la pizza buscada", () => pm.expect(pm.response.json().map(p => p.id)).to.eql([qaState.fx.pizzaVegId]));`,
  }),
  req('Filtrar por name sin coincidencias -> []', 'GET', '/api/pizzas', {
    auth: 'none',
    arrange: 'qa.set("tag", "QA" + qa.uid() + " inexistente");',
    query: [['name', '{{tag}}']],
    tests: `${status(200)}
pm.test("Lista vacía", () => pm.expect(pm.response.json()).to.be.an("array").that.is.empty);`,
  }),
  req('Filtrar por vegetarian=true', 'GET', '/api/pizzas', {
    auth: 'none',
    query: [['name', '{{tag}}'], ['vegetarian', 'true']],
    arrange: twoPizzas,
    tests: `${status(200)}
const list = pm.response.json();
pm.test("Solo la pizza vegetal", () => pm.expect(list.map(p => p.id)).to.eql([qaState.fx.pizzaVegId]));
pm.test("Todas son vegetarianas", () => pm.expect(list.every(p => p.vegetarian)).to.be.true);`,
  }),
  req('Filtrar por vegetarian=false', 'GET', '/api/pizzas', {
    auth: 'none',
    query: [['name', '{{tag}}'], ['vegetarian', 'false']],
    arrange: twoPizzas,
    tests: `${status(200)}
pm.test("Solo la pizza mixta", () => pm.expect(pm.response.json().map(p => p.id)).to.eql([qaState.fx.pizzaMixId]));`,
  }),
  req('Filtrar por maxPrice=3', 'GET', '/api/pizzas', {
    auth: 'none',
    query: [['name', '{{tag}}'], ['maxPrice', '3']],
    arrange: twoPizzas,
    tests: `${status(200)}
const list = pm.response.json();
pm.test("Solo la vegetal (2.70); la mixta cuesta 4.20", () => pm.expect(list.map(p => p.id)).to.eql([qaState.fx.pizzaVegId]));
pm.test("Ningún precio supera maxPrice", () => pm.expect(list.every(p => p.price <= 3)).to.be.true);`,
  }),
  req('Modificar pizza (A+B+C) -> 5.10, deja de ser vegetariana', 'PUT', '/api/pizzas/{{pizzaVegId}}', {
    arrange: `${twoPizzas}\nqa.set("newName", tag + " Veg modificada");`,
    body: { name: '{{newName}}', description: 'Ahora lleva C', ingredientIds: ['{{ingAId}}', '{{ingBId}}', '{{ingCId}}'] },
    tests: `${status(200)}
qa.expectPizza(pm.response.json(), { name: qaState.fx.newName, ingredientIds: [qaState.fx.ingAId, qaState.fx.ingBId, qaState.fx.ingCId], cost: 4.25, vegetarian: false });`,
    verify: `
const res = await qa.send("GET", "/api/pizzas/" + qa.fx.pizzaVegId);
pm.test("El cambio queda persistido", () => pm.expect(res.json().ingredients).to.have.lengthOf(3));`,
  }),
  req('Cambiar el coste de un ingrediente recalcula la pizza -> 4.80', 'PUT', '/api/ingredients/{{ingCId}}', {
    arrange: twoPizzas,
    body: { name: '{{tag}} C', cost: 2.5, vegetarian: false },
    tests: status(200),
    verify: `
const res = await qa.send("GET", "/api/pizzas/" + qa.fx.pizzaMixId);
qa.expectPizza(res.json(), { name: qa.fx.tag + " Mix", ingredientIds: [qa.fx.ingAId, qa.fx.ingCId], cost: 4.0, vegetarian: false });`,
  }),
  req('Borrar pizza', 'DELETE', '/api/pizzas/{{pizzaVegId}}', {
    arrange: twoPizzas,
    tests: noContent,
    verify: `
const res = await qa.send("GET", "/api/pizzas/" + qa.fx.pizzaVegId);
pm.test("Ya no existe (404)", () => pm.expect(res.code).to.eql(404));
const ing = await qa.send("GET", "/api/ingredients/" + qa.fx.ingAId);
pm.test("Sus ingredientes siguen existiendo", () => pm.expect(ing.code).to.eql(200));`,
  }),
  req('Crear pizza sin token -> 401', 'POST', '/api/pizzas', {
    auth: 'none',
    arrange: ingABC,
    body: { name: '{{tag}} sin token', ingredientIds: ['{{ingAId}}'] },
    track: 'pizzas',
    tests: status(401),
  }),
  req('Modificar pizza sin token -> 401', 'PUT', '/api/pizzas/{{pizzaVegId}}', {
    auth: 'none',
    arrange: twoPizzas,
    body: { name: 'cambio no autorizado', ingredientIds: ['{{ingCId}}'] },
    tests: status(401),
    verify: `
const res = await qa.send("GET", "/api/pizzas/" + qa.fx.pizzaVegId);
pm.test("La pizza no ha cambiado", () => pm.expect(res.json().name).to.eql(qa.fx.tag + " Veg"));`,
  }),
  req('Borrar pizza sin token -> 401', 'DELETE', '/api/pizzas/{{pizzaVegId}}', {
    auth: 'none',
    arrange: twoPizzas,
    tests: status(401),
    verify: `
const res = await qa.send("GET", "/api/pizzas/" + qa.fx.pizzaVegId);
pm.test("La pizza sigue existiendo", () => pm.expect(res.code).to.eql(200));`,
  }),
  req('Crear pizza sin ingredientes -> 400', 'POST', '/api/pizzas', {
    arrange: `${login}\nqa.set("name", "QA" + qa.uid() + " vacía");`,
    body: { name: '{{name}}', ingredientIds: [] },
    track: 'pizzas',
    tests: status(400),
  }),
  req('Crear pizza sin name -> 400', 'POST', '/api/pizzas', {
    arrange: ingABC,
    body: { ingredientIds: ['{{ingAId}}'] },
    track: 'pizzas',
    tests: status(400),
  }),
  req('Crear pizza con name de 61 caracteres -> 400', 'POST', '/api/pizzas', {
    arrange: ingABC,
    body: { name: 'X'.repeat(61), ingredientIds: ['{{ingAId}}'] },
    track: 'pizzas',
    tests: status(400),
  }),
  req('Crear pizza con un ingrediente inexistente -> 4xx', 'POST', '/api/pizzas', {
    arrange: `${login}\nqa.set("name", "QA" + qa.uid() + " fantasma");\nqa.set("missingId", await qa.deletedId("ingredients"));`,
    body: { name: '{{name}}', ingredientIds: ['{{missingId}}'] },
    track: 'pizzas',
    tests: clientError,
  }),
]);

const collection = {
  info: {
    name: 'Pizzería API - Tests independientes',
    description:
      'Colección generada a partir de la especificación OpenAPI (/v3/api-docs).\n\n' +
      'Cada petición es independiente: se puede ejecutar sola, en cualquier orden o en paralelo.\n\n' +
      'Patrón Arrange / Act / Assert / Teardown:\n' +
      '- Pre-request: hace su propio login y crea sus fixtures con un nombre único (qa.arrange).\n' +
      '- Petición: la acción bajo prueba.\n' +
      '- Tests: aserciones, verificaciones extra y borrado de todo lo creado (qa.finish).\n\n' +
      'La librería qaLib vive en el pre-request de la colección y se reinicia en cada petición.\n' +
      'Precio esperado = suma de costes de ingredientes + 20 %.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(LIB) } }],
  item: [auth, ingredients, pizzas],
};

const environment = {
  name: 'pizzeria-dev',
  values: [
    { key: 'baseUrl', value: 'http://localhost:8080', type: 'default', enabled: true },
    { key: 'username', value: 'admin', type: 'default', enabled: true },
    { key: 'password', value: 'admin123', type: 'secret', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

fs.writeFileSync(path.join(outDir, 'pizzeria-api.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'pizzeria-dev.postman_environment.json'), JSON.stringify(environment, null, 2) + '\n');
console.log('ok');
