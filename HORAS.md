# Registro de Horas — CookidoAI

## Resumen

| Métrica | Valor |
|---|---|
| **Fecha de inicio** | 2026-03-23 |
| **Última actualización** | 2026-03-29 |
| **Total de horas** | 22.2h |

---

## Sesiones

| Fecha | Horas | Descripción |
|---|---|---|
| 2026-03-23 | 2.5h | Integración ChatGPT → Cookidoo; Mejoras de interfaz: pantalla única y progreso animado; v1.0 - CookidoAI completo |
| 2026-03-24 | 1h | v1.1 - Editor de receta, imagen Pexels y modo sin DB |
| 2026-03-25 | 7h | Deploy config para Render + fix Playwright en producción; Auth sin DB: usuarios estáticos para UAT; Sesión Cookidoo por usuario: perfil Chrome separado; Auto-login Cookidoo con env vars |
| 2026-03-29 | 11.7h | Fix sesión Cookidoo: storageState explícito + mejoras anti-detección + imágenes Pexels; UAT2: quitar límite de 10 recetas para uat2@cookidoai.com |
| **TOTAL** | **11.5h** | |

---

## Cómo agregar sesiones manualmente

Edita la tabla de sesiones directamente en este archivo. Cada fila sigue el formato:

```
| YYYY-MM-DD | Xh | Descripción breve de lo trabajado |
```

La fila `**TOTAL**` se actualiza automáticamente con el script post-commit.
Si la añades a mano, recuerda sumar la nueva sesión al total.

El script `scripts/post-commit-horas.sh` se ejecuta automáticamente en cada `git commit` y:
- Calcula las horas del día (rango primer–último commit + 30 min de buffer, mínimo 1h)
- Inserta o actualiza la fila del día
- Recalcula el total y la fecha de última actualización
