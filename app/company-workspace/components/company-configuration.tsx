"use client";

import { Plus, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Company, CompanyConfig, WorkspaceResponse } from "../../../lib/client-workflow-types";
import { typeLabel, types } from "../request-presentation";
import { button, Field, input, secondary, Section } from "../ui";

export function ConfigurationPanel({
  company,
  busy,
  save,
}: {
  company: Company;
  busy: boolean;
  save: (config: CompanyConfig) => Promise<WorkspaceResponse | undefined>;
}) {
  const [fields, setFields] = useState(company.config.fields);
  const [products, setProducts] = useState(company.config.products);
  const [tasks, setTasks] = useState(company.config.tasks);
  const [taskSizeGuidelineHours, setTaskSizeGuidelineHours] = useState(company.config.taskSizeGuidelineHours ?? 16);
  const [capabilities, setCapabilities] = useState(company.config.capabilities.join("\n"));
  const activeRequests = company.requests.filter((request) => request.status !== "frozen");

  function createId(prefix: string, existing: string[]) {
    let id = `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    while (existing.includes(id))
      id = `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    return id;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await save({
      ...company.config,
      fields,
      products,
      tasks,
      taskSizeGuidelineHours,
      capabilities: capabilities
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }

  return (
    <Section
      title="Company workflow settings"
      description={`Configuration v${company.config.version}. Saved changes create a new version; existing requests and frozen estimates retain their original snapshot.`}
    >
      {company.role !== "admin" && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          Only company admins can change these settings. You can still review the current setup.
        </p>
      )}
      <form className="space-y-5" onSubmit={submit}>
        <fieldset
          disabled={busy || company.role !== "admin"}
          className="space-y-5 disabled:opacity-75"
        >
          <Field name="Task sizing guideline (central effort hours)"><input type="number" min="1" max="10000" className={input} value={taskSizeGuidelineHours} onChange={event => setTaskSizeGuidelineHours(Number(event.target.value))} /><span className="mt-1 block text-xs text-estimator-muted">Suggest splitting larger tasks during effort review. This is guidance for your company and does not block approval.</span></Field>
          <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold tracking-tight">Request fields</h3>
                <p className="mt-1 text-sm leading-5 text-estimator-muted">
                  Choose which details reviewers capture for each kind of request.
                </p>
              </div>
              <span className="rounded-lg bg-white px-2.5 py-1 text-xs text-estimator-muted">
                {fields.length} fields
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {fields.map((field, index) => {
                const inUse = activeRequests.filter((request) =>
                  Object.hasOwn(request.review.fieldAnswers ?? {}, field.key),
                ).length;
                return (
                  <article
                    key={field.key}
                    className="rounded-xl border border-estimator-line bg-white p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                      <Field name="Field label">
                        <input
                          className={input}
                          maxLength={100}
                          required
                          value={field.label}
                          onChange={(event) =>
                            setFields((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, label: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="e.g. Number of investors"
                        />
                      </Field>
                      <Field name="Priority · 1–10">
                        <input
                          className={input}
                          type="number"
                          min="1"
                          max="10"
                          step="1"
                          value={field.priority ?? 5}
                          onChange={(event) =>
                            setFields((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? { ...item, priority: Number(event.target.value) }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <p className="mt-3 text-xs font-medium text-estimator-muted">
                      Use this field for
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {types.map((type) => (
                        <label
                          key={type}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-estimator-line px-3 text-xs text-estimator-ink"
                        >
                          <input
                            type="checkbox"
                            checked={field.requestTypes.includes(type)}
                            onChange={(event) =>
                              setFields((current) =>
                                current.map((item, i) =>
                                  i === index
                                    ? {
                                        ...item,
                                        requestTypes: event.target.checked
                                          ? [...item.requestTypes, type]
                                          : item.requestTypes.filter((value) => value !== type),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                          {typeLabel[type]}
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex min-h-10 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            setFields((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, required: event.target.checked } : item,
                              ),
                            )
                          }
                        />
                        Required before estimate
                      </label>
                      <div className="flex items-center gap-2">
                        {inUse > 0 && (
                          <span className="text-xs text-estimator-muted">
                            Used in {inUse} open {inUse === 1 ? "request" : "requests"}
                          </span>
                        )}
                        <button
                          className="min-h-10 px-2 text-sm font-medium text-red-800 underline disabled:text-estimator-muted disabled:no-underline"
                          type="button"
                          disabled={inUse > 0}
                          onClick={() =>
                            setFields((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          Remove field
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!fields.length && (
                <p className="rounded-xl bg-white p-4 text-sm text-estimator-muted">
                  No additional request fields are configured yet.
                </p>
              )}
            </div>
            <button
              className={secondary + " mt-3"}
              type="button"
              onClick={() => {
                const key = createId(
                  "field",
                  fields.map((item) => item.key),
                );
                setFields((current) => [
                  ...current,
                  { key, label: "", requestTypes: [...types], required: false, priority: 5 },
                ]);
              }}
            >
              <Plus size={15} />
              Add request field
            </button>
          </section>

          <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold tracking-tight">Products and services</h3>
                <p className="mt-1 text-sm leading-5 text-estimator-muted">
                  Describe only the offerings your team can support. AI findings must still cite
                  approved knowledge.
                </p>
              </div>
              <span className="rounded-lg bg-white px-2.5 py-1 text-xs text-estimator-muted">
                {products.length} products
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {products.map((product, index) => {
                const inUse = activeRequests.filter(
                  (request) => request.review.productId === product.id,
                ).length;
                return (
                  <article
                    key={product.id}
                    className="grid gap-3 rounded-xl border border-estimator-line bg-white p-4 sm:grid-cols-2"
                  >
                    <Field name="Product name">
                      <input
                        className={input}
                        maxLength={100}
                        required
                        value={product.name}
                        onChange={(event) =>
                          setProducts((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                        placeholder="e.g. Investor onboarding"
                      />
                    </Field>
                    <Field name="Short description">
                      <textarea
                        className={input}
                        rows={2}
                        maxLength={1000}
                        value={product.description}
                        onChange={(event) =>
                          setProducts((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, description: event.target.value } : item,
                            ),
                          )
                        }
                        placeholder="What does this product or service cover?"
                      />
                    </Field>
                    <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                      <span className="font-mono text-[11px] text-estimator-muted">
                        ID · {product.id}
                      </span>
                      <div className="flex items-center gap-2">
                        {inUse > 0 && (
                          <span className="text-xs text-estimator-muted">
                            Used in {inUse} open {inUse === 1 ? "request" : "requests"}
                          </span>
                        )}
                        <button
                          className="min-h-10 px-2 text-sm font-medium text-red-800 underline disabled:text-estimator-muted disabled:no-underline"
                          type="button"
                          disabled={inUse > 0}
                          onClick={() =>
                            setProducts((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          Remove product
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <button
              className={secondary + " mt-3"}
              type="button"
              onClick={() => {
                const id = createId(
                  "product",
                  products.map((item) => item.id),
                );
                setProducts((current) => [...current, { id, name: "", description: "" }]);
              }}
            >
              <Plus size={15} />
              Add product
            </button>
          </section>

          <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold tracking-tight">
                  Task templates and effort ranges
                </h3>
                <p className="mt-1 text-sm leading-5 text-estimator-muted">
                  Set the prior hours per unit and the low/high planning multipliers. Approved
                  training history can adjust eligible task estimates.
                </p>
              </div>
              <span className="rounded-lg bg-white px-2.5 py-1 text-xs text-estimator-muted">
                {tasks.length} templates
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {tasks.map((task, index) => {
                const inUse = activeRequests.filter((request) =>
                  request.review.workPackages.some((item) => item.taskId === task.id),
                ).length;
                return (
                  <article
                    key={task.id}
                    className="rounded-xl border border-estimator-line bg-white p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field name="Task name">
                        <input
                          className={input}
                          maxLength={100}
                          required
                          value={task.label}
                          onChange={(event) =>
                            setTasks((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, label: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </Field>
                      <p className="self-end pb-2 font-mono text-[11px] text-estimator-muted">
                        ID · {task.id}
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field name="Base hours per unit">
                        <input
                          className={input}
                          type="number"
                          min="0.1"
                          max="10000"
                          step="0.1"
                          required
                          value={task.baseHours}
                          onChange={(event) =>
                            setTasks((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? { ...item, baseHours: Number(event.target.value) }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field name="Low multiplier · 0.1–1">
                        <input
                          className={input}
                          type="number"
                          min="0.1"
                          max="1"
                          step="0.05"
                          required
                          value={task.lowFactor}
                          onChange={(event) =>
                            setTasks((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? { ...item, lowFactor: Number(event.target.value) }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field name="High multiplier · 1–5">
                        <input
                          className={input}
                          type="number"
                          min="1"
                          max="5"
                          step="0.05"
                          required
                          value={task.highFactor}
                          onChange={(event) =>
                            setTasks((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? { ...item, highFactor: Number(event.target.value) }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {inUse > 0 && (
                        <span className="text-xs text-estimator-muted">
                          Used in {inUse} open {inUse === 1 ? "request" : "requests"}
                        </span>
                      )}
                      <button
                        className="min-h-10 px-2 text-sm font-medium text-red-800 underline disabled:text-estimator-muted disabled:no-underline"
                        type="button"
                        disabled={tasks.length <= 1 || inUse > 0}
                        onClick={() => setTasks((current) => current.filter((_, i) => i !== index))}
                      >
                        Remove template
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <button
              className={secondary + " mt-3"}
              type="button"
              onClick={() => {
                const id = createId(
                  "task",
                  tasks.map((item) => item.id),
                );
                setTasks((current) => [
                  ...current,
                  { id, label: "", baseHours: 1, lowFactor: 0.75, highFactor: 1.5 },
                ]);
              }}
            >
              <Plus size={15} />
              Add task template
            </button>
          </section>

          <section className="rounded-2xl border border-estimator-line bg-estimator-canvas/70 p-4 sm:p-5">
            <h3 className="text-base font-semibold tracking-tight">Team capabilities</h3>
            <p className="mt-1 text-sm leading-5 text-estimator-muted">
              List skills or systems the team is prepared to support. One item per line.
            </p>
            <Field name="Configured capabilities">
              <textarea
                className={input}
                rows={5}
                maxLength={8000}
                value={capabilities}
                onChange={(event) => setCapabilities(event.target.value)}
                placeholder={"Salesforce\nInvestor data migration\nREST API integrations"}
              />
            </Field>
            <p className="mt-2 text-xs leading-5 text-estimator-muted">
              An unlisted capability stays unknown until an admin adds it and approved company
              knowledge supports it.
            </p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button className={button} disabled={busy || tasks.length === 0}>
              <Settings2 size={16} />
              {busy ? "Saving settings…" : "Save settings"}
            </button>
            <span className="text-xs text-estimator-muted">
              Your changes create configuration version {company.config.version + 1}.
            </span>
          </div>
        </fieldset>
      </form>
    </Section>
  );
}
