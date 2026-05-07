# maximizar_onefa.py
# Requiere: pip install ortools
# Uso: python maximizar_onefa.py [--year 2026]   (default: 2026)

from __future__ import annotations
import argparse
from typing import Dict, List, Tuple
from ortools.sat.python import cp_model
import json
import os

# ========================= CLI =========================
def parse_args():
    parser = argparse.ArgumentParser(description="Optimizador de posición ONEFA")
    parser.add_argument("--year", type=int, default=2026, choices=[2025, 2026],
                        help="Temporada a analizar (default: 2026)")
    parser.add_argument("--team", type=str, default=None,
                        help="Equipo objetivo (sobreescribe el default del año)")
    return parser.parse_args()

DEFAULT_TEAM = {
    2025: "Leones UAMN",
    2026: "Leones UAMN",
}

# ========================= Carga de datos =========================
def load_json_data(year: int) -> Tuple[int, List[Dict]]:
    filename = f"onefa_data_{year}.json"
    base_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base_dir, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"No se encontró el archivo {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    jornadas_jugadas = int(data.get("jornadas_jugadas", 0))
    juegos = data.get("juegos", [])
    if not juegos:
        raise ValueError(f"El archivo {filename} no contiene el arreglo 'juegos'.")
    return jornadas_jugadas, juegos


# ========================= Funciones auxiliares =========================
def teams_from_games(juegos: List[Dict]) -> List[str]:
    return sorted({g["local"] for g in juegos} | {g["visita"] for g in juegos})

def get_game_result_all(juegos_full: List[Dict], team1: str, team2: str):
    for g in juegos_full:
        L, V = g["local"], g["visita"]
        sl, sv = g["scoreLocal"], g["scoreVisita"]
        if (L == team1 and V == team2) or (L == team2 and V == team1):
            if sl + sv <= 0 or sl == sv:
                return None
            if L == team1:
                return 1 if sl > sv else -1
            else:
                return 1 if sv > sl else -1
    return None

def compute_standings_like_sim(juegos_full: List[Dict]) -> List[Dict]:
    equipos = teams_from_games(juegos_full)
    stats = {t: {"pj": 0, "pg": 0, "pf": 0, "pc": 0} for t in equipos}
    for g in juegos_full:
        sl, sv = g["scoreLocal"], g["scoreVisita"]
        if sl + sv > 0 and sl != sv:
            L, V = g["local"], g["visita"]
            stats[L]["pj"] += 1; stats[V]["pj"] += 1
            stats[L]["pf"] += sl; stats[L]["pc"] += sv
            stats[V]["pf"] += sv; stats[V]["pc"] += sl
            if sl > sv: stats[L]["pg"] += 1
            else:       stats[V]["pg"] += 1
    for t in equipos:
        s = stats[t]
        s["pp"] = s["pj"] - s["pg"]
        s["pct"] = (s["pg"] / s["pj"]) if s["pj"] > 0 else 0.0
    table = [{"equipo": t, **stats[t]} for t in equipos]
    table.sort(key=lambda r: r["pct"], reverse=True)
    i = 0; out = []
    while i < len(table):
        j = i; pct_ref = table[i]["pct"]
        while j < len(table) and table[j]["pct"] == pct_ref:
            j += 1
        group = table[i:j]
        if len(group) > 1:
            undefeated = None
            for row in group:
                beat_all = True
                for other in group:
                    if row["equipo"] == other["equipo"]: continue
                    res = get_game_result_all(juegos_full, row["equipo"], other["equipo"])
                    if res != 1:
                        beat_all = False; break
                if beat_all:
                    undefeated = row["equipo"]; break
            group.sort(key=lambda r: (0 if (undefeated and r["equipo"] == undefeated) else 1, r["pc"]))
        out.extend(group)
        i = j
    return out

def base_stats(juegos: List[Dict], last_jornada: int) -> Dict[str, Dict[str, int]]:
    equipos = teams_from_games(juegos)
    stats = {t: {"PG": 0, "PP": 0} for t in equipos}
    for g in juegos:
        if g["jornada"] > last_jornada: continue
        sl, sv = g["scoreLocal"], g["scoreVisita"]
        if sl == 0 and sv == 0: continue
        L, V = g["local"], g["visita"]
        if sl > sv: stats[L]["PG"] += 1; stats[V]["PP"] += 1
        elif sv > sl: stats[V]["PG"] += 1; stats[L]["PP"] += 1
    return stats


# ========================= Modelo 1 — Escenarios =========================
def model1_optimal_winners(base, juegos, last_jornada, target_team, k=3):
    pendientes = [(i, g) for i, g in enumerate(juegos) if g["jornada"] > last_jornada]
    model = cp_model.CpModel()
    x = {i: model.NewBoolVar(f"x_{i}") for i, _ in pendientes}

    equipos = list(base.keys())
    W = {t: model.NewIntVar(0, 20, f"W_{t}") for t in equipos}
    for t in equipos:
        expr = base[t]["PG"]
        for i, g in pendientes:
            L, V = g["local"], g["visita"]
            if L == t: expr += x[i]
            elif V == t: expr += (1 - x[i])
        model.Add(W[t] == expr)

    y = {}
    E = target_team
    for t in equipos:
        if t == E: continue
        y[t] = model.NewBoolVar(f"ahead_{t}")
        diff = model.NewIntVar(-20, 20, f"diff_{t}")
        model.Add(diff == W[t] - W[E])
        model.Add(diff >= 1).OnlyEnforceIf(y[t])
        model.Add(diff <= 0).OnlyEnforceIf(y[t].Not())

    model.Minimize(1000 * sum(y.values()) - W[E])

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 20.0
    solver.parameters.num_search_workers = 8

    solutions = []
    locked = False

    while len(solutions) < k:
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        sol = {i: int(solver.Value(x[i])) for i, _ in pendientes}
        solutions.append(sol)
        if not locked:
            best_teams_ahead = sum(int(solver.Value(v)) for v in y.values())
            best_w = solver.Value(W[E])
            model.Add(sum(y.values()) == best_teams_ahead)
            model.Add(W[E] == best_w)
            locked = True
        lits = []
        for i, _ in pendientes:
            if sol[i] == 1: lits.append(1 - x[i])
            else: lits.append(x[i])
        model.Add(sum(lits) >= 1)
    return solutions


# ========================= Modelo 2 — Marcadores =========================
def model2_scores(juegos, winners, last_jornada, target_team):
    model = cp_model.CpModel()
    pendientes = [(i, g) for i, g in enumerate(juegos) if g["jornada"] > last_jornada]

    MAX_TD, MAX_FG, MAX_SF = 9, 6, 3
    def make_score(prefix):
        td = model.NewIntVar(0, MAX_TD, f"{prefix}_td")
        xp = model.NewIntVar(0, MAX_TD, f"{prefix}_xp")
        tp = model.NewIntVar(0, MAX_TD, f"{prefix}_tp")
        fg = model.NewIntVar(0, MAX_FG, f"{prefix}_fg")
        sf = model.NewIntVar(0, MAX_SF, f"{prefix}_sf")
        model.Add(xp + tp <= td)
        s = model.NewIntVar(0, 200, f"{prefix}_score")
        model.Add(s == 6 * td + xp + 2 * tp + 3 * fg + 2 * sf)
        return s

    sL, sV = {}, {}
    objective_terms = []
    for i, g in pendientes:
        l = make_score(f"g{i}_L")
        v = make_score(f"g{i}_V")
        sL[i], sV[i] = l, v
        if winners[i] == 1: model.Add(l >= v + 1)
        else:                model.Add(v >= l + 1)
        if g["local"]  == target_team: objective_terms.append(v)
        if g["visita"] == target_team: objective_terms.append(l)
        objective_terms.append(l + v)

    model.Minimize(100 * sum(objective_terms))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError("Modelo 2 sin marcadores factibles.")

    out = {}
    for i, _ in pendientes:
        out[i] = (int(solver.Value(sL[i])), int(solver.Value(sV[i])))
    return out


# ========================= Ensamble =========================
def merge_scores(juegos, scores_rest, last_jornada):
    merged = []
    for i, g in enumerate(juegos):
        if g["jornada"] <= last_jornada:
            merged.append(dict(g))
        else:
            sl, sv = scores_rest[i]
            h = dict(g); h["scoreLocal"] = sl; h["scoreVisita"] = sv
            merged.append(h)
    return merged

def print_projected_scores(juegos, scores_rest, last_jornada):
    jornadas: Dict[int, list] = {}
    for i, g in enumerate(juegos):
        if g["jornada"] > last_jornada:
            jornadas.setdefault(g["jornada"], []).append((i, g))
    for j in sorted(jornadas):
        print(f"- Jornada {j}:")
        for i, g in jornadas[j]:
            sl, sv = scores_rest[i]
            ganador = g["local"] if sl > sv else g["visita"]
            print(f"    {g['local']} {sl} – {sv} {g['visita']}    (gana {ganador})")


# ========================= Main =========================
def main():
    args = parse_args()
    YEAR = args.year
    TARGET_TEAM = args.team if args.team else DEFAULT_TEAM[YEAR]

    print(f"=== Temporada {YEAR} | Equipo objetivo: {TARGET_TEAM} ===\n")

    last_jornada, JUEGOS = load_json_data(YEAR)
    base = base_stats(JUEGOS, last_jornada)
    scenarios = model1_optimal_winners(base, JUEGOS, last_jornada, TARGET_TEAM, k=3)
    print(f"Escenarios encontrados: {len(scenarios)}")

    for idx, winners in enumerate(scenarios, 1):
        print(f"\n=== ESCENARIO #{idx} ===")
        scores = model2_scores(JUEGOS, winners, last_jornada, TARGET_TEAM)
        print("Marcadores proyectados en jornadas faltantes:")
        print_projected_scores(JUEGOS, scores, last_jornada)
        juegos_full = merge_scores(JUEGOS, scores, last_jornada)
        ranking = compute_standings_like_sim(juegos_full)
        pos = 1 + [i for i, r in enumerate(ranking) if r["equipo"] == TARGET_TEAM][0]
        print(f"\nPosición de {TARGET_TEAM}: #{pos}")
        print("Tabla proyectada:")
        for k, row in enumerate(ranking, 1):
            dif = row["pf"] - row["pc"]
            print(f"{k:02d}. {row['equipo']:22s} PJ={row['pj']:2d} PG={row['pg']:2d} "
                  f"PCT={row['pct']:.3f}  PF={row['pf']:3d}  PC={row['pc']:3d}  DIF={dif:4d}")


if __name__ == "__main__":
    main()
