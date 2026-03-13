import { useState } from "react";
import "./App.css";
import {
  parseGrammar,
  computeAllSteps,
  EXAMPLES,
  STEP_EXPLANATIONS,
} from "./cfgLogic";

// ─── Primitive Syntax Spans ───────────────────────────────────────────────────

function NTSpan({ children }) {
  return <span className="sym--nt">{children}</span>;
}

function TSpan({ children }) {
  return <span className="sym--t">{children}</span>;
}

// Renders a right-hand side array with color-coded symbols
function ProdRHS({ rhs }) {
  return (
      <span>
      {rhs.map((s, i) => (
          <span key={i}>
          {i > 0 && " "}
            {s === "ε" ? (
                <span className="sym--eps">ε</span>
            ) : /^[A-Z]/.test(s) ? (
                <NTSpan>{s}</NTSpan>
            ) : (
                <TSpan>{s}</TSpan>
            )}
        </span>
      ))}
    </span>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ type, children }) {
  return (
      <span className={`badge badge--${type}`}>{children}</span>
  );
}

// ─── Info Panel ───────────────────────────────────────────────────────────────
// Shows step-specific metadata (nullable sets, unit pairs, useless symbols, CNF vars)

function InfoPanel({ step }) {
  const { type, info } = step;
  if (!info) return null;

  if (type === "epsilon") {
    return (
        <div className="info-panel">
          {info.nullable.length > 0 ? (
              <p>
                <strong>Nullable non-terminals: </strong>
                {info.nullable.map((n, i) => (
                    <span key={i}>
                <NTSpan>{n}</NTSpan>
                      {i < info.nullable.length - 1 ? ", " : ""}
              </span>
                ))}
              </p>
          ) : (
              <p style={{ color: "#6b7280" }}>No nullable non-terminals found.</p>
          )}
          {info.startNullable && (
              <p className="info-panel__nullable-warning">
                ⚠ Start symbol is nullable — the language contains ε.
              </p>
          )}
        </div>
    );
  }

  if (type === "unit") {
    const pairs = Object.entries(info.unitPairs).filter(([, v]) => v.length > 1);
    if (!pairs.length)
      return <p className="info-panel" style={{ color: "#6b7280", marginBottom: 12 }}>No unit productions found.</p>;
    return (
        <div className="info-panel">
          <p><strong>Unit pairs:</strong></p>
          <div className="info-panel__pairs">
            {pairs.map(([a, bs]) => (
                <span key={a} className="info-panel__pair-chip">
              <NTSpan>{a}</NTSpan> ⇒* {"{"}
                  {bs.map((b, i) => (
                      <span key={i}>
                  <NTSpan>{b}</NTSpan>
                        {i < bs.length - 1 ? ", " : ""}
                </span>
                  ))}
                  {"}"}
            </span>
            ))}
          </div>
        </div>
    );
  }

  if (type === "useless") {
    return (
        <div className="info-panel__row-group">
        <span>
          <strong>Generating: </strong>
          {info.generating.map((n, i) => (
              <span key={i}>
              <NTSpan>{n}</NTSpan>
                {i < info.generating.length - 1 ? ", " : ""}
            </span>
          ))}
        </span>
          <span>
          <strong>Reachable: </strong>
            {info.reachable.map((n, i) => (
                <span key={i}>
              <NTSpan>{n}</NTSpan>
                  {i < info.reachable.length - 1 ? ", " : ""}
            </span>
            ))}
        </span>
          {info.removed.length > 0 && (
              <span>
            <strong>Removed: </strong>
                {info.removed.map((n, i) => (
                    <span key={i} style={{ opacity: 0.5 }}>
                <NTSpan>{n}</NTSpan>
                      {i < info.removed.length - 1 ? ", " : ""}
              </span>
                ))}
          </span>
          )}
        </div>
    );
  }

  if (type === "cnf") {
    return (
        <div className="info-panel">
          {Object.keys(info.termMap).length > 0 && (
              <p>
                <strong>Terminal substitutions: </strong>
                {Object.entries(info.termMap).map(([t, v], i, arr) => (
                    <span key={t} style={{ fontFamily: "monospace" }}>
                <NTSpan>{v}</NTSpan> → <TSpan>{t}</TSpan>
                      {i < arr.length - 1 ? "  " : ""}
              </span>
                ))}
              </p>
          )}
          {Object.keys(info.breakAdded).length > 0 && (
              <p>
                <strong>New binarizing variables: </strong>
                {Object.keys(info.breakAdded).map((b, i, arr) => (
                    <span key={b} style={{ fontFamily: "monospace" }}>
                <NTSpan>{b}</NTSpan>
                      {i < arr.length - 1 ? ", " : ""}
              </span>
                ))}
              </p>
          )}
        </div>
    );
  }

  return null;
}

// ─── Productions Table ────────────────────────────────────────────────────────
// Shows all productions for the current step with diff annotations

function ProductionsTable({ step, prevStep }) {
  const { prods, type } = step;
  const rows = [];

  for (const A in prods) {
    const isNewVar = prevStep && !prevStep.prods[A];

    for (const rhs of prods[A]) {
      const key = rhs.join(" ");
      let badge = null;

      if (isNewVar) {
        badge = <Badge type="new">new variable</Badge>;
      } else if (prevStep) {
        const wasIn = prevStep.prods[A]?.some((r) => r.join(" ") === key);
        if (!wasIn) {
          if (type === "epsilon") badge = <Badge type="added">added</Badge>;
          else if (type === "unit") badge = <Badge type="unit">from unit</Badge>;
        }
      }

      rows.push(
          <tr key={`${A}-${key}`}>
            <td><NTSpan>{A}</NTSpan></td>
            <td>→ <ProdRHS rhs={rhs} /></td>
            <td>{badge}</td>
          </tr>
      );
    }

    // Show removed productions (struck through) for non-useless steps
    if (prevStep && prevStep.prods[A] && type !== "useless") {
      for (const rhs of prevStep.prods[A]) {
        const key = rhs.join(" ");
        if (!prods[A]?.some((r) => r.join(" ") === key)) {
          rows.push(
              <tr key={`removed-${A}-${key}`} className="row--removed">
                <td><NTSpan>{A}</NTSpan></td>
                <td className="prod-rhs--strikethrough">→ <ProdRHS rhs={rhs} /></td>
                <td><Badge type="removed">removed</Badge></td>
              </tr>
          );
        }
      }
    }
  }

  // Show entirely removed variables for the useless step
  if (prevStep && type === "useless") {
    for (const A in prevStep.prods) {
      if (!prods[A]) {
        for (const rhs of prevStep.prods[A]) {
          rows.push(
              <tr key={`useless-${A}-${rhs.join(" ")}`} className="row--useless">
                <td><NTSpan>{A}</NTSpan></td>
                <td className="prod-rhs--strikethrough">→ <ProdRHS rhs={rhs} /></td>
                <td><Badge type="useless">useless</Badge></td>
              </tr>
          );
        }
      }
    }
  }

  return (
      <div className="table-wrapper">
        <table className="productions-table">
          <thead>
          <tr>
            <th>Variable</th>
            <th>Production</th>
            <th>Status</th>
          </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
  );
}

// ─── Final CNF Summary ────────────────────────────────────────────────────────

function CNFSummary({ step }) {
  return (
      <div className="card card--success">
        <p className="cnf-summary__title">Final CNF Grammar</p>
        <div className="cnf-summary__body">
          {Object.entries(step.prods).map(([A, rhss]) => (
              <div key={A} className="cnf-summary__prod-row">
                <NTSpan>{A}</NTSpan>
                <span className="cnf-summary__arrow"> → </span>
                {rhss.map((rhs, i) => (
                    <span key={i}>
                <ProdRHS rhs={rhs} />
                      {i < rhss.length - 1 && (
                          <span className="cnf-summary__pipe"> | </span>
                      )}
              </span>
                ))}
              </div>
          ))}
        </div>
      </div>
  );
}

// ─── Root App Component ───────────────────────────────────────────────────────

export default function App() {
  const [input, setInput] = useState(EXAMPLES[0]);
  const [steps, setSteps] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState("");

  const run = (text = input) => {
    setError("");
    try {
      const g = parseGrammar(text);
      setSteps(computeAllSteps(g));
      setCurrentStep(0);
    } catch (e) {
      setError(e.message);
      setSteps(null);
    }
  };

  const loadExample = (i) => {
    setInput(EXAMPLES[i]);
    run(EXAMPLES[i]);
  };

  const activeStep = steps?.[currentStep];
  const prevStep = currentStep > 0 ? steps[currentStep - 1] : null;

  return (
      <div className="app-container">
        <h1 className="app-title">CFG Simplification Visualizer</h1>
        <p className="app-subtitle">
          Step-by-step simplification of a Context-Free Grammar to Chomsky Normal Form (CNF).
        </p>

        {/* ── Input Card ── */}
        <div className="card">
          <p className="section-label">Grammar input</p>
          <p className="grammar-hint">
            One production per line as <code>A → B C | d</code>. Uppercase = non-terminals,
            lowercase = terminals. Use <code>ε</code> for epsilon.
          </p>
          <textarea
              className="grammar-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
          />
          {error && <div className="error-box">{error}</div>}
          <div className="btn-row">
            <button className="btn btn--primary" onClick={() => run()}>
              Simplify →
            </button>
            {EXAMPLES.map((_, i) => (
                <button key={i} className="btn btn--secondary" onClick={() => loadExample(i)}>
                  Example {i + 1}
                </button>
            ))}
          </div>
        </div>

        {/* ── Step Navigator + Content ── */}
        {steps && activeStep && (
            <>
              <nav className="step-nav">
                {steps.map((s, i) => (
                    <button
                        key={i}
                        onClick={() => setCurrentStep(i)}
                        className={[
                          "step-nav__btn",
                          i === currentStep ? "step-nav__btn--active" : "",
                          i < currentStep ? "step-nav__btn--done" : "",
                        ].join(" ")}
                    >
                      {i === 0 ? s.label : `${i}. ${s.label}`}
                    </button>
                ))}
              </nav>

              <div className="card">
                <h2 className="step-title">
                  {currentStep === 0
                      ? "Original Grammar"
                      : `Step ${currentStep}: ${activeStep.label}`}
                </h2>
                <p className="step-explanation">{STEP_EXPLANATIONS[currentStep]}</p>

                <InfoPanel step={activeStep} />

                <div className="legend">
                  <span><NTSpan>A</NTSpan> non-terminal</span>
                  <span><TSpan>a</TSpan> terminal</span>
                  {currentStep > 0 && <span><Badge type="added">added</Badge> new production</span>}
                  {currentStep > 0 && <span><Badge type="removed">removed</Badge> removed production</span>}
                </div>

                <ProductionsTable step={activeStep} prevStep={prevStep} />

                <div className="step-footer">
                  {currentStep > 0 && (
                      <button
                          className="btn btn--secondary"
                          onClick={() => setCurrentStep(currentStep - 1)}
                      >
                        ← Previous
                      </button>
                  )}
                  {currentStep < steps.length - 1 ? (
                      <button
                          className="btn btn--primary"
                          onClick={() => setCurrentStep(currentStep + 1)}
                      >
                        Next step →
                      </button>
                  ) : (
                      <span className="cnf-complete-badge">✓ CNF complete</span>
                  )}
                </div>
              </div>

              {currentStep === steps.length - 1 && <CNFSummary step={activeStep} />}
            </>
        )}
      </div>
  );
}