"""로또 6/45 당첨번호 받기 + 분석 → data/draws.json, data/analysis.json
출처: 1) 동행복권 공식 API(국내에서만 열릴 때가 많음) 2) smok95/lotto 공개 JSON(GitHub). 둘 다 실패하면 기존 파일 유지.
분석: 시중 분석법(빈도·핫콜드·미출현·홀짝·고저·합계·연속·AC·끝수·소수·이월·동반 출현) + 표본외 역검증(각 방법으로 매 회차 직전까지만 보고 골랐다면 몇 개 맞았나)."""
import collections, datetime as dt, itertools, json, math, random, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MIRROR = "https://raw.githubusercontent.com/smok95/lotto/main/results/all.json"
OFFICIAL = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={}"
ALL = range(1, 46)
PRIMES = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43}


def get(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_draws():
    old = json.load(open(DATA / "draws.json", encoding="utf-8")) if (DATA / "draws.json").exists() else []
    by = {d["no"]: d for d in old}
    try:
        for d in get(MIRROR, 60):
            n = sorted(int(x) for x in d["numbers"])
            dvs = (d.get("divisions") or []) + [{}] * 5
            pz = lambda i: (dvs[i] or {}).get("prize")
            by[int(d["draw_no"])] = {"no": int(d["draw_no"]), "date": d["date"][:10], "n": n, "b": int(d["bonus_no"]),
                                     "w1": (dvs[0] or {}).get("winners"), "p1": pz(0), "p2": pz(1), "p3": pz(2), "sales": d.get("total_sales_amount")}
            wc = d.get("winners_combination") or {}
            if wc:   # 1등 번호 고른 방식(자동·반자동·수동 인원) — 262회부터
                by[int(d["draw_no"])]["wc"] = [wc.get("auto", 0) or 0, wc.get("semi_auto", 0) or 0, wc.get("manual", 0) or 0]
        print(f"공개 JSON {len(by)}회")
    except Exception as e:
        print("공개 JSON 실패:", type(e).__name__, e)
    # 공식 API로 다음 회차들 보충(열리면)
    nxt = max(by) + 1 if by else 1
    for _ in range(5):
        try:
            d = get(OFFICIAL.format(nxt), 15)
        except Exception as e:
            print("공식 API 안 열림:", type(e).__name__)
            break
        if d.get("returnValue") != "success":
            break
        by[nxt] = {"no": nxt, "date": d["drwNoDate"], "n": sorted(d[f"drwtNo{i}"] for i in range(1, 7)), "b": d["bnusNo"],
                   "w1": d.get("firstPrzwnerCo"), "p1": d.get("firstWinamnt"), "sales": d.get("totSellamnt")}
        nxt += 1
    draws = [by[k] for k in sorted(by)]
    for d in draws:   # 형식 점검
        assert len(set(d["n"])) == 6 and all(1 <= x <= 45 for x in d["n"]), d
    assert [d["no"] for d in draws] == list(range(1, len(draws) + 1)), "회차가 빠짐"
    return draws


def feats(s):
    s = sorted(s)
    diffs = {b - a for a, b in itertools.combinations(s, 2)}
    ends = collections.Counter(x % 10 for x in s)
    return {"odd": sum(x % 2 for x in s), "low": sum(x <= 22 for x in s), "sum": sum(s),
            "consec": sum(1 for a, b in zip(s, s[1:]) if b - a == 1), "ac": len(diffs) - 5,
            "same_end": max(ends.values()), "prime": sum(x in PRIMES for x in s)}


def sumbin(v):
    lo = max(60, min(200, v // 20 * 20))
    return "~79" if v < 80 else "200~" if v >= 200 else f"{lo}~{lo + 19}"


def dist(rows, key, fn=None):
    c = collections.Counter(fn(r[key]) if fn else r[key] for r in rows)
    t = sum(c.values())
    return {str(k): round(v / t * 100, 1) for k, v in sorted(c.items(), key=lambda x: (str(x[0]) if fn else x[0]))}


# ---------- 역검증용 고르기 방법 (직전 회차까지만 본다)
def counts(hist, k=None):
    return collections.Counter(x for d in (hist[-k:] if k else hist) for x in d["n"])


def m_hot(k):
    return lambda h, r: sorted(ALL, key=lambda n, c=counts(h, k): (-c[n], n))[:6]


def m_cold(k):
    return lambda h, r: sorted(ALL, key=lambda n, c=counts(h, k): (c[n], n))[:6]


def m_overdue(h, r):
    last = {}
    for i, d in enumerate(h):
        for x in d["n"]:
            last[x] = i
    return sorted(ALL, key=lambda n: (last.get(n, -1), n))[:6]


def ok_filter(s):
    f = feats(s)
    return 2 <= f["odd"] <= 4 and 2 <= f["low"] <= 4 and 100 <= f["sum"] <= 175 and f["consec"] <= 1 and f["ac"] >= 7


def m_filter(h, r):
    while True:
        s = r.sample(range(1, 46), 6)
        if ok_filter(s):
            return s


def m_carry(h, r):
    prev = r.sample(h[-1]["n"], 2)
    return prev + r.sample([x for x in ALL if x not in prev], 4)


def m_hotmix(h, r):   # 최근 30회 많이 나온 15개 중 무작위 6개
    c = counts(h, 30)
    return r.sample(sorted(ALL, key=lambda n: (-c[n], n))[:15], 6)


METHODS = [
    ("무작위(자동)", lambda h, r: r.sample(range(1, 46), 6), 20),
    ("전체 최다 출현 6개", m_hot(None), 1),
    ("최근 10회 핫 6개", m_hot(10), 1),
    ("최근 50회 핫 6개", m_hot(50), 1),
    ("최근 30회 핫 15개 중 무작위", m_hotmix, 20),
    ("최근 50회 콜드 6개", m_cold(50), 1),
    ("장기 미출현 6개", m_overdue, 1),
    ("필터 조합(홀짝·고저·합·연속·AC)", m_filter, 20),
    ("이월수 2개 + 무작위", m_carry, 20),
]
START = 100


def crowdy(s):
    """많이 고르는 모양: 모두 31 이하(생일), 연속 2쌍↑, 등차, 7칸 줄 2개 이하에 몰림 (app.js crowdy 와 같게)"""
    s = sorted(s)
    f = feats(s)
    step = s[1] - s[0]
    return (sum(x <= 31 for x in s) == 6 or f["consec"] >= 2 or all(s[k] - s[k - 1] == step for k in range(1, 6))
            or len({(x - 1) // 7 for x in s}) <= 2)


def m_rec(h, r):   # 앱 추천: 무작위 + 많이 고르는 모양 피하기 + 역대 1등 조합 제외
    past = {tuple(d["n"]) for d in h}
    while True:
        s = sorted(r.sample(range(1, 46), 6))
        if not crowdy(s) and tuple(s) not in past:
            return s


def summary(name, hits, tot, ndraw, var):
    mean = sum(k * v for k, v in hits.items()) / tot
    se = math.sqrt(var / ndraw)   # 같은 회차를 여러 번 돌려도 독립 표본은 회차 수만큼
    return {"name": name, "tickets": tot, "draws": ndraw, "mean": round(mean, 4),
            "ci": [round(mean - 1.96 * se, 4), round(mean + 1.96 * se, 4)],
            "ge3": round(sum(v for k, v in hits.items() if k >= 3) / tot * 100, 3),
            "ge4": round(sum(v for k, v in hits.items() if k >= 4) / tot * 100, 4),
            "dist": [hits[k] for k in range(7)]}


def backtest(draws):
    """방법마다 '승률'(5등 이상 = 3개↑ 맞은 비율)과 평균 맞은 개수. 거기에 '그때까지 가장 잘 맞던 방법을 다음 회차에 쓰기'(최적 방법 따라가기)도 표본외로."""
    N = len(draws)
    var = 6 * (6 / 45) * (39 / 45) * (39 / 44)   # 한 장 맞은 개수 분산(초기하)
    meths = METHODS + [("앱 추천(무작위 + 많이 고르는 모양 피하기)", m_rec, 20)]
    res, per = [], {}
    for name, f, reps in meths:
        rng = random.Random(7)
        hits = collections.Counter()
        tot = 0
        for rep in range(reps):
            seq = []
            for i in range(START, N):
                m = len(set(f(draws[:i], rng)) & set(draws[i]["n"]))
                hits[m] += 1
                tot += 1
                seq.append(m)
            if rep == 0:
                per[name] = seq
        res.append(summary(name, hits, tot, N - START, var))
    # 최적 방법 따라가기: 회차 i 에서, i 직전까지 '3개↑ 횟수'(동점이면 평균 맞은 개수)가 가장 좋던 방법의 고른 번호를 쓴다
    names = [n for n, _, _ in METHODS]
    metas = {"지금까지 승률 1위 방법 따라가기": None, "최근 52회 승률 1위 방법 따라가기": 52}
    for label, win in metas.items():
        hits = collections.Counter()
        picks = collections.Counter()
        for t in range(1, N - START):
            lo = 0 if win is None else max(0, t - win)
            best = max(names, key=lambda n: (sum(x >= 3 for x in per[n][lo:t]), sum(per[n][lo:t])))
            picks[best] += 1
            hits[per[best][t]] += 1
        r = summary(label, hits, sum(hits.values()), N - START - 1, var)
        r["meta"] = True
        r["picked"] = picks.most_common(3)
        res.append(r)
    p3 = sum(math.comb(6, k) * math.comb(39, 6 - k) for k in range(3, 7)) / math.comb(45, 6)
    p4 = sum(math.comb(6, k) * math.comb(39, 6 - k) for k in range(4, 7)) / math.comb(45, 6)
    return {"from": START + 1, "theory_mean": 0.8, "theory_ge3": round(p3 * 100, 3), "theory_ge4": round(p4 * 100, 4),
            "ge3_se": round(math.sqrt(p3 * (1 - p3) / (N - START)) * 100, 3), "methods": res}


def crowd(draws):
    """1등 당첨자 수 ÷ 무작위 기대(판매 장수 ÷ 8,145,060): 사람들이 많이 고르는 번호 모양이면 1등을 나눠 갖는다"""
    rows = [d for d in draws if d.get("w1") is not None and d.get("sales")]
    out = {}
    for label, key in [("low31", lambda n: sum(x <= 31 for x in n)),
                       ("consec", lambda n: min(2, sum(1 for a, b in zip(n, n[1:]) if b - a == 1))),
                       ("max40", lambda n: "40 이상" if n[-1] >= 40 else "39 이하")]:
        g = collections.defaultdict(lambda: [0, 0.0, 0])
        for d in rows:
            k = str(key(d["n"]))
            g[k][0] += d["w1"]
            g[k][1] += d["sales"] / 1000 / 8145060
            g[k][2] += 1
        out[label] = {k: {"draws": c, "winners": w, "expect": round(e, 1)} for k, (w, e, c) in sorted(g.items())}
    return {"draws": len(rows), "groups": out}


ELIM_RULES = [
    ("연속 번호 2쌍 이상", lambda f, s: f["consec"] >= 2),
    ("홀수만 · 짝수만", lambda f, s: f["odd"] in (0, 6)),
    ("합 100 미만 · 175 초과", lambda f, s: not 100 <= f["sum"] <= 175),
    ("등차 (1·3·5·7·9·11 같은)", lambda f, s: all(s[k] - s[k - 1] == s[1] - s[0] for k in range(1, 6))),
    ("AC 6 이하 (간격이 단조로움)", lambda f, s: f["ac"] <= 6),
    ("시중 필터 전체", lambda f, s: not ok_filter(s)),
]


def elimination(draws):
    """패턴 소거: 그 패턴 조합을 지우면 전체 조합의 몇 %가 빠지나 vs 실제 당첨번호가 그 안에 있던 비율 (같으면 소거 효과 없음)"""
    tot = [0] * len(ELIM_RULES)
    for s in itertools.combinations(range(1, 46), 6):
        f = feats(s)
        for i, (_, r) in enumerate(ELIM_RULES):
            tot[i] += r(f, s)
    out = []
    for i, (name, r) in enumerate(ELIM_RULES):
        w = sum(1 for d in draws if r(feats(d["n"]), d["n"]))
        out.append({"name": name, "combos": tot[i], "combo_pct": round(tot[i] / 8145060 * 100, 2), "wins": w, "win_pct": round(w / len(draws) * 100, 2)})
    return out


# ---------- 추천 방식(설정에서 고름): 회차마다 10줄, 같은 줄·역대 1등 조합 없음, 줄끼리 많이 안 겹침
# 각 방식은 h(그 회차 직전까지 기록)를 받아 '한 줄 뽑기' 함수를 돌려준다(후보 계산은 회차마다 한 번)
def _from_pool(pool):
    return lambda r: sorted(r.sample(pool, 6))


def _top(h, k, low):
    c = counts(h, k)
    return sorted(ALL, key=lambda n: ((c[n] if low else -c[n]), n))[:20]


def _gaps(h):
    last = {}
    for i, d in enumerate(h):
        for x in d["n"]:
            last[x] = i
    return sorted(ALL, key=lambda n: (last.get(n, -1), n))[:20]


def _any(r):
    return sorted(r.sample(range(1, 46), 6))


def _filtered(r):
    while True:
        s = sorted(r.sample(range(1, 46), 6))
        if ok_filter(s):
            return s


# (키, 이름, 뽑기 만들기, 많이 고르는 모양 피하기, 줄끼리 최대 겹침)
REC_METHODS = [
    ("basic", "기본: 많이 고르는 모양 피하기", lambda h: _any, True, 2),
    ("random", "완전 무작위 (자동과 같음)", lambda h: _any, False, 6),
    ("hot", "핫: 최근 30회 많이 나온 20개 중", lambda h: _from_pool(_top(h, 30, False)), False, 3),
    ("cold", "콜드: 최근 30회 적게 나온 20개 중", lambda h: _from_pool(_top(h, 30, True)), False, 3),
    ("overdue", "미출현: 오래 안 나온 20개 중", lambda h: _from_pool(_gaps(h)), False, 3),
    ("filter", "패턴 맞춤: 홀짝·고저·합·연속·AC", lambda h: _filtered, False, 2),
]


def rec_lines(h, method, seed, n=10, past=None):
    _, _, mk, avoid, ov = next(m for m in REC_METHODS if m[0] == method)
    pick, r = mk(h), random.Random(seed)
    past = past if past is not None else {tuple(d["n"]) for d in h}
    out = []
    for _ in range(5000):
        if len(out) == n:
            break
        s = tuple(pick(r))
        if s in past or s in out or (avoid and crowdy(s)) or any(len(set(s) & set(o)) > ov for o in out):
            continue
        out.append(s)
    return [list(x) for x in out]


def rec_backtest(draws):
    """각 추천 방식을 지난 회차마다 그 직전 기록만으로 10줄 만들었다면: 등수별 횟수·쓴 돈·받은 돈 (당첨금 = 그 회차 실제 1~3등, 4등 5만·5등 5천)"""
    out, recent = [], {}
    for key, name, _, _, _ in REC_METHODS:
        rank = collections.Counter()
        spent = won = 0
        rows, hits = [], []
        past = {tuple(d["n"]) for d in draws[:START]}
        for i in range(START, len(draws)):
            d = draws[i]
            best = 0
            for s in rec_lines(draws[:i], key, d["no"] * 7919, past=past):
                m = len(set(s) & set(d["n"]))
                rk = 1 if m == 6 else 2 if m == 5 and d["b"] in s else 3 if m == 5 else 4 if m == 4 else 5 if m == 3 else 0
                rank[rk] += 1
                spent += 1000
                pz = {1: d.get("p1") or 0, 2: d.get("p2") or 0, 3: d.get("p3") or 0, 4: 50000, 5: 5000}.get(rk, 0)
                won += pz
                if 1 <= rk <= 4:
                    hits.append([d["no"], rk, pz])   # 4등 이상 맞은 회차(앱 '언제 맞았나')
                best = max(best, m)
            rows.append([d["no"], best])
            past.add(tuple(d["n"]))
        lines = sum(rank.values())
        out.append({"key": key, "name": name, "draws": len(draws) - START, "lines": lines, "rank": [rank[k] for k in range(1, 6)],
                    "ge3": round(sum(rank[k] for k in range(1, 6)) / lines * 100, 3), "spent": spent, "won": won,
                    "roi": round(won / spent * 100, 1), "hits": hits})
        recent[key] = rows[-30:]
    return {"from": START + 1, "methods": out, "recent": recent}


def analyze(draws):
    N = len(draws)
    cnt = counts(draws)
    exp = N * 6 / 45
    gap = {}
    for n in ALL:
        g = 0
        for d in reversed(draws):
            if n in d["n"]:
                break
            g += 1
        gap[n] = g
    rng = random.Random(1)
    sim = [feats(rng.sample(range(1, 46), 6)) for _ in range(200000)]
    real = [feats(d["n"]) for d in draws]
    pats = {k: {"real": dist(real, k, fn), "random": dist(sim, k, fn)}
            for k, fn in [("odd", None), ("low", None), ("sum", sumbin), ("consec", None), ("ac", None), ("same_end", None), ("prime", None)]}
    carry = collections.Counter(len(set(draws[i]["n"]) & set(draws[i - 1]["n"])) for i in range(1, N))
    pairs = collections.Counter(p for d in draws for p in itertools.combinations(d["n"], 2))
    filt_share = sum(ok_filter(rng.sample(range(1, 46), 6)) for _ in range(100000)) / 1000
    return {
        "updated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="minutes"),
        "n_draws": N, "last": draws[-1],
        "freq": [cnt[n] for n in ALL], "freq_expect": round(exp, 1),
        "chi2": round(sum((cnt[n] - exp) ** 2 / exp for n in ALL), 1), "chi2_crit": 60.48,
        "recent10": [counts(draws, 10)[n] for n in ALL], "recent50": [counts(draws, 50)[n] for n in ALL],
        "gap": [gap[n] for n in ALL],
        "patterns": pats,
        "carry": {str(k): round(v / (N - 1) * 100, 1) for k, v in sorted(carry.items())},
        "pairs_top": [[list(p), c] for p, c in pairs.most_common(10)], "pair_expect": round(N * 15 / 990, 1),
        "filter_share": round(filt_share, 1),
        "backtest": backtest(draws),
        "crowd": crowd(draws),
        "elim": elimination(draws),
        "rec_bt": rec_backtest(draws),
        "rec_next": {m[0]: rec_lines(draws, m[0], (draws[-1]["no"] + 1) * 7919) for m in REC_METHODS},
        "how1": {"draws": sum(1 for d in draws if d.get("wc")), "from": next((d["no"] for d in draws if d.get("wc")), None),
                 "auto": sum(d["wc"][0] for d in draws if d.get("wc")), "semi": sum(d["wc"][1] for d in draws if d.get("wc")),
                 "manual": sum(d["wc"][2] for d in draws if d.get("wc"))},
    }


def main():
    DATA.mkdir(exist_ok=True)
    draws = load_draws()
    old = json.load(open(DATA / "draws.json", encoding="utf-8")) if (DATA / "draws.json").exists() else []
    if old and len(old) == len(draws) and "--force" not in sys.argv:
        print("새 회차 없음")
        return
    json.dump(draws, open(DATA / "draws.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(analyze(draws), open(DATA / "analysis.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(draws)}회 저장 (마지막 {draws[-1]['no']}회 {draws[-1]['date']})")


if __name__ == "__main__":
    main()
