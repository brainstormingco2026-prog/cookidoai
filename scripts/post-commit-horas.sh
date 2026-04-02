#!/usr/bin/env bash
# scripts/post-commit-horas.sh
# Actualiza HORAS.md tras cada git commit.
# Instalado como: .git/hooks/post-commit -> ../../scripts/post-commit-horas.sh

REPO_ROOT=$(GIT_OPTIONAL_LOCKS=0 git rev-parse --show-toplevel)
HORAS_FILE="$REPO_ROOT/HORAS.md"

if [ ! -f "$HORAS_FILE" ]; then
  exit 0
fi

python3 - "$HORAS_FILE" <<'PYEOF'
import sys, subprocess, re, os
from datetime import date, datetime

horas_file = sys.argv[1]
hoy = date.today().strftime("%Y-%m-%d")

# Obtener commits de hoy. GIT_OPTIONAL_LOCKS=0 evita bloqueos en el hook.
env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
result = subprocess.run(
    ["git", "log", "--format=%ad|%s", "--date=format:%Y-%m-%d %H:%M"],
    env=env, capture_output=True, text=True
)
lines = [l for l in result.stdout.strip().split("\n") if l[:10] == hoy]

if not lines:
    sys.exit(0)

# Calcular rango horario + 30 min de buffer, mínimo 1h
times = [datetime.strptime(l.split("|")[0], "%Y-%m-%d %H:%M") for l in lines]
msgs  = [l.split("|", 1)[1] for l in lines]

diff_min = int((max(times) - min(times)).total_seconds() // 60) + 30
horas = max(1.0, round(diff_min / 60, 1))

# Descripción: hasta 3 mensajes únicos (los más recientes van primero en git log)
vistos = []
for m in msgs:
    if m not in vistos:
        vistos.append(m)
    if len(vistos) == 3:
        break
desc = "; ".join(vistos)

# Leer archivo
with open(horas_file, "r") as f:
    content = f.read()

fila = f"| {hoy} | {horas}h | {desc} |"
fila_re = re.compile(rf"^\| {re.escape(hoy)} \|.*$", re.MULTILINE)

if fila_re.search(content):
    content = fila_re.sub(fila, content)
else:
    content = content.replace("| **TOTAL**", fila + "\n| **TOTAL**")

# Recalcular total sumando todas las filas de sesión (YYYY-MM-DD)
session_re = re.compile(r"^\| (\d{4}-\d{2}-\d{2}) \| ([\d.]+)h \|", re.MULTILINE)
total = round(sum(float(m.group(2)) for m in session_re.finditer(content)), 1)
total_fmt = str(int(total)) if total == int(total) else str(total)
content = re.sub(r"\| \*\*TOTAL\*\* \| [^|]+ \|", f"| **TOTAL** | **{total_fmt}h** |", content)

# Actualizar fecha de última actualización en el resumen
content = re.sub(
    r"(\*\*Última actualización:\*\*) \S+",
    rf"\1 {hoy}",
    content
)
# Actualizar también la celda de la tabla de resumen
content = re.sub(
    r"(\| \*\*Total de horas\*\* \|) [\d.]+h",
    rf"\1 {total_fmt}h",
    content
)

with open(horas_file, "w") as f:
    f.write(content)

print(f"[horas] {hoy}: {horas}h → total {total_fmt}h (HORAS.md actualizado)")
PYEOF
