"use client";
import { useEffect, useState } from "react";
import { MembershipCard, type MembershipCardData } from "../membership-components";

function displayDate(date: string) { const [year, month, day] = date.split("-").map(Number); return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Adelaide" }).format(new Date(Date.UTC(year, month - 1, day, 12))); }
export function MembershipCardClient() {
  const [membership, setMembership] = useState<MembershipCardData | null>(null);
  const [message, setMessage] = useState("Loading membership…");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) { Promise.resolve().then(() => setMessage("Membership not found.")); return; }
    const controller = new AbortController();
    fetch("/api/memberships/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data; })
      .then(({ membership: value }) => { setMembership({ ...value, validFrom: displayDate(value.validFrom), validUntil: displayDate(value.validUntil) }); setMessage(""); })
      .catch((reason) => { if (reason.name !== "AbortError") setMessage(reason.message || "Membership could not be loaded."); });
    return () => controller.abort();
  }, []);
  return <>{message && <p role="status">{message}</p>}{membership && <><MembershipCard membership={membership} /><div className="print-card-controls"><button className="button button--red" onClick={() => window.print()}>Print / Save card</button></div></>}</>;
}
