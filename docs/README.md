# Desarrollo de APIs con Postman — Material del curso

**Duración:** 20 horas · 6 sesiones de 15:30 a 19:00 (incluye 10 min de descanso por sesión)
**Proyecto de prácticas:** [pizzeria-api](../pizzeria-api/README.md), una API REST con Spring Boot y H2 que gestiona un catálogo de pizzas. El precio de cada pizza es la suma del coste de sus ingredientes más un 20 % de beneficio.

## Calendario

| Sesión | Fecha | Módulos del temario | Carpeta |
|---|---|---|---|
| 1 | Lunes 5 oct | M1 Fundamentos de APIs REST (2h) · M2 Postman desde cero (1h20) | [day-01](day-01/README.md) |
| 2 | Martes 6 oct | M2 Postman desde cero (1h10) · M3 Entornos (2h10) | [day-02](day-02/README.md) |
| 3 | Miércoles 7 oct | M3 Entornos (50 min) · M4 Importaciones (2h30) | [day-03](day-03/README.md) |
| 4 | Jueves 8 oct | M4 Importaciones (30 min) · M5 Testing de APIs (2h50) | [day-04](day-04/README.md) |
| 5 | Martes 13 oct | M5 Testing de APIs (2h40) · M6 Automatización y Newman (40 min) | [day-05](day-05/README.md) |
| 6 | Miércoles 14 oct | M6 Automatización y Newman (1h50) · M7 Buenas prácticas y casos reales (1h30) | [day-06](day-06/README.md) |

| Módulo | Horas |
|---|---|
| 1. Fundamentos de APIs REST | 2h |
| 2. Postman desde cero | 2.5h |
| 3. Entornos (Environments) | 3h |
| 4. Importaciones | 3h |
| 5. Testing de APIs | 5.5h |
| 6. Automatización y Newman | 2.5h |
| 7. Buenas prácticas y casos reales | 1.5h |
| **Total** | **20h** |

## Requisitos para el alumno

- [Postman](https://www.postman.com/downloads/) (aplicación de escritorio) con una cuenta gratuita.
- JDK 17 o superior y una copia del proyecto `pizzeria-api`. Maven no hace falta porque el proyecto incluye *Maven Wrapper* (`mvnw`).
- [Node.js](https://nodejs.org/es/download) LTS para Newman, a partir de la sesión 5.
- Opcional: una cuenta de GitHub para la integración continua de la sesión 6.

## Arranque rápido de la API

```bash
cd pizzeria-api
./mvnw spring-boot:run            # Windows: mvnw.cmd spring-boot:run
```

| Recurso | URL |
|---|---|
| API | http://localhost:8080/api/pizzas |
| Swagger UI | http://localhost:8080/swagger-ui.html |
| Contrato OpenAPI | http://localhost:8080/v3/api-docs (JSON) · http://localhost:8080/v3/api-docs.yaml |
| Consola H2 | http://localhost:8080/h2-console (JDBC URL `jdbc:h2:mem:pizzeria`, usuario `sa`, sin contraseña) |
| Salud | http://localhost:8080/actuator/health |

## Por qué Spring Boot si el cliente usa un framework propio

El cliente trabaja en Java con un framework propio. Postman no depende de la tecnología del servidor: solo ve peticiones y respuestas HTTP. La API de pizzas imita lo que el equipo encontrará en sus proyectos: recursos REST, validaciones, códigos de error coherentes, autenticación con token, un contrato OpenAPI y varios entornos. Todo lo que se aprende en el curso sirve para su framework siempre que exponga HTTP.

## Presentación de cierre

Resumen del curso en diapositivas HTML: [cierre/index.html](cierre/index.html) (ábrela en el navegador o con Live Preview en VS Code; ← → para navegar, F pantalla completa, N notas).

Versión publicada en Claude: https://claude.ai/artifact/GvhRFjvyq8CedsCQ7D3kpP

## Material complementario

- [Postman Academy](https://academy.postman.com/): cursos oficiales gratuitos con insignias.
- [Postman Learning Center](https://learning.postman.com/docs/getting-started/overview/): documentación oficial.
- [MDN: HTTP](https://developer.mozilla.org/es/docs/Web/HTTP/Guides/Overview): la mejor referencia de HTTP en español.
