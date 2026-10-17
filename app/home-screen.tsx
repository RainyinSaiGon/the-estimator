"use client";

import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, FileText, History, Layers3, ShieldCheck } from "lucide-react";

const stages = ["Scope", "Estimate", "Learn"] as const;

export default function HomeScreen({ onNewRequest, onOpenHistory }: {
  onNewRequest: (sample?: boolean) => void;
  onOpenHistory: () => void;
}) {
  const [stage, setStage] = useState(0);

  return <div className="home-screen">
    <section className="home-hero" aria-labelledby="home-title">
      <div>
        <p className="hero-kicker">FROM CLIENT BRIEF TO COMMITMENT</p>
        <h1 id="home-title">Bring clarity to<br />every commitment.</h1>
        <div className="hero-actions">
          <button className="button primary" onClick={() => onNewRequest()}>Start scoping <ArrowUpRight size={17} /></button>
          <button className="button" onClick={() => onNewRequest(true)}>Try a sample</button>
        </div>
      </div>
      <div className="hero-intro">
        <p>Understand the ask. Make the effort visible. Learn from what delivery actually takes.</p>
        <p>One workspace for turning rough integration requests into reviewed scopes and explainable estimates.</p>
      </div>
    </section>

    <section className="showcase" aria-label="Explore the estimation workflow">
      <div className="showcase-tabs" role="tablist" aria-label="Workflow preview" onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (stage + 1) % 3 : event.key === "ArrowLeft" ? (stage + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
        if (next === null) return;
        event.preventDefault(); setStage(next);
        event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>
        {stages.map((name, index) => <button key={name} id={`preview-tab-${index}`} role="tab" aria-selected={stage === index} aria-controls={`preview-panel-${index}`} tabIndex={stage === index ? 0 : -1} onClick={() => setStage(index)}>
          <span className={`stage-orb orb-${index}`} aria-hidden="true" />{name}<span className="stage-detail">{["the request", "the effort", "from delivery"][index]}</span>
        </button>)}
      </div>
      <div className={`showcase-content preview-${stage}`} id={`preview-panel-${stage}`} role="tabpanel" aria-labelledby={`preview-tab-${stage}`} tabIndex={0}>
        <div className="showcase-copy">
          <span className="section-index">0{stage + 1} / {stages[stage].toUpperCase()}</span>
          <h2>{[<>A rough request.<br />A clear way forward.</>, <>Every hour<br />has a reason.</>, <>Experience that<br />stays with you.</>][stage]}</h2>
          <p>{["Find the deliverables, keep the source in sight, and surface the questions that change the work.", "See the work packages, assumptions, and comparable projects behind your planning range.", "Connect actual hours to the agreed scope. Give future estimates a better starting point."][stage]}</p>
          <button className="text-button" onClick={() => stage === 2 ? onOpenHistory() : onNewRequest(true)}>{stage === 2 ? "Explore project history" : "Explore a sample request"}<ArrowRight size={16} /></button>
        </div>
        <div className="demo-scene" aria-label="Illustrative workflow using synthetic data">
          <div className="scene-glow" aria-hidden="true" />
          {stage === 0 ? <>
            <div className="demo-paper source-paper"><div className="demo-paper-heading"><FileText size={14} /><span>client-request.txt</span><span className="paper-dots">•••</span></div><p>“We need to sync our CRM with the customer portal and import our existing contacts…”</p><div className="paper-lines" aria-hidden="true"><i /><i /><i /></div><span className="paper-caption">THE ORIGINAL BRIEF</span></div>
            <div className="demo-paper scope-paper"><div className="demo-paper-heading"><Layers3 size={15} /><strong>Your scope, explained</strong></div><div className="demo-check"><Check size={14} /><span>CRM & portal synchronization<small>Linked to the client's request</small></span></div><div className="demo-check"><Check size={14} /><span>Existing contact import<small>Linked to the client's request</small></span></div><div className="demo-question"><span className="question-dot" />Two details to confirm<small>Sync direction · API availability</small></div><div className="demo-paper-footer"><ShieldCheck size={13} />Source evidence kept in context</div></div>
            <span className="floating-label"><CheckCircle2 size={14} />Clarity before commitment</span>
          </> : stage === 1 ? <div className="demo-paper effort-paper"><div className="demo-paper-heading"><span>EFFORT AT A GLANCE</span><span className="demo-status">ILLUSTRATIVE</span></div><div className="demo-range">78–124<span> h</span></div><p className="demo-subtitle">Planning range · person-hours</p><div className="demo-bars">{[["Discovery & scope", "8 h", "24%"], ["Data mapping", "14 h", "43%"], ["CRM synchronization", "24 h", "74%"], ["Testing & handover", "18 h", "56%"]].map(([label, value, width]) => <div key={label}><div><span>{label}</span><strong>{value}</strong></div><i style={{ width }} /></div>)}</div><div className="demo-paper-footer"><History size={13} />Assumptions + comparable delivery</div></div> : <div className="demo-paper delivery-paper"><div className="demo-paper-heading"><span className="delivery-check"><Check size={17} /></span><strong>Delivery, recorded.</strong></div><p className="demo-subtitle">CRM sync & contact migration</p><div className="demo-comparison"><div><span>Reviewed baseline</span><strong>98.3 <small>h</small></strong><i style={{ width: "73%" }} /></div><div><span>Original scope actual</span><strong>116 <small>h</small></strong><i style={{ width: "87%" }} /></div></div><div className="added-scope"><span>Additional scope</span><strong>6 h · tracked separately</strong></div><div className="demo-paper-footer"><History size={13} />A reference for the next comparable project</div></div>}
          <span className="scene-caption">ILLUSTRATIVE WORKFLOW · SYNTHETIC DATA</span>
        </div>
      </div>
    </section>

    <div className="home-context"><span>BUILT FOR INTEGRATION DELIVERY</span><div><span>CRM synchronization</span><i /><span>API integrations</span><i /><span>CSV migrations</span></div></div>
    <section className="home-workflow" id="workflow" aria-labelledby="workflow-title">
      <div className="workflow-heading"><h2 id="workflow-title">A stronger starting point.<br />A more thoughtful commitment.</h2><p>Keep the reasoning connected,<br /> from the first read to the final hour.</p></div>
      <div className="workflow-cards">{[
        [FileText, "01", "Stay close to the source", "Keep requested deliverables beside the client's own words. Review what is included and what still needs an answer."],
        [Layers3, "02", "See how the effort adds up", "Make assumptions visible, review task estimates, and save the scope you agreed as a fixed baseline."],
        [History, "03", "Give experience a place to go", "Record original-scope effort and added work separately. Use comparable delivery to inform the next estimate."],
      ].map(([Icon, number, title, copy]) => { const CardIcon = Icon as typeof FileText; return <article key={String(number)}><div className="workflow-card-top"><CardIcon size={22} strokeWidth={1.5} /><span>{String(number)}</span></div><h3>{String(title)}</h3><p>{String(copy)}</p></article>; })}</div>
    </section>
    <section className="home-closing"><div><span className="hero-kicker">YOUR NEXT PROJECT STARTS HERE</span><h2>Get clear before you commit.</h2></div><button className="button primary" onClick={() => onNewRequest()}>Scope a request <ArrowUpRight size={17} /></button></section>
    <div className="home-privacy"><ShieldCheck size={14} />Your briefs and delivery records stay in your private workspace.</div>
  </div>;
}
