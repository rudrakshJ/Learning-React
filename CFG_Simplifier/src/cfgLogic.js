// ─── cfgLogic.js ──────────────────────────────────────────────────────────────
// Pure functions for CFG parsing and all 4 simplification steps.
// No React imports — this file is framework-agnostic.

// ─── Constants ────────────────────────────────────────────────────────────────

export const EXAMPLES = [
    "S -> A B | B C\nA -> B A | a\nB -> C C | b\nC -> A B | a",
    "S -> a S b | a b | B\nB -> c B | c | A\nA -> a A | ε",
    "S -> A B | ε\nA -> a A | ε\nB -> b B | b\nC -> c D\nD -> d | ε",
];

export const STEP_EXPLANATIONS = [
    "The original context-free grammar as entered. Non-terminals are shown in purple, terminals in green.",
    "Step 1 — Remove ε-productions: Find all nullable non-terminals (those that can derive ε). For each production containing a nullable symbol, add new versions with and without that symbol. Remove all ε-productions (except possibly S → ε if S is nullable).",
    "Step 2 — Remove unit productions: A unit production is A → B where B is a single non-terminal. Find all unit pairs via transitive closure, then replace each unit production A → B with all non-unit productions of B.",
    "Step 3 — Remove useless symbols: Remove non-generating symbols (can never derive a string of terminals) and non-reachable symbols (can never be reached from the start symbol S).",
    "Step 4 — Convert to CNF: Every production must be A → BC (two non-terminals) or A → a (single terminal). Replace terminals in long rules with new T-variables, then binarize rules with 3+ symbols using new B-variables.",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-clone a productions map { NonTerminal: string[][] }
 */
export function cloneProds(p) {
    const result = {};
    for (const k in p) result[k] = p[k].map((rhs) => [...rhs]);
    return result;
}

/**
 * Given a RHS array and a set of nullable symbols, generate every combination
 * of the RHS with each nullable symbol either included or omitted.
 */
function generateCombos(rhs, nullable) {
    const nullableIdx = rhs
        .map((s, i) => (nullable.has(s) ? i : -1))
        .filter((i) => i >= 0);
    const n = nullableIdx.length;
    const results = [];
    for (let mask = 0; mask < 1 << n; mask++) {
        const skip = new Set(nullableIdx.filter((_, j) => mask & (1 << j)));
        results.push(rhs.filter((_, i) => !skip.has(i)));
    }
    return results;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a multiline grammar string into a structured object.
 *
 * Input format (one rule per line):
 *   S -> A B | a b
 *   A -> B | ε
 *
 * Returns: { prods, start, order }
 *   prods  – { [NonTerminal]: string[][] }  (each inner array is one RHS)
 *   start  – the first non-terminal encountered (start symbol)
 *   order  – non-terminals in declaration order
 */
export function parseGrammar(text) {
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const prods = {};
    const order = [];

    for (const line of lines) {
        const match = line.match(/^([A-Z])\s*->\s*(.+)$/);
        if (!match) throw new Error(`Invalid production: "${line.trim()}"`);

        const lhs = match[1];
        if (!prods[lhs]) {
            prods[lhs] = [];
            order.push(lhs);
        }

        const alternatives = match[2].split("|").map((r) => r.trim().split(/\s+/));
        for (const rhs of alternatives) prods[lhs].push(rhs);
    }

    if (!order.length) throw new Error("No productions found.");
    return { prods, start: order[0], order };
}

// ─── Step 1: Remove ε-productions ────────────────────────────────────────────

/**
 * 1. Compute the set of nullable non-terminals (those deriving ε).
 * 2. For every production containing a nullable symbol, add variants
 *    with that symbol both present and absent.
 * 3. Remove all explicit ε-productions.
 *
 * Returns: { newProds, nullable, addedProds, removedProds, startNullable }
 */
export function step1_removeEpsilon(prods, start) {
    // Find all nullable non-terminals via fixed-point iteration
    const nullable = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const A in prods) {
            for (const rhs of prods[A]) {
                const isEpsilonRule = rhs.length === 1 && rhs[0] === "ε";
                const allNullable = rhs.every((s) => nullable.has(s));
                if ((isEpsilonRule || allNullable) && !nullable.has(A)) {
                    nullable.add(A);
                    changed = true;
                }
            }
        }
    }

    const newProds = {};
    const addedProds = {};
    const removedProds = {};

    for (const A in prods) {
        newProds[A] = [];
        addedProds[A] = [];
        removedProds[A] = [];

        for (const rhs of prods[A]) {
            if (rhs.length === 1 && rhs[0] === "ε") {
                removedProds[A].push(rhs);
                continue;
            }
            const combos = generateCombos(rhs, nullable);
            for (const combo of combos) {
                if (combo.length === 0) continue;
                const key = combo.join(" ");
                if (!newProds[A].some((r) => r.join(" ") === key)) {
                    newProds[A].push(combo);
                    if (!prods[A].some((r) => r.join(" ") === key)) {
                        addedProds[A].push(combo);
                    }
                }
            }
        }
    }

    return {
        newProds,
        nullable: [...nullable],
        addedProds,
        removedProds,
        startNullable: nullable.has(start),
    };
}

// ─── Step 2: Remove unit productions ─────────────────────────────────────────

/**
 * A unit production has the form A → B (single non-terminal on RHS).
 * 1. Compute unit pairs: A can unit-derive B if A ⇒* B using only unit rules.
 * 2. For each pair (A, B) where A ≠ B, add all non-unit productions of B to A.
 * 3. Remove all unit productions.
 *
 * Returns: { newProds, unitPairs, unitRemoved, unitAdded }
 */
export function step2_removeUnit(prods) {
    // Compute unit pairs via fixed-point (transitive closure)
    const unitPairs = {};
    for (const A in prods) unitPairs[A] = new Set([A]);

    let changed = true;
    while (changed) {
        changed = false;
        for (const A in prods) {
            for (const B of [...unitPairs[A]]) {
                if (!prods[B]) continue;
                for (const rhs of prods[B]) {
                    if (rhs.length === 1 && /^[A-Z]$/.test(rhs[0])) {
                        if (!unitPairs[A].has(rhs[0])) {
                            unitPairs[A].add(rhs[0]);
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    const newProds = {};
    const unitRemoved = {};
    const unitAdded = {};

    for (const A in prods) {
        newProds[A] = [];
        unitRemoved[A] = [];
        unitAdded[A] = [];

        // Keep only non-unit productions
        for (const rhs of prods[A]) {
            if (rhs.length === 1 && /^[A-Z]$/.test(rhs[0])) {
                unitRemoved[A].push(rhs);
            } else {
                newProds[A].push(rhs);
            }
        }

        // Pull in non-unit productions from unit-reachable non-terminals
        for (const B of unitPairs[A]) {
            if (B === A || !prods[B]) continue;
            for (const rhs of prods[B]) {
                if (rhs.length === 1 && /^[A-Z]$/.test(rhs[0])) continue;
                const key = rhs.join(" ");
                if (!newProds[A].some((r) => r.join(" ") === key)) {
                    newProds[A].push(rhs);
                    unitAdded[A].push(rhs);
                }
            }
        }
    }

    return {
        newProds,
        unitRemoved,
        unitAdded,
        unitPairs: Object.fromEntries(
            Object.entries(unitPairs).map(([k, v]) => [k, [...v]])
        ),
    };
}

// ─── Step 3: Remove useless symbols ──────────────────────────────────────────

/**
 * A symbol is useless if it is:
 *   - non-generating: can never produce a string of terminals, OR
 *   - non-reachable: cannot be derived from the start symbol.
 *
 * Returns: { newProds, generating, reachable, removed, kept }
 */
export function step3_removeUseless(prods, start) {
    // Phase 1: find generating symbols
    const generating = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const A in prods) {
            for (const rhs of prods[A]) {
                const allGenerate = rhs.every(
                    (s) => /^[a-z]$/.test(s) || s === "ε" || generating.has(s)
                );
                if (allGenerate && !generating.has(A)) {
                    generating.add(A);
                    changed = true;
                }
            }
        }
    }

    // Phase 2: find reachable symbols (BFS/fixed-point from start)
    const reachable = new Set([start]);
    changed = true;
    while (changed) {
        changed = false;
        for (const A of reachable) {
            if (!prods[A]) continue;
            for (const rhs of prods[A]) {
                for (const s of rhs) {
                    if (/^[A-Z]$/.test(s) && !reachable.has(s)) {
                        reachable.add(s);
                        changed = true;
                    }
                }
            }
        }
    }

    const removed = [];
    const kept = [];
    const newProds = {};

    for (const A in prods) {
        if (!generating.has(A) || !reachable.has(A)) {
            removed.push(A);
            continue;
        }
        kept.push(A);
        // Also filter out RHS symbols that are useless
        newProds[A] = prods[A].filter((rhs) =>
            rhs.every(
                (s) =>
                    /^[a-z]$/.test(s) ||
                    s === "ε" ||
                    (generating.has(s) && reachable.has(s))
            )
        );
    }

    return {
        newProds,
        generating: [...generating],
        reachable: [...reachable],
        removed,
        kept,
    };
}

// ─── Step 4: Convert to Chomsky Normal Form ───────────────────────────────────

/**
 * CNF requires every production to be either:
 *   A → BC  (exactly two non-terminals), or
 *   A → a   (exactly one terminal)
 *
 * Two transformations are applied:
 *   1. Terminal isolation: in any RHS of length ≥ 2, replace each terminal `a`
 *      with a fresh non-terminal T_a → a.
 *   2. Binarization: productions with 3+ symbols are broken into binary rules
 *      using fresh non-terminals B1, B2, …
 *
 * Returns: { newProds, termMap, breakAdded }
 */
export function step4_toCNF(prods) {
    let p = cloneProds(prods);

    // Phase 1: isolate terminals
    const termMap = {};  // terminal char → new non-terminal name
    let tCount = 0;

    for (const A in p) {
        p[A] = p[A].map((rhs) => {
            if (rhs.length < 2) return rhs;  // single-symbol rules stay unchanged
            return rhs.map((s) => {
                if (/^[a-z]$/.test(s)) {
                    if (!termMap[s]) termMap[s] = "T" + ++tCount;
                    return termMap[s];
                }
                return s;
            });
        });
    }
    // Add the new terminal rules
    for (const t in termMap) p[termMap[t]] = [[t]];

    // Phase 2: binarize long productions
    const breakAdded = {};  // new non-terminal → its binary RHS
    let bCount = 0;

    for (const A in p) {
        const newRhss = [];
        for (const rhs of p[A]) {
            if (rhs.length <= 2) {
                newRhss.push(rhs);
                continue;
            }
            // Fold right: [X, Y, Z, W] → [X, B1] where B1 → [Y, B2], B2 → [Z, W]
            let cur = [...rhs];
            while (cur.length > 2) {
                const label = "B" + ++bCount;
                breakAdded[label] = [cur[cur.length - 2], cur[cur.length - 1]];
                cur = [...cur.slice(0, cur.length - 2), label];
            }
            newRhss.push(cur);
        }
        p[A] = newRhss;
    }
    for (const b in breakAdded) p[b] = [breakAdded[b]];

    return { newProds: p, termMap, breakAdded };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run all four simplification steps in order and return an array of step
 * snapshots, each containing { label, type, prods, start, info }.
 */
export function computeAllSteps(grammar) {
    const steps = [];

    steps.push({
        label: "Original",
        type: "original",
        prods: cloneProds(grammar.prods),
        start: grammar.start,
        info: null,
    });

    let cur = cloneProds(grammar.prods);

    const s1 = step1_removeEpsilon(cur, grammar.start);
    cur = s1.newProds;
    steps.push({ label: "Remove ε-productions", type: "epsilon", prods: cloneProds(cur), start: grammar.start, info: s1 });

    const s2 = step2_removeUnit(cur);
    cur = s2.newProds;
    steps.push({ label: "Remove unit productions", type: "unit", prods: cloneProds(cur), start: grammar.start, info: s2 });

    const s3 = step3_removeUseless(cur, grammar.start);
    cur = s3.newProds;
    steps.push({ label: "Remove useless symbols", type: "useless", prods: cloneProds(cur), start: grammar.start, info: s3 });

    const s4 = step4_toCNF(cur);
    cur = s4.newProds;
    steps.push({ label: "Convert to CNF", type: "cnf", prods: cloneProds(cur), start: grammar.start, info: s4 });

    return steps;
}