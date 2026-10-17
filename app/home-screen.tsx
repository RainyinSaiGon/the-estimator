"use client";

import { useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, FileText, History, Layers3, ShieldCheck } from "lucide-react";
import { tw } from "./tailwind-utilities";

const stages = ["Scope", "Estimate", "Learn"] as const;

export default function HomeScreen({ onNewRequest, onOpenHistory }: {
  onNewRequest: (sample?: boolean) => void;
  onOpenHistory: () => void;
}) {
  const [stage, setStage] = useState(0);

  return <div className={tw("home-screen")}>
    <section className={tw("home-hero")} aria-labelledby="home-title">
      <div>
        <p className={tw("hero-kicker")}>FROM CLIENT BRIEF TO COMMITMENT</p>
        <h1 id="home-title">Bring clarity to<br />every commitment.</h1>
        <div className={tw("hero-actions")}>
          <button className={tw("button primary")} onClick={() => onNewRequest()}>Start scoping <ArrowUpRight size={17} /></button>
          <button className={tw("button")} onClick={() => onNewRequest(true)}>Try a sample</button>
        </div>
      </div>
      <div className={tw("hero-intro")}>
        <p>Understand the ask. Make the effort visible. Learn from what delivery actually takes.</p>
        <p>One workspace for turning rough integration requests into reviewed scopes and explainable estimates.</p>
      </div>
    </section>

    <section className={tw("showcase")} aria-label="Explore the estimation workflow">
      <div className={tw("showcase-tabs")} role="tablist" aria-label="Workflow preview" onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (stage + 1) % 3 : event.key === "ArrowLeft" ? (stage + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
        if (next === null) return;
        event.preventDefault(); setStage(next);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
        {stages.map((name, index) => <button key={name} id={`preview-tab-${index}`} role="tab" aria-selected={stage === index} aria-controls={`preview-panel-${index}`} tabIndex={stage === index ? 0 : -1} onClick={() => setStage(index)}>
          <span className={tw(`stage-orb orb-${index}`)} aria-hidden="true" />{name}<span className={tw("stage-detail")}>{["the request", "the effort", "from delivery"][index]}</span>
        </button>)}
      </div>
      <div className={tw(`showcase-content preview-${stage}`)} id={`preview-panel-${stage}`} role="tabpanel" aria-labelledby={`preview-tab-${stage}`} tabIndex={0}>
        <div className={tw("showcase-copy")}>
          <span className={tw("section-index")}>0{stage + 1} / {stages[stage].toUpperCase()}</span>
          <h2>{[<>A rough request.<br />A clear way forward.</>, <>Every hour<br />has a reason.</>, <>Experience that<br />stays with you.</>][stage]}</h2>
          <p>{["Find the deliverables, keep the source in sight, and surface the questions that change the work.", "See the work packages, assumptions, and comparable projects behind your planning range.", "Connect actual hours to the agreed scope. Give future estimates a better starting point."][stage]}</p>
          <button className={tw("text-button")} onClick={() => stage === 2 ? onOpenHistory() : onNewRequest(true)}>{stage === 2 ? "Explore project history" : "Explore a sample request"}<ArrowRight size={16} /></button>
        </div>
        <div className={tw("demo-scene")} aria-label="Illustrative workflow using synthetic data">
          <div className={tw("scene-glow")} aria-hidden="true" />
          {stage === 0 ? <>
            <div className={tw("demo-paper source-paper")}><div className={tw("demo-paper-heading")}><FileText size={14} /><span>client-request.txt</span><span className={tw("paper-dots")}>•••</span></div><p>“We need to sync our CRM with the customer portal and import our existing contacts…”</p><div className={tw("paper-lines")} aria-hidden="true"><i /><i /><i /></div><span className={tw("paper-caption")}>THE ORIGINAL BRIEF</span></div>
            <div className={tw("demo-paper scope-paper")}><div className={tw("demo-paper-heading")}><Layers3 size={15} /><strong>Your scope, explained</strong></div><div className={tw("demo-check")}><Check size={14} /><span>CRM & portal synchronization<small>Linked to the client's request</small></span></div><div className={tw("demo-check")}><Check size={14} /><span>Existing contact import<small>Linked to the client's request</small></span></div><div className={tw("demo-question")}><span className={tw("question-dot")} />Two details to confirm<small>Sync direction · API availability</small></div><div className={tw("demo-paper-footer")}><ShieldCheck size={13} />Source evidence kept in context</div></div>
            <span className={tw("floating-label")}><CheckCircle2 size={14} />Clarity before commitment</span>
          </> : stage === 1 ? <div className={tw("demo-paper effort-paper")}><div className={tw("demo-paper-heading")}><span>EFFORT AT A GLANCE</span><span className={tw("demo-status")}>ILLUSTRATIVE</span></div><div className={tw("demo-range")}>78–124<span> h</span></div><p className={tw("demo-subtitle")}>Planning range · person-hours</p><div className={tw("demo-bars")}>{[["Discovery & scope", "8 h", "24%"], ["Data mapping", "14 h", "43%"], ["CRM synchronization", "24 h", "74%"], ["Testing & handover", "18 h", "56%"]].map(([label, value, width]) => <div key={label}><div><span>{label}</span><strong>{value}</strong></div><i className={tw("[width:var(--bar-width)]")} style={{ "--bar-width": width } as CSSProperties} /></div>)}</div><div className={tw("demo-paper-footer")}><History size={13} />Assumptions + comparable delivery</div></div> : <div className={tw("demo-paper delivery-paper")}><div className={tw("demo-paper-heading")}><span className={tw("delivery-check")}><Check size={17} /></span><strong>Delivery, recorded.</strong></div><p className={tw("demo-subtitle")}>CRM sync & contact migration</p><div className={tw("demo-comparison")}><div><span>Reviewed baseline</span><strong>98.3 <small>h</small></strong><i className={tw("[width:var(--bar-width)]")} style={{ "--bar-width": "73%" } as CSSProperties} /></div><div><span>Original scope actual</span><strong>116 <small>h</small></strong><i className={tw("[width:var(--bar-width)]")} style={{ "--bar-width": "87%" } as CSSProperties} /></div></div><div className={tw("added-scope")}><span>Additional scope</span><strong>6 h · tracked separately</strong></div><div className={tw("demo-paper-footer")}><History size={13} />A reference for the next comparable project</div></div>}
          <span className={tw("scene-caption")}>ILLUSTRATIVE WORKFLOW · SYNTHETIC DATA</span>
        </div>
      </div>
    </section>

    <div className={tw("home-context")}><span>BUILT FOR INTEGRATION DELIVERY</span><div><span>CRM synchronization</span><i /><span>API integrations</span><i /><span>CSV migrations</span></div></div>
    <section className={tw("home-workflow")} id="workflow" aria-labelledby="workflow-title">
      <div className={tw("workflow-heading")}><h2 id="workflow-title">A stronger starting point.<br />A more thoughtful commitment.</h2><p>Keep the reasoning connected,<br /> from the first read to the final hour.</p></div>
      <div className={tw("workflow-cards")}>{[
        [FileText, "01", "Stay close to the source", "Keep requested deliverables beside the client's own words. Review what is included and what still needs an answer."],
        [Layers3, "02", "See how the effort adds up", "Make assumptions visible, review task estimates, and save the scope you agreed as a fixed baseline."],
        [History, "03", "Give experience a place to go", "Record original-scope effort and added work separately. Use comparable delivery to inform the next estimate."],
      ].map(([Icon, number, title, copy]) => { const CardIcon = Icon as typeof FileText; return <article key={String(number)}><div className={tw("workflow-card-top")}><CardIcon size={22} strokeWidth={1.5} /><span>{String(number)}</span></div><h3>{String(title)}</h3><p>{String(copy)}</p></article>; })}</div>
    </section>
    <section className={tw("home-closing")}><div><span className={tw("hero-kicker")}>YOUR NEXT PROJECT STARTS HERE</span><h2>Get clear before you commit.</h2></div><button className={tw("button primary")} onClick={() => onNewRequest()}>Scope a request <ArrowUpRight size={17} /></button></section>
    <div className={tw("home-privacy")}><ShieldCheck size={14} />Your briefs and delivery records stay in your private workspace.</div>
  </div>;
}
