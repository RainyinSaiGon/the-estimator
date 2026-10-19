"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { WorkspaceResponse } from "../../lib/client-workflow-types";
import { api } from "./workspace-api";

type Selection = { companyId: string; requestId: string; generation: number };
type PendingOperation = { id: number; name: string; companyId: string; requestId: string };
type WorkspaceRead = (signal: AbortSignal) => Promise<WorkspaceResponse>;

/** Owns response ordering. A command may finish on the server after navigation,
 * but its response and error must never navigate the user back to its origin. */
export function useWorkspaceController({ guest }: { guest: boolean }) {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [requestId, updateRequestId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingOperation[]>([]);
  const selection = useRef<Selection>({ companyId: "", requestId: "", generation: 0 });
  const mounted = useRef(true);
  const sequence = useRef(0);
  const readGeneration = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const commandQueues = useRef(new Map<string, Promise<void>>());
  const activeCommands = useRef(new Map<string, number>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readGeneration.current += 1;
      readAbort.current?.abort();
    };
  }, []);

  const isCurrent = useCallback((origin: Selection) =>
    mounted.current && selection.current.generation === origin.generation, []);

  const begin = useCallback((name: string, origin: Selection) => {
    const id = ++sequence.current;
    setPending((current) => [...current, { id, name, companyId: origin.companyId, requestId: name === "load" ? "" : origin.requestId }]);
    return id;
  }, []);
  const finish = useCallback((id: number) => {
    if (mounted.current) setPending((current) => current.filter((item) => item.id !== id));
  }, []);

  const setRequestId = useCallback((value: SetStateAction<string>) => {
    const next = typeof value === "function" ? value(selection.current.requestId) : value;
    if (next !== selection.current.requestId) {
      selection.current = { ...selection.current, requestId: next, generation: selection.current.generation + 1 };
      setError("");
      setNotice("");
    }
    updateRequestId(next);
  }, []);

  const applyResponse = useCallback((next: WorkspaceResponse) => {
    const nextCompanyId = next.company?.id ?? "";
    const currentRequestId = selection.current.requestId;
    const nextRequestId = next.company?.requests.some((item) => item.id === currentRequestId) ? currentRequestId : "";
    if (nextCompanyId !== selection.current.companyId || nextRequestId !== currentRequestId) {
      selection.current = { companyId: nextCompanyId, requestId: nextRequestId, generation: selection.current.generation + 1 };
    }
    setData(next);
    setCompanyId(nextCompanyId);
    updateRequestId(nextRequestId);
  }, []);

  const load = useCallback(async (id?: string, read?: WorkspaceRead) => {
    if (guest) return undefined;
    const origin = { ...selection.current };
    const target = id ?? origin.companyId;
    const generation = ++readGeneration.current;
    readAbort.current?.abort();
    const abort = new AbortController();
    readAbort.current = abort;
    const operationId = begin("load", origin);
    setError("");
    try {
      // A command may still be finishing after the user leaves and returns.
      // Read only once that company's last queued command has released it.
      await commandQueues.current.get(target);
      if (!isCurrent(origin) || generation !== readGeneration.current || abort.signal.aborted) return undefined;
      // The generation guard also protects transports which cannot cancel reads.
      const next = await (read ? read(abort.signal) : api(undefined, target || undefined, abort.signal));
      if (!isCurrent(origin) || generation !== readGeneration.current || abort.signal.aborted || activeCommands.current.has(target)) return undefined;
      if (target && next.company?.id !== target) throw new Error("This workspace is no longer available. Choose another workspace.");
      applyResponse(next);
      return next;
    } catch (cause) {
      if (isCurrent(origin) && generation === readGeneration.current && !abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not open company workspace.");
      return undefined;
    } finally {
      finish(operationId);
    }
  }, [applyResponse, begin, finish, guest, isCurrent]);

  const selectCompany = useCallback((id: string) => {
    if (id !== selection.current.companyId) {
      selection.current = { companyId: id, requestId: "", generation: selection.current.generation + 1 };
      setCompanyId(id);
      updateRequestId("");
      setData((current) => current ? { ...current, company: undefined } : null);
      setNotice("");
    }
    return load(id);
  }, [load]);

  const run = useCallback(async (name: string, work: () => Promise<WorkspaceResponse>) => {
    const origin = { ...selection.current };
    const operationId = begin(name, origin);
    const scope = origin.companyId;
    readGeneration.current += 1;
    readAbort.current?.abort();
    activeCommands.current.set(scope, (activeCommands.current.get(scope) ?? 0) + 1);
    setError("");
    setNotice("");

    // Serialize commands within a company so an older full-workspace response
    // cannot overwrite a later command. Other companies retain independent queues.
    const previous = commandQueues.current.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const queued = new Promise<void>((resolve) => { release = resolve; });
    commandQueues.current.set(scope, queued);
    try {
      await previous;
      if (!isCurrent(origin)) return undefined;
      const next = await work();
      if (!isCurrent(origin)) return undefined;
      if (name !== "company" && scope && next.company?.id !== scope)
        throw new Error("The workspace changed. Reload it before continuing.");
      applyResponse(next);
      return next;
    } catch (cause) {
      if (isCurrent(origin)) setError(cause instanceof Error ? cause.message : "The workspace request failed.");
      return undefined;
    } finally {
      const remaining = (activeCommands.current.get(scope) ?? 1) - 1;
      if (remaining) activeCommands.current.set(scope, remaining);
      else activeCommands.current.delete(scope);
      if (commandQueues.current.get(scope) === queued) commandQueues.current.delete(scope);
      release();
      finish(operationId);
    }
  }, [applyResponse, begin, finish, isCurrent]);

  // Every command returns a company snapshot, so it keeps that company's UI
  // pending even when the user opens another request within the same company.
  const pendingOperations = pending.filter((item) => item.companyId === companyId);
  const busy = pendingOperations.at(-1)?.name ?? "";
  return { data, companyId, requestId, setRequestId, selectCompany, load, run, busy, pendingOperations, error, setError, notice, setNotice };
}
